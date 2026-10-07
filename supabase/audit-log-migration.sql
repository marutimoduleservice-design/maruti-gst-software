-- Maruti Module Service: Audit Trail (Activity Log)
-- Run ONCE in the REAL database -> Supabase Dashboard -> SQL Editor.
--
-- WHY:
--  Har action ka record — kaun, kab, kya badla, purani value kya thi, nayi kya hai.
--  Invoice delete ho gaya? Customer number badal diya? Sab kuch is table me
--  rahega. App kuch bhi na likhe, DB trigger har INSERT / UPDATE / DELETE
--  khud record kar leta hai — koi screen bhool jaaye to bhi audit nahi tootega.
--
-- KYA AUDIT HOTA HAI (triggers):
--  invoices, customers, purchases, job_cards, bank_transactions, vendors,
--  items, technicians, warranty_returns, customer_item_prices
--  (invoice_items / job_card_technicians / bank_statement_* nahi — wo sirf
--   parent record ke saath badalte hain, alag se log karne se noise hota.)
--
-- KAUN DEKH SAKTA HAI:
--  Activity Log menu sirf Admin (Owner) aur Auditor ko dikhta hai.
--  Client se insert/update/delete kabhi nahi ho sakta (RLS) — sirf trigger.
--
-- SAFE TO RE-RUN (idempotent). Kuch data drop ya delete nahi karta.

-- ---------------------------------------------------------------------------
-- 1) Table
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,

  -- Jo user logged-in tha us waqt (null ho sakta hai system ke liye).
  auth_user_id uuid,
  user_email text,
  user_name text,

  -- Kaunsi screen/entity: 'Invoice', 'Customer', 'Job Card' ... (trigger arg)
  entity text not null,
  -- Us record ki id + business label (invoice_no, job_no, customer_name ...)
  entity_id bigint,
  entity_label text,

  action text not null check (action in ('create', 'update', 'delete')),

  -- Poorani / nayi value ka snapshot (as JSON). Update me dono, create me sirf
  -- new, delete me sirf old. Evidence ke liye poora row rakha jaata hai.
  old_values jsonb,
  new_values jsonb,

  -- Update me: kaun se columns badle (agar kuch nahi badla to row hi nahi banti).
  changed_fields text[],

  created_at timestamptz not null default now()
);

create index if not exists audit_log_entity_idx
  on public.audit_log (entity, entity_id);
create index if not exists audit_log_created_idx
  on public.audit_log (created_at desc);

-- ---------------------------------------------------------------------------
-- 2) Row Level Security — sirf Admin aur Auditor padh sakte hain.
--    Likhne ka rasta sirf DB trigger hai (security definer, owner = postgres,
--    jo RLS bypass karta hai). Client ke liye koi insert/update/delete policy
--    nahi hai, to app se log kabhi badla nahi ja sakta.
-- ---------------------------------------------------------------------------
alter table public.audit_log enable row level security;

drop policy if exists "rls_select_audit_log" on public.audit_log;
create policy "rls_select_audit_log"
  on public.audit_log
  for select
  to authenticated
  using (
    public.is_admin()
    or exists (
      select 1
      from public.app_users au
      where au.auth_user_id = auth.uid()
        and au.role = 'auditor'
        and au.active
    )
  );

-- ---------------------------------------------------------------------------
-- 3) Generic trigger function — table ka naam aur label column TG_ARGV se.
-- ---------------------------------------------------------------------------
create or replace function public.fn_audit_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old    jsonb;
  v_new    jsonb;
  v_action text;
  v_label  text;
  v_fields text[];
  v_id     bigint;
  v_uid    uuid;
  v_email  text;
  v_name   text;
begin
  if tg_op = 'INSERT' then
    v_action := 'create';
    v_new := to_jsonb(NEW);
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    -- Kuch badla hi nahi (jaise sirf wahi value dobara likhi) to log mat karo.
    if v_old = v_new then
      return null;
    end if;
    v_action := 'update';
    select coalesce(array_agg(e.k), array[]::text[])
      into v_fields
      from jsonb_each(v_new) as e(k, v)
     where v_old -> e.k is distinct from e.v;
  else
    v_action := 'delete';
    v_old := to_jsonb(OLD);
  end if;

  v_id := coalesce(
    nullif(v_new ->> 'id', '')::bigint,
    nullif(v_old ->> 'id', '')::bigint
  );

  -- Record ka business label: pehle trigger ka arg (TG_ARGV[1] = label column),
  -- phir common columns. NOTE: TG_ARGC naam ka variable PostgreSQL me nahi hai,
  -- isliye sirf TG_ARGV array use hoti hai (triggers hamesha 2 args ke saath
  -- ban rahi hain, neeche DO block me).
  v_label := coalesce(
    v_new ->> tg_argv[1],
    v_old ->> tg_argv[1],
    v_new ->> 'invoice_no',
    v_old ->> 'invoice_no',
    v_new ->> 'business_name',
    v_old ->> 'business_name',
    v_new ->> 'job_no',
    v_old ->> 'job_no',
    v_new ->> 'item_name',
    v_old ->> 'item_name',
    case when v_id is not null then 'ID ' || v_id::text end
  );

  -- Kaun kiya: JWT se email, naam app_users se (roles migration).
  v_uid := auth.uid();
  begin
    v_email := auth.jwt() ->> 'email';
  exception when others then
    v_email := null;
  end;
  begin
    select au.full_name into v_name
      from public.app_users au
     where au.auth_user_id = v_uid
     limit 1;
  exception when others then
    v_name := null;
  end;

  insert into public.audit_log (
    auth_user_id, user_email, user_name,
    entity, entity_id, entity_label, action,
    old_values, new_values, changed_fields
  ) values (
    v_uid,
    coalesce(v_email, 'system'),
    coalesce(nullif(v_name, ''), v_email, 'system'),
    tg_argv[0],
    v_id,
    v_label,
    v_action,
    v_old,
    v_new,
    v_fields
  );

  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) Triggers — sirf un tables par jo sach me exist karti hain
--    (DO block ke andar check, taaki koi missing table migration na tode).
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('invoices',           'Invoice',        'invoice_no'),
      ('customers',          'Customer',       'customer_name'),
      ('purchases',          'Purchase',       'purchase_no'),
      ('job_cards',          'Job Card',       'job_no'),
      ('bank_transactions',  'Payment',        'particulars'),
      ('vendors',            'Vendor',         'business_name'),
      ('items',              'Item',           'item_name'),
      ('technicians',        'Technician',     'name'),
      ('warranty_returns',   'Warranty',       'job_no'),
      ('customer_item_prices', 'Customer Price', 'item_name')
    ) as v(tbl, entity, label_col)
  loop
    if exists (
      select 1
        from information_schema.tables
       where table_schema = 'public'
         and table_name = t.tbl
    ) then
      execute format(
        'drop trigger if exists trg_audit_%s on public.%I',
        replace(t.tbl, '-', '_'), t.tbl
      );
      execute format(
        'create trigger trg_audit_%s after insert or update or delete on public.%I for each row execute function public.fn_audit_log(%L, %L)',
        replace(t.tbl, '-', '_'), t.tbl, t.entity, t.label_col
      );
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) VERIFY — iske baad alag se chalayein
-- ---------------------------------------------------------------------------
-- Table + function ban gaye?
--   select count(*) as triggers from pg_trigger
--    where tgname like 'trg_audit_%' and not tgisinternal;
--
-- Kuch badla to turant row aani chahiye (koi bhi invoice edit karke check):
--   select entity, entity_label, action, user_email, created_at
--     from audit_log order by created_at desc limit 20;
--
-- Kis record ki history chahiye (invoice ka example):
--   select * from audit_log
--    where entity = 'Invoice' and entity_id = <invoice_id>
--    order by created_at;
