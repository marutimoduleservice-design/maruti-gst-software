
-- ================================================================
-- SECTION 1/22: fresh-install-01-base-tables.sql
-- ================================================================
-- ── Fresh GST install: Part 1 — reconstructed base tables ─────────────────────
-- Ye tables purane DB me manually bani thin (repo me unka CREATE nahi tha),
-- isliye app code + import SQL + migrations se reconstruct ki gayi hain.
-- Sirf NAYE Supabase project par chalayein (SQL Editor), fresh DB ke liye.
-- Iske baad fresh-install.sql ke baaki hisse (migrations + RPC + policies) chalte hain.

create table if not exists public.companies (
  id bigserial primary key,
  name text not null,
  tax_mode text not null default 'Non-GST',
  gstin text,
  pan text,
  state_code text,
  state_name text,
  address text,
  phone text,
  email text,
  website text,
  bank_name text,
  bank_account_no text,
  bank_ifsc text,
  upi_id text,
  signatory text,
  invoice_prefix text,
  financial_year_start text default '04-01',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Default company: app pehli login par isi company ko use karega (company_id = 1).
-- banks ke default accounts bhi isi company par banenge (bank-accounts-migration).
insert into public.companies (id, name, tax_mode, active)
values (1, 'Maruti Module Service', 'Non-GST', true)
on conflict (id) do nothing;
select setval(
  pg_get_serial_sequence('public.companies', 'id'),
  coalesce((select max(id) from public.companies), 1)
);

create table if not exists public.company_settings (
  id bigserial primary key,
  company_id bigint not null default 1,
  business_name text,
  tagline text,
  business_address text,
  state text,
  state_code text,
  phone text,
  email text,
  website text,
  tax_mode text,
  gstin text,
  pan text,
  udyam_number text,
  bank_account_holder text,
  bank_account_number text,
  bank_name text,
  bank_ifsc text,
  bank_branch text,
  upi_id text,
  invoice_prefix text,
  invoice_start_number integer,
  financial_year_start text,
  signature_name text,
  po_terms text,
  sales_terms text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id bigint generated always as identity primary key,
  customer_code integer,
  customer_name text not null,
  business_name text,
  mobile text,
  business_address text,
  gst_available boolean not null default false,
  gst_number text,
  payment_term text,
  company_id bigint not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.vendors (
  id bigint generated always as identity primary key,
  vendor_code text,
  vendor_name text,
  business_name text,
  contact_person text,
  mobile text,
  address text,
  gst_status text,
  payment_term text,
  company_id bigint not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id bigint generated always as identity primary key,
  item_code text,
  item_name text not null,
  unit text,
  hsn_code text,
  gst_percent numeric(6,2) not null default 0,
  purchase_price numeric(12,2) not null default 0,
  cost_price numeric(12,2) not null default 0,
  sale_price numeric(12,2) not null default 0,
  opening_stock numeric(14,3) not null default 0,
  min_stock numeric(14,3) not null default 0,
  company_id bigint not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id bigserial primary key,
  inward_no text,
  purchase_no text,
  purchase_date date,
  vendor_id bigint,
  vendor_name text,
  vendor_code text,
  item_name text,
  item_code text,
  quantity numeric(14,3) not null default 0,
  rate numeric(12,2) not null default 0,
  purchase_rate numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  payment_mode text,
  remarks text,
  status text not null default 'Pending',
  company_id bigint not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists purchases_date_idx on public.purchases (purchase_date);
create index if not exists purchases_vendor_idx on public.purchases (vendor_id);

create table if not exists public.job_cards (
  id bigserial primary key,
  job_no text,
  job_date date,
  customer_id bigint,
  business_name text,
  received_quantity numeric(14,3) not null default 0,
  service_type text,
  technician text,
  repairing_quantity numeric(14,3) not null default 0,
  warranty_quantity numeric(14,3) not null default 0,
  reject_quantity numeric(14,3) not null default 0,
  remarks text,
  module_image_url text,
  received_image_url text,
  status text not null default 'Open',
  closed_at timestamptz,
  invoice_id bigint,
  created_at timestamptz not null default now(),
  company_id bigint not null default 1
);
create index if not exists job_cards_customer_idx on public.job_cards (customer_id);
create index if not exists job_cards_status_idx on public.job_cards (status);

create table if not exists public.invoices (
  id bigint generated always as identity primary key,
  invoice_no text not null,
  invoice_date date not null,
  customer_id bigint not null,
  job_card_id bigint,
  invoice_type text not null default 'Direct',
  total_amount numeric(14,2) not null default 0,
  company_id bigint not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists invoices_customer_idx on public.invoices (customer_id);
create index if not exists invoices_date_idx on public.invoices (invoice_date);
create index if not exists invoices_jobcard_idx on public.invoices (job_card_id);

create table if not exists public.invoice_items (
  id bigserial primary key,
  invoice_id bigint not null,
  inward_no text,
  item_id bigint,
  item_name text,
  quantity numeric(14,3) not null default 0,
  rate numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  cost_rate numeric(14,7) not null default 0,
  company_id bigint not null default 1,
  constraint invoice_items_invoice_fk
    foreign key (invoice_id) references public.invoices (id) on delete cascade
);
create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);
create index if not exists invoice_items_inward_idx on public.invoice_items (inward_no);
create index if not exists invoice_items_item_idx on public.invoice_items (item_id);

create table if not exists public.technicians (
  id bigserial primary key,
  name text not null,
  mobile text,
  salary numeric(12,2) not null default 0,
  status text not null default 'Active',
  share_percent numeric(5,2),
  company_id bigint not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.bank_transactions (
  id bigserial primary key,
  company_id bigint not null default 1,
  account_id bigint,
  transaction_no text,
  transaction_date date,
  date_time timestamptz,
  particulars text,
  notes text,
  party_name text,
  transaction_type text,
  type text,
  payment_in numeric(14,2) not null default 0,
  payment_out numeric(14,2) not null default 0,
  credit_amount numeric(14,2) not null default 0,
  debit_amount numeric(14,2) not null default 0,
  amount numeric(14,2) not null default 0,
  total_amount numeric(14,2),
  payment_mode text,
  remarks text,
  is_transfer boolean not null default false,
  transfer_to_account_id bigint,
  cheque_no text,
  cheque_date date,
  utr_no text,
  bounce_reason text,
  bounced_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bank_txn_date_idx on public.bank_transactions (transaction_date);
create index if not exists bank_txn_company_account_idx on public.bank_transactions (company_id, account_id);
create index if not exists bank_txn_account_date_idx on public.bank_transactions (account_id, transaction_date);
create index if not exists bank_txn_txnno_idx on public.bank_transactions (transaction_no);
create index if not exists bank_txn_bounced_idx on public.bank_transactions (company_id, bounced_at)
  where bounced_at is not null;

create table if not exists public.customer_item_prices (
  id bigserial primary key,
  company_id bigint not null default 1,
  customer_id bigint not null,
  item_id bigint not null,
  agreed_rate numeric(12,2) not null default 0,
  active boolean not null default true,
  effective_from date,
  created_at timestamptz not null default now(),
  constraint customer_item_prices_customer_fk
    foreign key (customer_id) references public.customers (id) on delete cascade,
  constraint customer_item_prices_item_fk
    foreign key (item_id) references public.items (id) on delete cascade,
  constraint customer_item_prices_unique unique (customer_id, item_id)
);

-- ================================================================
-- SECTION 2/22: user-roles-migration.sql
-- ================================================================
-- ============================================================
-- USER ROLES & PERMISSIONS
-- Chalayein: Supabase Dashboard > SQL Editor > New query > Run.
-- Ye migration idempotent hai — dobara chalana safe hai.
-- ============================================================

-- 1) App users table ------------------------------------------------
create table if not exists public.app_users (
  id bigserial primary key,
  auth_user_id uuid unique,
  email text not null unique,
  full_name text not null default '',
  role text not null default 'pending'
    check (role in ('admin','accountant','store','technician','auditor','pending')),
  technician_id bigint,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_users_role_idx on public.app_users (role);

-- 2) Login history (kaun kab login hua) ------------------------------
create table if not exists public.login_events (
  id bigserial primary key,
  auth_user_id uuid,
  email text,
  full_name text,
  role text,
  user_agent text,
  logged_in_at timestamptz not null default now()
);

create index if not exists login_events_time_idx on public.login_events (logged_in_at desc);

-- 3) Kya current user admin hai? -------------------------------------
-- Table khaali ho to har authenticated user "admin" maana jata hai
-- (bootstrap) — is tarah pehla login user khud ko admin ke roop me
-- app_users me insert kar sakta hai. Ek baar profile banne ke baad
-- sirf role='admin' wala hi admin hota hai.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.app_users u
    where u.auth_user_id = auth.uid()
      and u.role = 'admin'
      and u.active
  ) or not exists (select 1 from public.app_users);
$$;

-- 4) Profile ka auth_user_id khali hai to login par apna auth uid link kare.
-- Security definer: RLS bypass hota hai, par WHERE sirf apne email par
-- hi update karne deta hai — role/active column kabhi badal nahi sakta.
create or replace function public.claim_app_user()
returns void
language sql
security definer
set search_path = public
as $$
  update public.app_users
     set auth_user_id = auth.uid(),
         updated_at = now()
   where auth_user_id is null
     and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- 5) Row Level Security ---------------------------------------------
alter table public.app_users enable row level security;
alter table public.login_events enable row level security;

-- app_users: admin sab ko dekhe/sakta hai; har koi apni profile dekh sakta
-- hai (email match) — chahe auth_user_id abhi link na ho.
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users
  for select to authenticated
  using (
    public.is_admin()
    or auth_user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- Insert: sirf admin. (Table khaali ho to is_admin() true hai -> bootstrap.)
drop policy if exists app_users_admin_insert on public.app_users;
create policy app_users_admin_insert on public.app_users
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists app_users_admin_update on public.app_users;
create policy app_users_admin_update on public.app_users
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists app_users_admin_delete on public.app_users;
create policy app_users_admin_delete on public.app_users
  for delete to authenticated
  using (public.is_admin());

-- login_events: koi bhi authenticated apna login record kare;
-- history sirf admin (aur khud) dekh sake.
drop policy if exists login_events_insert on public.login_events;
create policy login_events_insert on public.login_events
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists login_events_select on public.login_events;
create policy login_events_select on public.login_events
  for select to authenticated
  using (public.is_admin() or auth_user_id = auth.uid());

-- ================================================================
-- SECTION 3/22: audit-log-migration.sql
-- ================================================================
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

-- ================================================================
-- SECTION 4/22: audit-log-fix-tgargc.sql
-- ================================================================
-- FIX: audit_log trigger function me "column tg_argc does not exist" error.
-- Run in: Supabase Dashboard -> SQL Editor.
--
-- KYA HUA:
--  Purane fn_audit_log() me `tg_argc` likha tha — PostgreSQL ka aisa variable
--  hi nahi hai (command-line args ki count ke liye TG_ARGV array hi use hoti
--  hai). Isliye trigger fire hote hi error aata tha aur wahi error save ko bhi
--  rok raha tha (invoice save fail).
--
-- YE FILE: sirf corrected function dobara bana hai (create or replace).
-- Triggers wahi rehte hain, data safe hai. SAFE TO RE-RUN.

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
  -- phir common columns. (TG_ARGC naam ka variable PostgreSQL me nahi hai.)
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

-- VERIFY: function ab corrected hai — koi bhi invoice save karke check karein,
-- error nahi aana chahiye aur phir:
--   select entity, entity_label, action, user_email, created_at
--     from audit_log order by created_at desc limit 10;

-- ================================================================
-- SECTION 5/22: item-master-migration.sql
-- ================================================================
-- Maruti Module Service: Item Master migration
-- Run once in Supabase SQL Editor. This script does not drop tables or delete data.

create table if not exists public.item_master (
  id bigint generated by default as identity primary key,
  item_code text,
  item_name text not null,
  category text not null default 'Other',
  unit text not null default 'PCS',
  purchase_price numeric(12,2) not null default 0 check (purchase_price >= 0),
  sale_price numeric(12,2) not null default 0 check (sale_price >= 0),
  opening_stock numeric(14,3) not null default 0 check (opening_stock >= 0),
  minimum_stock numeric(14,3) not null default 0 check (minimum_stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.item_master add column if not exists item_code text;
alter table public.item_master add column if not exists item_name text;
alter table public.item_master add column if not exists category text;
alter table public.item_master add column if not exists unit text;
alter table public.item_master add column if not exists purchase_price numeric(12,2);
alter table public.item_master add column if not exists sale_price numeric(12,2);
alter table public.item_master add column if not exists opening_stock numeric(14,3);
alter table public.item_master add column if not exists minimum_stock numeric(14,3);
alter table public.item_master add column if not exists active boolean;
alter table public.item_master add column if not exists created_at timestamptz;
alter table public.item_master add column if not exists updated_at timestamptz;

alter table public.item_master alter column category set default 'Other';
alter table public.item_master alter column unit set default 'PCS';
alter table public.item_master alter column purchase_price set default 0;
alter table public.item_master alter column sale_price set default 0;
alter table public.item_master alter column opening_stock set default 0;
alter table public.item_master alter column minimum_stock set default 0;
alter table public.item_master alter column active set default true;
alter table public.item_master alter column created_at set default now();
alter table public.item_master alter column updated_at set default now();

create sequence if not exists public.item_master_code_seq start with 1;

-- Continue the automatic ITM sequence after any existing ITM-00001-style codes.
select setval(
  'public.item_master_code_seq',
  coalesce(
    (select max(nullif(regexp_replace(item_code, '\\D', '', 'g'), '')::bigint)
       from public.item_master
      where item_code ~ '^ITM-[0-9]+$'),
    0
  ) + 1,
  false
);

create or replace function public.assign_item_master_code()
returns trigger
language plpgsql
as $$
begin
  if new.item_code is null or btrim(new.item_code) = '' then
    new.item_code := 'ITM-' || lpad(nextval('public.item_master_code_seq')::text, 5, '0');
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_assign_item_master_code on public.item_master;
create trigger trg_assign_item_master_code
before insert or update on public.item_master
for each row execute function public.assign_item_master_code();

create unique index if not exists item_master_item_code_unique
  on public.item_master (item_code) where item_code is not null;
create index if not exists item_master_item_name_idx on public.item_master (item_name);
create index if not exists item_master_category_idx on public.item_master (category);
create index if not exists item_master_active_idx on public.item_master (active);

-- Optional, but recommended if RLS is enabled and the existing app uses the anon key.
-- Adapt these policies to your authenticated-user model before using in production.
-- alter table public.item_master enable row level security;
-- create policy "item_master_read" on public.item_master for select to anon using (true);
-- create policy "item_master_write" on public.item_master for all to anon using (true) with check (true);

-- Stock rule for subsequent modules (do not update opening_stock after this migration):
-- available stock = opening_stock + purchase inward quantity - invoiced quantity.
-- Purchase / Invoice integration should use a stock movement ledger or a view built
-- after its final table schema is confirmed. This protects historical opening balances.

-- ================================================================
-- SECTION 6/22: item-master-cost-price-fix.sql
-- ================================================================
-- ============================================================================
-- item_master: missing cost_price column
-- Run ONCE in Supabase Dashboard -> SQL Editor.
--
-- WHY
--   src/pages/SalesReport.tsx:99  and  src/pages/NetProfitReport.tsx:50 both
--   fall back to reading item_master when the live `items` table is EMPTY:
--
--       supabase.from("item_master").select("... purchase_price, cost_price")
--
--   But public.item_master has NO cost_price column (see item-master-migration.sql).
--   PostgREST therefore rejects the whole SELECT with a 42703 error.
--
--   Today this is dormant: `items` holds 65 rows, so the fallback never runs.
--   The moment the tables are emptied (clean slate / re-import) the Net Profit
--   Report page throws "column item_master.cost_price does not exist" and the
--   page fails to load at all.
--
--   This adds the column so the legacy fallback path stays usable.
--   item_master is a mirror only — nothing reads it except these fallbacks,
--   so this is additive and touches no existing data.
-- ============================================================================

-- 1) Add the column if it is missing.
alter table public.item_master
  add column if not exists cost_price numeric(12,2);

-- 2) Seed it from the live items table so the fallback returns real numbers
--    instead of NULLs. Both tables share identical ids (mirrored on import).
update public.item_master im
   set cost_price = coalesce(i.cost_price, i.purchase_price, 0)
  from public.items i
 where i.id = im.id
   and (im.cost_price is null or im.cost_price <> coalesce(i.cost_price, i.purchase_price, 0));

-- 3) Confirm: 65 rows, no NULLs.
select count(*)                                          as item_master_rows,
       count(*) filter (where cost_price is null)         as null_cost_price,
       sum(cost_price)                                   as total_cost_price
  from public.item_master;

-- 4) Prove the exact query both pages use now succeeds.
select item_code, item_name, purchase_price, cost_price
  from public.item_master
 order by item_code
 limit 5;

commit;

-- ================================================================
-- SECTION 7/22: job-card-technicians-migration.sql
-- ================================================================
-- Maruti Module Service: Job Card worker assignment + worker share %
-- Run ONCE in the REAL database -> Supabase Dashboard -> SQL Editor.
--
-- WHY:
--  1. Salary report ko pata chalna chahiye ki kis job card par kaun kaam kiya.
--     Pehle `job_cards.technician` sirf EK naam (text) store karta tha, jo team
--     ko represent nahi kar sakta. Ab `job_card_technicians` se ek job card par
--     multiple workers tick ho sakte hain.
--  2. Worker ke naam aur unka Module Service % dono Technician Master
--     (`technicians` table) se aate hain — code me kuch hardcoded nahi hai.
--
-- CHUTTI: worker ko job card par tick NA karna hi "chutti" hai. Uska share
-- 0 ho jata hai aur baaki workers ko koi extra nahi milta (renormalize nahi hota).
--
-- This script is safe to re-run (idempotent). It does not drop tables or delete data.

-- ---------------------------------------------------------------------------
-- 1) Worker ka Module Service share % — Technician Master me dikhega
-- ---------------------------------------------------------------------------
alter table public.technicians
  add column if not exists share_percent numeric(5,2);

-- Pehle se maujood technicians me se unhe % do jinke naam aapne diye hain.
-- Agar aapne koi alag naam use kiya hai (jaise "Karan S."), to yahan unka
-- naam likh dijiye — kyunki Technician Master wahi source hai.
update public.technicians set share_percent = case lower(trim(name))
  when 'behra'   then 20
  when 'kalyani' then 20
  when 'karan'   then 27
  when 'mayur'   then 33
end
where lower(trim(name)) in ('behra', 'kalyani', 'karan', 'mayur')
  and share_percent is null;

-- Naye workers ko default 0 (matlab abhi salary share nahi).
update public.technicians set share_percent = 0 where share_percent is null;

-- ---------------------------------------------------------------------------
-- 2) Assignment table — one row per (job card, worker)
-- ---------------------------------------------------------------------------
create table if not exists public.job_card_technicians (
  id bigint generated always as identity primary key,
  job_card_id bigint not null references public.job_cards(id) on delete cascade,
  technician_id bigint not null references public.technicians(id) on delete cascade,
  technician_name text not null,
  created_at timestamptz not null default now()
);

-- Same worker ek hi job card par do baar na aaye.
create unique index if not exists job_card_technicians_unique
  on public.job_card_technicians (job_card_id, technician_id);

-- Salary report har job card ka assignment ek saath padhta hai.
create index if not exists job_card_technicians_job_idx
  on public.job_card_technicians (job_card_id);

-- ---------------------------------------------------------------------------
-- 3) Backfill — every EXISTING job card gets ALL share-bearing workers ticked
--    Purane job cards ka earning pehle wale fixed 20/20/27/33 jaisa hi rahega.
-- ---------------------------------------------------------------------------
insert into public.job_card_technicians (job_card_id, technician_id, technician_name)
select jc.id, t.id, t.name
from public.job_cards jc
cross join public.technicians t
where coalesce(t.share_percent, 0) > 0
on conflict (job_card_id, technician_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4) Row Level Security — same rule as every other table: only logged-in users.
-- ---------------------------------------------------------------------------
alter table public.job_card_technicians enable row level security;

drop policy if exists "rls_all_job_card_technicians" on public.job_card_technicians;
create policy "rls_all_job_card_technicians"
  on public.job_card_technicians
  for all to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 5) VERIFY — inhe execution ke baad alag se run karein
-- ---------------------------------------------------------------------------
-- A) Workers + unke % (yahi Salary menu ke cards banenge, isi naam se Job Card
--    ke checkbox bhi bante hain):
--   select id, name, share_percent, status from technicians
--   order by share_percent desc, name;
--
-- B) Jinke % 0 reh gaye — inhe Technician Master me % bharna hoga, warna
--    inki salary aur purane job cards ki entry dono nahi banegi:
--   select id, name, share_percent from technicians
--   where coalesce(share_percent, 0) = 0 order by name;
--
-- C) Total % 100 hona chahiye:
--   select sum(coalesce(share_percent, 0)) as total_share_percent from technicians;
--
-- D) Kitne job cards par kitne workers tick hain:
--   select cnt as workers_per_jobcard, count(*) as job_cards
--   from (
--     select job_card_id, count(*) cnt
--     from job_card_technicians group by job_card_id
--   ) x group by cnt order by cnt;
--
-- AGAR B me koi naam aaya (aapne alag spelling use ki hui hai), to uska %
-- Technician Master me set kar dein, phir `job-card-technicians-backfill.sql`
-- chalayein — poorane purane job cards ki entry wahin se ban jayegi.

-- ================================================================
-- SECTION 8/22: warranty-returns-migration.sql
-- ================================================================
-- Maruti Module Service: Warranty Return tracking
-- Run ONCE in the REAL database -> Supabase Dashboard -> SQL Editor.
--
-- WHY:
--  Job card par warranty_quantity se pata chalta hai kitne modules warranty me aaye
--  the, par KAUNSA module, KAB aaya (module par likhi hui date) aur KYU aaya —
--  ye kahin store nahi hota tha. `warranty_returns` me ek row = ek module.
--
--  Ek row per module isliye: har module par alag date likhi hoti hai, isliye
--  Working Day bhi har module ka alag hota hai.
--
-- SAFE TO RE-RUN (idempotent). Kuch data drop ya delete nahi karta.

-- ---------------------------------------------------------------------------
-- 1) Table
-- ---------------------------------------------------------------------------
create table if not exists public.warranty_returns (
  id bigint generated always as identity primary key,

  -- Kis job card se aaya. Job card delete hua to warranty row bhi chala jayega.
  job_card_id bigint not null references public.job_cards(id) on delete cascade,

  -- Neeche ke 3 fields SNAPSHOT hain (job card se copy), taaki baad me job card
  -- edit/delete hone par bhi purana warranty record waise hi dikhe rahe.
  job_no text not null,
  job_date date not null,
  customer_name text,

  -- Module par likhi hui date — manually entry karni hoti hai.
  warranty_module_date date not null,

  -- warranty_module_date - job_date (days). App bhi ye calculate karti hai, par
  -- save karte waqt likh dete hain taaki baad me date edit karne par report
  -- purana value na badal jaaye.
  working_days integer not null,

  return_reason text not null
    check (return_reason in (
      'A - Module Check And OK',
      'B - Customer Side Problem / Damage',
      'C - Our Side Problem'
    )),

  remark text,
  created_at timestamptz not null default now()
);

-- Pehle yahan CHECK tha ki warranty_module_date job_date se pehle nahi ho sakti.
-- Wo galat nikla: purane repair kiye modules warranty me wapas aate hain, to
-- module par likhi date (back date) hamesha nayi job card date se purani hoti hai.
-- Isliye constraint ab DROP hota hai (dobara run karne par bhi wapas nahi aayega).
alter table public.warranty_returns
  drop constraint if exists warranty_returns_date_order;

-- NOTE: (job_card_id, warranty_module_date) par UNIQUE index nahi hai, kyunki
-- ek hi batch me aaye modules par wahi date likhi ho sakti hai. Ye sirf plain
-- index hai — same date ki multiple entries allow hain (sirf reason alag hoga).

-- Job card wise pending count nikalna hai (warranty_quantity - logged).
create index if not exists warranty_returns_job_idx
  on public.warranty_returns (job_card_id);

-- Date range filter / month-wise reports ke liye.
create index if not exists warranty_returns_date_idx
  on public.warranty_returns (warranty_module_date);

-- ---------------------------------------------------------------------------
-- 2) Row Level Security — same rule as every other table: only logged-in users.
-- ---------------------------------------------------------------------------
alter table public.warranty_returns enable row level security;

drop policy if exists "rls_all_warranty_returns" on public.warranty_returns;
create policy "rls_all_warranty_returns"
  on public.warranty_returns
  for all to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3) VERIFY — iske baad alag se chalayein
-- ---------------------------------------------------------------------------
-- Table ban gayi?
--   select count(*) as rows_in_warranty_returns from warranty_returns;
--
-- Job cards jisme warranty quantity hai vs unme kitni entries ban hain:
--   select
--     jc.job_no,
--     jc.job_date,
--     jc.business_name,
--     coalesce(jc.warranty_quantity, 0) as warranty_qty,
--     count(wr.id) as entries_logged,
--     coalesce(jc.warranty_quantity, 0) - count(wr.id) as pending
--   from job_cards jc
--   left join warranty_returns wr on wr.job_card_id = jc.id
--   where coalesce(jc.warranty_quantity, 0) > 0
--   group by jc.id, jc.job_no, jc.job_date, jc.business_name, jc.warranty_quantity
--   order by jc.job_date desc;
--
-- `pending` negative aaye to us job card par entry zyada ban gayi hai —
-- Warranty menu me se ek delete kar dein.
-- ================================================================
-- SECTION 9/22: warranty-returns-drop-unique.sql
-- ================================================================
-- Maruti Module Service: warranty_returns unique index hatao
--
-- KYU:
--  Purana index `(job_card_id, warranty_module_date)` UNIQUE tha. Par ek hi
--  batch me aaye 11 modules par wahi date likhi ho sakti hai (aam baat hai) —
--  unique hone se doosri entry save hi nahi hoti thi. Ye galat restriction
--  thi, isliye ab plain index rakhte hain: same date ki multiple entries
--  allowed hain (sirf reason/remark alag hota hai).
--
-- SAFE TO RE-RUN (idempotent).
--
-- Ye sirf wahi karta hai jo purani `warranty-returns-migration.sql` me bana tha.
-- Naya install ho to seedhi `warranty-returns-migration.sql` chalayein, ye
-- alag se chahiye hi nahi.

drop index if exists public.warranty_returns_unique;

-- Ab ye index bachega (data delete nahi hota, sirf constraint hat-ta hai):
create index if not exists warranty_returns_job_date_idx
  on public.warranty_returns (job_card_id, warranty_module_date);

-- ---------------------------------------------------------------------------
-- VERIFY — `warranty_returns_unique` list me nahi aana chahiye, aur
-- `warranty_returns_job_date_idx` aana chahiye.
--
-- NOTE: `pg_indexes` me `is_unique` column hota hi nahi (wahi error aata hai),
-- isliye yahan `indexdef` se uniqueness dekhna padta hai — `CREATE UNIQUE INDEX`
-- me UNIQUE likha hota hai.
-- ---------------------------------------------------------------------------
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'warranty_returns'
order by indexname;

-- Aur ek seedha PASS/FAIL, taaki interpretation me confusion na ho:
--
--   'OK'  -> unique index nahi bacha, normal index bana hua hai
--   'FAIL'-> abhi bhi koi UNIQUE index pada hua hai (same date ki do entry
--             phir bhi block hogi)
select case
         when exists (
           select 1 from pg_indexes
            where schemaname = 'public'
              and tablename = 'warranty_returns'
              and indexdef ilike '%unique%'
         )
           then 'FAIL - abhi bhi UNIQUE index mojood hai'
         when exists (
           select 1 from pg_indexes
            where schemaname = 'public'
              and tablename = 'warranty_returns'
              and indexname = 'warranty_returns_job_date_idx'
         )
           then 'OK - same-date ki multiple entries allowed hain'
         else 'FAIL - warranty_returns_job_date_idx bhi nahi bana'
       end as same_date_duplicates_allowed;
-- ================================================================
-- SECTION 10/22: warranty-allow-backdate-migration.sql
-- ================================================================
-- Warranty: back date allow karo
-- Run in: Supabase Dashboard -> SQL Editor.
--
-- Purana CHECK constraint `warranty_returns_date_order` warranty_module_date ko
-- job_date se pehle nahi hone deta tha. Wo constraint hataana zaroori hai kyunki
-- purane repair kiye modules warranty me wapas aate hain — module par likhi date
-- (back date) hamesha nayi job card date se purani hoti hai.
--
-- App (frontend) pehle se back date allow kar chuki hai; ye SQL sirf database
-- ka purana rok hatata hai. Existing data par koi asar nahi.
--
-- SAFE TO RE-RUN.

alter table public.warranty_returns
  drop constraint if exists warranty_returns_date_order;

-- Verify: constraint gayab hona chahiye (0 rows).
select conname
from pg_constraint
where conrelid = 'public.warranty_returns'::regclass
  and conname = 'warranty_returns_date_order';

-- ================================================================
-- SECTION 11/22: bank-accounts-migration.sql
-- ================================================================
-- Maruti Module Service: Multiple Bank / Cash Accounts + Cash Book
-- Run ONCE in Supabase Dashboard -> SQL Editor.
--
-- Problem: `bank_transactions` ek hi pool hai. Cash, HDFC, SBI, UPI — sab ek
-- me mix. Isliye month-end par pata hi nahi chalta ki cash box me kitna hai aur
-- bank me kitna.
--
-- Fix:
--   1. Naya table `bank_accounts` (Bank / Cash / UPI types ke saath).
--   2. `bank_transactions.account_id` — har transaction kis account se hua.
--   3. `is_transfer` + `transfer_to_account_id` — apne account se dusre account
--      me paisa transfer. Ye income/expense NAHI hai, isliye reports me exclude
--      hota hai (warna cash->bank transfer ek "expense" ban jayega).
--   4. Purane transactions backfill — koi row gaayab nahi hoga.
--
-- Ye script idempotent hai. Dobara chalane par koi duplicate account nahi banta.

-- ---------------------------------------------------------------------------
-- 1) bank_accounts table
-- ---------------------------------------------------------------------------
create table if not exists public.bank_accounts (
  id               bigint generated by default as identity primary key,
  company_id       bigint not null default 1,
  name             text not null,
  account_type     text not null default 'Bank'
                     check (account_type in ('Bank', 'Cash', 'UPI')),
  bank_name        text,
  account_no       text,
  opening_balance  numeric(14,2) not null default 0,
  is_default       boolean not null default false,
  active           boolean not null default true,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now()
);

comment on table public.bank_accounts is
  'Bank / Cash / UPI accounts. bank_transactions.account_id isse linked hai.';

create index if not exists bank_accounts_company_idx
  on public.bank_accounts (company_id, active);

-- (company_id, name) UNIQUE — ye zaroori hai, warna `on conflict do nothing`
-- kabhi trigger hi nahi hota aur har run par duplicate accounts ban jate hain.
-- Agar pehle se duplicate ban chuke hon to constraint add nahi hoga (unhe
-- `bank-accounts-cleanup.sql` se saaf karein).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bank_accounts_company_name_key'
  ) and not exists (
    select 1 from public.bank_accounts
     group by company_id, name having count(*) > 1
  ) then
    alter table public.bank_accounts
      add constraint bank_accounts_company_name_key unique (company_id, name);
  end if;
end
$$;

-- Ek company me sirf ek default account.
create unique index if not exists bank_accounts_single_default_idx
  on public.bank_accounts (company_id)
  where is_default;

-- ---------------------------------------------------------------------------
-- 2) bank_transactions me naye columns
-- ---------------------------------------------------------------------------
alter table public.bank_transactions
  add column if not exists account_id bigint;

alter table public.bank_transactions
  add column if not exists is_transfer boolean not null default false;

alter table public.bank_transactions
  add column if not exists transfer_to_account_id bigint;

create index if not exists bank_transactions_account_idx
  on public.bank_transactions (company_id, account_id);

create index if not exists bank_transactions_account_date_idx
  on public.bank_transactions (account_id, transaction_date);

-- ---------------------------------------------------------------------------
-- 3) Har company ke liye default accounts banao
--
--    "Bank / General (Old Pool)"  -> saara purana data yahan jaayega.
--                                   opening_balance = 0 rakhna zaroori hai taaki
--                                   per-account running balance purane global
--                                   running balance ke BARABAR rahe (discontinuity nahi).
--    "Cash Box"                    -> naya cash book yahan chalega.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company record;
  v_pool_id bigint;
begin
  for v_company in
    select id from public.companies order by id
  loop
    -- Purana single pool is company ke liye bana do (agar pehle se hai to reuse).
    insert into public.bank_accounts
      (company_id, name, account_type, opening_balance, is_default, active, sort_order)
    values
      (v_company.id, 'Bank / General (Old Pool)', 'Bank', 0, false, true, 0)
    on conflict do nothing;

    select id into v_pool_id
      from public.bank_accounts
     where company_id = v_company.id
       and name = 'Bank / General (Old Pool)';

    -- Cash Box (roz ka cash in/out).
    insert into public.bank_accounts
      (company_id, name, account_type, opening_balance, is_default, active, sort_order)
    values
      (v_company.id, 'Cash Box', 'Cash', 0, false, true, 1)
    on conflict do nothing;

    -- Default account = Old Pool, taaki naye manual entries continuity rakhein.
    update public.bank_accounts
       set is_default = false
     where company_id = v_company.id;

    update public.bank_accounts
       set is_default = true
     where id = v_pool_id;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 4) Backfill: account_id NULL wale saare purane transactions pool me jaayen
-- ---------------------------------------------------------------------------
update public.bank_transactions bt
   set account_id = a.id
  from public.bank_accounts a
 where a.company_id = bt.company_id
   and a.name = 'Bank / General (Old Pool)'
   and bt.account_id is null;

-- ---------------------------------------------------------------------------
-- 5) RLS — bank_accounts ko bhi wahi treatment jo bank_transactions ko hai
-- ---------------------------------------------------------------------------
alter table public.bank_accounts enable row level security;

drop policy if exists "rls_all_bank_accounts" on public.bank_accounts;
create policy "rls_all_bank_accounts" on public.bank_accounts
  for all to authenticated using (true) with check (true);

grant usage on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- 6) VERIFY — iske baad ye chalayein aur output bhejein
-- ---------------------------------------------------------------------------
-- 6a) Accounts dikhne chahiye, aur har transaction ka account_id set hona chahiye:
select a.company_id,
       a.id,
       a.name,
       a.account_type,
       a.opening_balance,
       a.is_default,
       (select count(*) from public.bank_transactions bt
         where bt.account_id = a.id) as txn_count
  from public.bank_accounts a
 order by a.company_id, a.sort_order, a.id;

-- 6b) Yeh COUNT 0 hona chahiye. Agar 0 se zyada hai to koi transaction
--     orphan hai aur wo kisi account view me nahi dikhega:
select count(*) as transactions_without_account
  from public.bank_transactions
 where account_id is null;

-- 6c) Total value cross-check: per-account balance ka total, purane global
--     running balance ke barabar hona chahiye:
select round(sum(coalesce(a.opening_balance, 0)
                 + coalesce(in_.total_in, 0)
                 - coalesce(out_.total_out, 0)), 2) as all_accounts_balance
  from public.bank_accounts a
  left join (
    select account_id, sum(coalesce(payment_in, credit_amount, 0)) as total_in
      from public.bank_transactions group by account_id
  ) in_ on in_.account_id = a.id
  left join (
    select account_id, sum(coalesce(payment_out, debit_amount, 0)) as total_out
      from public.bank_transactions group by account_id
  ) out_ on out_.account_id = a.id;

-- ================================================================
-- SECTION 12/22: bank-reconciliation-migration.sql
-- ================================================================
-- ============================================================================
-- bank-reconciliation-migration.sql
--
-- Bank Reconciliation: aapki books vs bank statement.
--
--   * `bank_statement_batches` — ek statement import (account + period).
--   * `bank_statement_lines`   — statement ki har line, uska auto/manual match.
--
-- MATCH KA MODEL (simple aur hamesha sahi):
--   * Matched      : line.matched_transaction_id set hai
--   * Only in bank : line.matched_transaction_id null hai, is_ignored false
--   * Only in books: koi bank_transactions row jisse koi line match nahi hui
--   * Pending      : wahi only-in-books row jiska payment_mode = 'Cheque'
--
-- Isliye results persist karne ki alag table ki zaroorat nahi — match state
-- lines par hi rehti hai, aur unmatched books rows har baar live nikalte hain.
-- Statement dobara paste nahi karni padti (audit trail bhi bacha rehta hai).
--
-- Run ONCE: Supabase Dashboard -> SQL Editor.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) batches
-- ---------------------------------------------------------------------------
create table if not exists public.bank_statement_batches (
  id                        bigint generated by default as identity primary key,
  company_id                bigint not null default 1,
  account_id                bigint not null
                              references public.bank_accounts(id) on delete cascade,
  label                     text,
  period_from               date,
  period_to                 date,
  source                    text not null default 'paste'
                              check (source in ('paste','csv','sbi','bank_export','cash_count')),
  statement_closing_balance numeric(14,2),
  line_count                integer not null default 0,
  created_at                timestamptz not null default now()
);

comment on table public.bank_statement_batches is
  'Ek bank-statement import (account + period). Lines bank_statement_lines me hain.';

create index if not exists bank_statement_batches_company_idx
  on public.bank_statement_batches (company_id, account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 2) statement lines
-- ---------------------------------------------------------------------------
create table if not exists public.bank_statement_lines (
  id                       bigint generated by default as identity primary key,
  company_id               bigint not null default 1,
  batch_id                 bigint not null
                             references public.bank_statement_batches(id) on delete cascade,
  account_id               bigint not null
                             references public.bank_accounts(id) on delete cascade,
  seq                      integer not null default 0,
  txn_date                 date,
  description              text,
  debit                    numeric(14,2) not null default 0,
  credit                   numeric(14,2) not null default 0,
  balance                  numeric(14,2),
  raw_text                 text,

  -- Match state (yahi persist hota hai)
  -- FK constraint 3) me add hoti hai (bank_transactions.id ka type check karke)
  matched_transaction_id   bigint,
  is_ignored               boolean not null default false,
  note                     text,

  created_at               timestamptz not null default now()
);

comment on column public.bank_statement_lines.matched_transaction_id is
  'Auto-match ke waqt set hota hai; user manually bhi set/undo kar sakta hai.';
comment on column public.bank_statement_lines.is_ignored is
  'True = user ne kaha "ye line ki zaroorat nahi" (jaise bank charges jo books me hain hi nahi).';

create index if not exists bank_statement_lines_batch_idx
  on public.bank_statement_lines (batch_id, seq);
create index if not exists bank_statement_lines_company_idx
  on public.bank_statement_lines (company_id, account_id);
create index if not exists bank_statement_lines_match_idx
  on public.bank_statement_lines (matched_transaction_id)
  where matched_transaction_id is not null;

-- Ek transaction par sirf ek line match ho — warna dobara match hoga.
create unique index if not exists bank_statement_lines_one_match_idx
  on public.bank_statement_lines (company_id, matched_transaction_id)
  where matched_transaction_id is not null;

-- ---------------------------------------------------------------------------
-- 3) FK -> bank_transactions(id)  (type match ho tabhi, warna skip)
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'bank_transactions'
      and column_name = 'id' and data_type = 'bigint'
  ) then
    alter table public.bank_statement_lines
      add constraint bank_statement_lines_txn_fk
      foreign key (matched_transaction_id)
      references public.bank_transactions(id) on delete set null;
    raise notice 'FK added: bank_statement_lines.matched_transaction_id -> bank_transactions(id)';
  else
    raise notice 'SKIP FK: bank_transactions.id type bigint nahi hai (check karein).';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) RLS — same pattern as bank_accounts
-- ---------------------------------------------------------------------------
alter table public.bank_statement_batches enable row level security;
drop policy if exists "rls_all_bank_statement_batches" on public.bank_statement_batches;
create policy "rls_all_bank_statement_batches" on public.bank_statement_batches
  for all to authenticated using (true) with check (true);

alter table public.bank_statement_lines enable row level security;
drop policy if exists "rls_all_bank_statement_lines" on public.bank_statement_lines;
create policy "rls_all_bank_statement_lines" on public.bank_statement_lines
  for all to authenticated using (true) with check (true);

grant usage on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- 5) VERIFY
-- ---------------------------------------------------------------------------
select 'bank_statement_batches' as table_name, count(*) as rows from public.bank_statement_batches
union all
select 'bank_statement_lines', count(*) from public.bank_statement_lines;

-- ================================================================
-- SECTION 13/22: opening-balances-migration.sql
-- ================================================================
-- =============================================================================
-- OPENING BALANCES TABLE  (Financial Year rollover + first-time setup)
-- =============================================================================
-- Standard accounting software (Tally / Busy / Vyapar) me har nayi FY ke shuru
-- me pichle saal ka closing balance "Balance b/f" (brought forward) naye saal ke
-- opening me aa jata hai. Ye table wahi kaam karti hai.
--
-- ROW TYPES (column `kind`):
--   'stock'     -> item-wise opening stock (quantity + rate)
--   'bank'      -> bank balance b/f
--   'cash'      -> cash in hand b/f
--   'customer'  -> purana receivable (customer ka baki)
--   'vendor'    -> purana payable (supplier ko dena hai)
--
-- Is table se reports me:
--   Outstanding = opening(customer) + current FY invoices - receipts
--   Bank bal.   = opening(bank)    + all money IN - all money OUT
--   Stock       = opening(stock qty) + inward - outward
--
-- Run ONCE in Supabase Dashboard -> SQL Editor.
-- =============================================================================

create table if not exists public.opening_balances (
  id           bigserial primary key,
  fy_label     text        not null,          -- '2026-27'
  kind         text        not null,          -- stock | bank | cash | customer | vendor
  item_id      bigint,                         -- kind='stock' ke liye
  item_code    text,
  item_name    text,
  inward_no    text,                          -- stock batch reference (optional)
  party_id     bigint,                         -- kind='customer'/'vendor' ke liye
  party_name   text,
  quantity     numeric(18,3) default 0,       -- stock qty
  rate         numeric(18,3) default 0,       -- stock rate
  amount       numeric(18,2) default 0,       -- bank/cash/customer/vendor amount
  note         text,
  created_at   timestamptz default now()
);

create index if not exists opening_balances_fy_idx   on public.opening_balances (fy_label);
create index if not exists opening_balances_kind_idx on public.opening_balances (kind);
create unique index if not exists opening_balances_stock_uniq
  on public.opening_balances (fy_label, coalesce(inward_no, ''), lower(coalesce(item_name, '')));

-- RLS (same policy style as the rest of the project)
alter table public.opening_balances enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'opening_balances'
                 and policyname = 'opening_balances_all') then
    create policy opening_balances_all on public.opening_balances
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'opening_balances'
                 and policyname = 'opening_balances_anon') then
    create policy opening_balances_anon on public.opening_balances
      for all to anon using (true) with check (true);
  end if;
end $$;

grant select, insert, update, delete on public.opening_balances to authenticated;
grant select, insert, update, delete on public.opening_balances to anon;
grant usage, select on sequence public.opening_balances_id_seq to authenticated, anon;

-- -----------------------------------------------------------------------------
-- FY rollover: pichle FY ka closing balance naye FY me opening b/f kar do.
--   p_from_fy : jis FY se carry forward karna hai  (e.g. '2026-27')
--   p_to_fy   : nayi FY                            (e.g. '2027-28')
-- Safe to re-run: pehle se maujood rows replace ho jati hain.
-- -----------------------------------------------------------------------------
create or replace function public.rollover_opening_balances(
  p_from_fy text,
  p_to_fy   text,
  p_bank_closing numeric default null,   -- null = apne aap nikalega
  p_cash_closing numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bank numeric;
  v_cash numeric;
begin
  -- closing nikalna: pichle FY ki entries ka net
  select coalesce(sum(coalesce(payment_in, 0) - coalesce(payment_out, 0)), 0)
    into v_bank
    from public.bank_transactions
   where transaction_date >= (left(p_from_fy, 4) || '-04-01')::date
     and transaction_date <= ((left(p_from_fy, 4)::int + 1) || '-03-31')::date;

  select coalesce(v_bank, 0)
         + coalesce((select sum(amount) from public.opening_balances
                      where fy_label = p_from_fy and kind = 'bank'), 0)
   into v_bank;

  v_cash := coalesce(p_cash_closing, 0);
  v_bank := coalesce(p_bank_closing, v_bank);

  delete from public.opening_balances where fy_label = p_to_fy;

  -- customer receivable b/f
  insert into public.opening_balances (fy_label, kind, party_name, amount, note)
  select p_to_fy, 'customer', c.customer_name, sum(t.pending)::numeric,
         'Balance b/f from FY ' || p_from_fy
    from (
      -- pending per customer, from invoices
      select inv.customer_id, sum(inv.total_amount) as pending
        from public.invoices inv
       where inv.invoice_date >= (left(p_from_fy, 4) || '-04-01')::date
         and inv.invoice_date <= ((left(p_from_fy, 4)::int + 1) || '-03-31')::date
       group by inv.customer_id
    ) t
    join public.customers c on c.id = t.customer_id
   group by c.customer_name;

  -- bank + cash b/f
  insert into public.opening_balances (fy_label, kind, party_name, amount, note)
  values (p_to_fy, 'bank', 'Bank Balance b/f', round(v_bank, 2), 'Balance b/f from FY ' || p_from_fy),
         (p_to_fy, 'cash', 'Cash in Hand b/f', round(v_cash, 2), 'Balance b/f from FY ' || p_from_fy);

  return jsonb_build_object('success', true, 'fy', p_to_fy, 'bank_opening', round(v_bank, 2));
end;
$$;

grant execute on function public.rollover_opening_balances(text, text, numeric, numeric) to authenticated;
grant execute on function public.rollover_opening_balances(text, text, numeric, numeric) to anon;

-- ================================================================
-- SECTION 14/22: print-serial-terms-migration.sql
-- ================================================================
-- Maruti Module Service: Print serial numbers + Terms & Conditions migration
-- Run once in Supabase SQL Editor. This script does not drop tables or delete data.

-- 1) Receipt / Payment serial numbers (RC-2026-0001, PM-2026-0001) stored on each
--    bank_transactions row so Print Center can print with the same number.
alter table public.bank_transactions add column if not exists transaction_no text;

-- 2) Editable Terms & Conditions tied to company settings.
--    PO (Purchase Order) -> po_terms, Sales Invoice -> sales_terms
alter table public.company_settings add column if not exists po_terms text;
alter table public.company_settings add column if not exists sales_terms text;

create index if not exists bank_transactions_transaction_no_idx
  on public.bank_transactions (transaction_no);
-- ================================================================
-- SECTION 15/22: purchase-status-default-migration.sql
-- ================================================================
-- Maruti Module Service: Unify purchase payment status
-- Run ONCE in Supabase Dashboard -> SQL Editor.
-- Makes purchases.status default to 'Pending' so Purchase Report and
-- Payments Ledger always show the same financial result.

alter table public.purchases alter column status set default 'Pending';

-- Backfill any rows that still have no status (treat as pending/unpaid).
update public.purchases
  set status = 'Pending'
  where status is null or status = '';
-- ================================================================
-- SECTION 16/22: payment-details-bounce-migration.sql
-- ================================================================
-- ============================================================
-- Payment Details (Cheque no/date + UTR) aur Bounce / Return
-- ------------------------------------------------------------
-- Run: Supabase SQL Editor me ye poora file paste karke run karein.
--
-- 1. bank_transactions me 5 naye columns:
--    cheque_no / cheque_date  -> Cheque payment ka proof
--    utr_no                   -> UPI/NEFT/IMPS/RTGS reference (sabse important proof)
--    bounce_reason            -> dishonour ka karan
--    bounced_at               -> NON-NULL = payment bounce/return ho chuka.
--                                Aisa row paisa bank se bahar nahi gaya —
--                                balance, expense, profit aur bill
--                                allocation SABKI calculation se exclude hota hai.
-- 2. Bounced rows par fast partial index.
-- ============================================================

alter table public.bank_transactions
  add column if not exists cheque_no text,
  add column if not exists cheque_date date,
  add column if not exists utr_no text,
  add column if not exists bounce_reason text,
  add column if not exists bounced_at timestamptz;

comment on column public.bank_transactions.cheque_no   is 'Cheque number (payment proof)';
comment on column public.bank_transactions.cheque_date is 'Cheque date';
comment on column public.bank_transactions.utr_no      is 'UTR / UPI ref no (bank transfer proof)';
comment on column public.bank_transactions.bounce_reason is 'Cheque bounce / payment return ka karan';
comment on column public.bank_transactions.bounced_at  is 'Non-null = bounced/returned. Paisa nahi gaya — totals aur bill allocation se exclude karo.';

create index if not exists bank_transactions_bounced_idx
  on public.bank_transactions (company_id, bounced_at)
  where bounced_at is not null;

-- RLS: bank_transactions par pehle se policies hain (authenticated ALL),
-- naye columns unke under hi aate hain — koi nayi policy zaroori nahi.

select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'bank_transactions'
  and column_name in ('cheque_no', 'cheque_date', 'utr_no', 'bounce_reason', 'bounced_at')
order by column_name;

-- ================================================================
-- SECTION 17/22: invoice-items-inward-no-migration.sql
-- ================================================================
-- Maruti Module Service: invoice item source / inward reference
-- Run once in Supabase SQL Editor. It only adds a missing column; no data is deleted.

alter table public.invoice_items
  add column if not exists inward_no text;

create index if not exists invoice_items_inward_no_idx
  on public.invoice_items (inward_no);

-- ================================================================
-- SECTION 18/22: payment-allocations-migration.sql
-- ================================================================
-- ── payment_allocations ──────────────────────────────────────────────────────
-- Payment ↔ bill linkage ka permanent source of truth.
--
-- Pehle ye hisaab `bank_transactions.particulars` ke andar text me rakha jata
-- tha ("INV-001: 500.00, INW-3: 1200.00"). Text edit/cut ho jaaye, invoice ka
-- number badal jaaye ya row delete ho jaaye — allocation chup-chaap galat ho
-- jaati thi. Ab har payment ki har bill ke liye yahan ek alag line hogi.
--
-- Chalane ka tareeka: Supabase Dashboard → SQL Editor → ye file paste → Run.
-- Ye file idempotent hai (do baar chalane par kuch nahi bigadta). Run karne se
-- PEHLE app kuch nahi badlega: screens purane text-parse par hi chalte rahengi
-- (fallback), nayi entries par table rows banna shuru honge, aur ek-time
-- backfill purane vouchers ki lines yahan copy kar dega.
--
-- Notes:
--   * RLS enable rehta hai (project setting se nayi table default RLS-on banti
--     hai) + `rls-enable-migration.sql` wala hi policy — logged-in user ko full
--     access, bina login ke kuch nahi. Policy na ho to PostgREST 403 deta hai.
--   * bank_transactions se FK nahi lagaya — id ka type mismatch hone ka khatra
--     hai; app delete ke waqt khud is table ki rows hata deta hai.
--   * invoice_id / purchase_id par FK nahi: invoice delete ho to payment ki
--     line history me bachi rahe (read par wo line skip ho jaati hai).

create table if not exists payment_allocations (
  id bigserial primary key,
  company_id bigint not null default 1,
  bank_transaction_id bigint not null,
  invoice_id bigint,
  purchase_id bigint,
  amount numeric(12, 2) not null default 0,
  deduction numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  constraint payment_allocations_one_side_ck check (
    (invoice_id is not null and purchase_id is null) or
    (purchase_id is not null and invoice_id is null)
  )
);

create index if not exists payment_allocations_txn_idx
  on payment_allocations (bank_transaction_id);
create index if not exists payment_allocations_invoice_idx
  on payment_allocations (invoice_id);
create index if not exists payment_allocations_purchase_idx
  on payment_allocations (purchase_id);
create index if not exists payment_allocations_company_idx
  on payment_allocations (company_id);

-- RLS: logged-in (authenticated) users ko full access — baaki
-- supabase/rls-enable-migration.sql tables ke same pattern se.
alter table payment_allocations enable row level security;

drop policy if exists "rls_all_payment_allocations" on public.payment_allocations;
create policy "rls_all_payment_allocations" on public.payment_allocations
  for all to authenticated using (true) with check (true);

-- ================================================================
-- SECTION 19/22: fy-numbering-migration.sql
-- ================================================================
-- Financial Year (FY) numbering — India standard: 1 April to 31 March.
-- Run ONCE in Supabase Dashboard -> SQL Editor.
--
-- WHAT THIS CHANGES
--   Invoice numbering now keys off the FINANCIAL YEAR START year instead of the
--   calendar year. The series runs continuously through the whole FY and RESETS
--   on 1 April, exactly like Tally / Busy / Vyapar.
--
--     01-04-2026 .. 31-03-2027  ->  INV-2026-0001, INV-2026-0002, ... INV-2026-0012
--     01-04-2027 .. 31-03-2028  ->  INV-2027-0001, INV-2027-0002, ...
--
--   The NUMBER FORMAT is unchanged (INV-<4 digits>-<4 digits>), so every
--   receipt/payment that links to an invoice by matching the invoice number
--   inside its particulars text keeps working. No existing data is modified.
--
--   Everything else in the function (edit-mode payment block, stock restore,
--   duplicate job-card block, job-card close) is IDENTICAL to before.

create or replace function public.save_invoice_atomic(
  p_mode text,                  -- 'create' | 'edit'
  p_editing_invoice_id bigint default null,
  p_invoice_date date default null,
  p_customer_id bigint default null,
  p_job_card_id bigint default null,
  p_invoice_type text default 'Direct',
  p_total_amount numeric default 0,
  p_lines jsonb default '[]',           -- [{inward_no,item_id,item_name,quantity,rate,total,cost_rate,source}]
  p_old_items jsonb default '[]'        -- edit mode only: [{item_id,quantity}] to restore stock
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id bigint;
  v_invoice_no text;
  v_fy_year int;
  v_max_no int;
  v_existing int;
  v_current_total numeric;
  v_diff numeric;
  v_line record;
  v_old_line record;
begin
  -- CREATE mode: block duplicate invoice for the same job card
  if p_mode = 'create' and p_job_card_id is not null then
    select count(*) into v_existing
      from public.invoices where job_card_id = p_job_card_id;
    if v_existing > 0 then
      raise exception 'Is Job Card ke liye invoice pehle se bana hua hai. Duplicate invoice block kiya gaya.';
    end if;
  end if;

  if p_mode = 'edit' then
    -- Block editing an invoice that already has a payment/receipt against it
    select invoice_no
      into v_invoice_no
      from public.invoices where id = p_editing_invoice_id;

    if v_invoice_no is not null and exists (
      select 1 from public.bank_transactions
       where particulars ilike '%' || v_invoice_no || '%'
          or notes ilike '%' || v_invoice_no || '%'
    ) then
      raise exception 'Is invoice ka payment ho chuka hai, update allowed nahi hai!';
    end if;

    -- Fetch current total for the bank-amount diff
    select coalesce(total_amount, 0)
      into v_current_total
      from public.invoices where id = p_editing_invoice_id;

    -- 1) Restore old stock
    for v_old_line in
      select * from jsonb_to_recordset(coalesce(p_old_items, '[]'::jsonb))
        as x(item_id bigint, quantity numeric)
    loop
      if v_old_line.item_id is not null then
        -- NOTE: `items` is the LIVE item table (Item Master, Stock Report and
        -- Invoices all read this one). The function used to write to the legacy
        -- `item_master` table, so those stock updates were silently ignored.
        update public.items
           set opening_stock = coalesce(opening_stock, 0) + coalesce(v_old_line.quantity, 0)
         where id = v_old_line.item_id;
      end if;
    end loop;

    -- 2) Delete old item lines
    delete from public.invoice_items where invoice_id = p_editing_invoice_id;

    -- 3) Update invoice header
    update public.invoices
       set invoice_date = p_invoice_date,
           customer_id = p_customer_id,
           job_card_id = case when p_invoice_type = 'Job Card' then p_job_card_id else null end,
           invoice_type = p_invoice_type,
           total_amount = p_total_amount
     where id = p_editing_invoice_id;

    v_invoice_id := p_editing_invoice_id;

    -- 4) Adjust the auto-created bank row amount by the difference
    v_diff := p_total_amount - v_current_total;
    if v_diff <> 0 and v_invoice_no is not null then
      update public.bank_transactions
         set amount = coalesce(amount, 0) + v_diff,
             payment_in = coalesce(payment_in, 0) + v_diff
       where particulars ilike '%' || v_invoice_no || '%'
          or notes ilike '%' || v_invoice_no || '%';
    end if;
  else
    -- CREATE mode: next invoice number for the FINANCIAL YEAR
    -- FY start year: Apr..Dec -> same year, Jan..Mar -> year - 1
    v_fy_year := extract(year from p_invoice_date)::int;
    if extract(month from p_invoice_date) < 4 then
      v_fy_year := v_fy_year - 1;
    end if;

    select coalesce(max(case
                 when substring(trim(invoice_no) from '[0-9]+$') ~ '^[0-9]+$'
                 then substring(trim(invoice_no) from '[0-9]+$')::int
                 else 0 end), 0)
      into v_max_no
      from public.invoices
     where invoice_no like 'INV-' || v_fy_year || '-%';

    v_invoice_no := 'INV-' || v_fy_year || '-' || lpad((v_max_no + 1)::text, 4, '0');

    insert into public.invoices (invoice_no, invoice_date, customer_id, job_card_id, invoice_type, total_amount)
    values (v_invoice_no, p_invoice_date, p_customer_id,
            case when p_invoice_type = 'Job Card' then p_job_card_id else null end,
            p_invoice_type, p_total_amount)
    returning id into v_invoice_id;
  end if;

  -- 5) Insert item lines + deduct spare-part/stock
  for v_line in
    select * from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
      as x(inward_no text, item_id bigint, item_name text, quantity numeric,
           rate numeric, total numeric, cost_rate numeric, source text)
  loop
    insert into public.invoice_items
      (invoice_id, inward_no, item_id, item_name, quantity, rate, total, cost_rate)
    values
      (v_invoice_id, v_line.inward_no,
       case when v_line.source = 'Spare Part' then null else v_line.item_id end,
       v_line.item_name, v_line.quantity, v_line.rate, v_line.total, v_line.cost_rate);

    if v_line.item_id is not null and v_line.source <> 'Spare Part' then
      -- Same single-source fix: deduct from the live `items` table.
      update public.items
         set opening_stock = greatest(0, coalesce(opening_stock, 0) - coalesce(v_line.quantity, 0))
       where id = v_line.item_id;
    end if;
  end loop;

  -- 6) Close job card only when creating a new invoice
  if p_mode = 'create' and p_invoice_type = 'Job Card' and p_job_card_id is not null then
    update public.job_cards
       set status = 'Closed', invoice_id = v_invoice_id
     where id = p_job_card_id;
  end if;

  return jsonb_build_object('invoice_id', v_invoice_id, 'invoice_no', v_invoice_no);
end;
$$;

grant execute on function public.save_invoice_atomic(text, bigint, date, bigint, bigint, text, numeric, jsonb, jsonb) to authenticated;
grant execute on function public.save_invoice_atomic(text, bigint, date, bigint, bigint, text, numeric, jsonb, jsonb) to anon;

-- ---------------------------------------------------------------------------
-- Financial year helper: fy_of_date('2026-09-27') -> 2026-27 / 2026-04-01 .. 2027-03-31
-- ---------------------------------------------------------------------------
create or replace function public.fy_of_date(p_date date)
returns table (start_year int, end_year int, label text, fy_from date, fy_to date)
language sql
immutable
as $$
  select
    case when extract(month from p_date) < 4
         then extract(year from p_date)::int - 1
         else extract(year from p_date)::int end,
    case when extract(month from p_date) < 4
         then extract(year from p_date)::int
         else extract(year from p_date)::int + 1 end,
    case when extract(month from p_date) < 4
         then (extract(year from p_date)::int - 1)::text || '-' ||
              lpad((extract(year from p_date)::int % 100)::text, 2, '0')
         else extract(year from p_date)::text || '-' ||
              lpad(((extract(year from p_date)::int + 1) % 100)::text, 2, '0') end,
    make_date(case when extract(month from p_date) < 4
                   then extract(year from p_date)::int - 1
                   else extract(year from p_date)::int end, 4, 1),
    make_date(case when extract(month from p_date) < 4
                   then extract(year from p_date)::int
                   else extract(year from p_date)::int + 1 end, 3, 31);
$$;

grant execute on function public.fy_of_date(date) to authenticated;
grant execute on function public.fy_of_date(date) to anon;

-- ================================================================
-- SECTION 20/22: company-aware-invoice-rpc.sql
-- ================================================================
-- ============================================================================
-- Company-aware invoice RPCs
-- ============================================================================
-- save_invoice_atomic / delete_invoice_atomic me company_id add kiya gaya hai.
-- Ab invoice number bhi company ke apne prefix se banega (per-company series).
-- Purane 9-argument calls bhi chale rahenge (p_company_id ka default hai).

drop function if exists public.save_invoice_atomic(text, bigint, date, bigint, bigint, text, numeric, jsonb, jsonb);
drop function if exists public.delete_invoice_atomic(bigint);

-- ---------------------------------------------------------------------------
create or replace function public.save_invoice_atomic(
  p_mode               text,
  p_editing_invoice_id bigint,
  p_invoice_date       date,
  p_customer_id        bigint,
  p_job_card_id        bigint,
  p_invoice_type       text,
  p_total_amount       numeric,
  p_lines              jsonb,
  p_old_items          jsonb,
  p_company_id         bigint default null
)
returns jsonb
language plpgsql
as $$
declare
  v_company_id        bigint;
  v_prefix            text;
  v_invoice_id        bigint;
  v_invoice_no        text;
  v_current_year      int;
  v_max_no            int;
  v_current_total     numeric;
  v_diff              numeric;
  v_line              record;
  v_old_line          record;
  v_job_card_id       bigint := null;
  v_repairing_total   numeric := 0;
  v_repairing_invoiced numeric := 0;
  v_repairing_pending numeric := 0;
  v_job_card_closed   boolean := false;
begin
  -- Company resolve: parameter > pehli active company
  v_company_id := coalesce(
    p_company_id,
    (select min(id) from public.companies where active)
  );

  -- Company ka apna invoice prefix (Non-GST = INV/, GST = GSTINV/)
  select coalesce(nullif(trim(invoice_prefix), ''), 'INV/')
    into v_prefix
    from public.companies
   where id = v_company_id;

  v_prefix := coalesce(v_prefix, 'INV/');

  if p_mode = 'edit' then
    select invoice_no, job_card_id
      into v_invoice_no, v_job_card_id
      from public.invoices
     where id = p_editing_invoice_id
       and company_id = v_company_id;

    if v_invoice_no is null then
      raise exception 'Invoice not found for this company (id: %)', p_editing_invoice_id;
    end if;

    if exists (
      select 1 from public.bank_transactions
       where company_id = v_company_id
         and (particulars ilike '%' || v_invoice_no || '%'
           or notes ilike '%' || v_invoice_no || '%')
    ) then
      raise exception 'Is invoice ka payment ho chuka hai, update allowed nahi hai!';
    end if;

    select coalesce(total_amount, 0)
      into v_current_total
      from public.invoices
     where id = p_editing_invoice_id;

    -- 1) Purani stock wapas
    for v_old_line in
      select * from jsonb_to_recordset(coalesce(p_old_items, '[]'::jsonb))
        as x(item_id bigint, quantity numeric)
    loop
      if v_old_line.item_id is not null then
        update public.item_master
           set opening_stock = coalesce(opening_stock, 0) + coalesce(v_old_line.quantity, 0)
         where id = v_old_line.item_id;
      end if;
    end loop;

    -- 2) Purani lines hatao
    delete from public.invoice_items
     where invoice_id = p_editing_invoice_id
       and company_id = v_company_id;

    -- 3) Header update
    update public.invoices
       set invoice_date = p_invoice_date,
           customer_id = p_customer_id,
           job_card_id = case when p_invoice_type = 'Job Card' then coalesce(v_job_card_id, p_job_card_id) else null end,
           invoice_type = p_invoice_type,
           total_amount = p_total_amount
     where id = p_editing_invoice_id
       and company_id = v_company_id;

    v_invoice_id := p_editing_invoice_id;

    -- 4) Auto-created bank row ka amount adjust
    v_diff := p_total_amount - v_current_total;
    if v_diff <> 0 then
      update public.bank_transactions
         set amount = coalesce(amount, 0) + v_diff,
             payment_in = coalesce(payment_in, 0) + v_diff
       where company_id = v_company_id
         and (particulars ilike '%' || v_invoice_no || '%'
           or notes ilike '%' || v_invoice_no || '%');
    end if;
  else
    -- CREATE mode: company ke apne prefix se next number
    v_current_year := extract(year from p_invoice_date);

    select coalesce(max(
               case
                 when substring(trim(invoice_no) from '[0-9]+$') ~ '^[0-9]+$'
                 then substring(trim(invoice_no) from '[0-9]+$')::int
                 else 0
               end), 0)
      into v_max_no
      from public.invoices
     where company_id = v_company_id
       and invoice_no like v_prefix || v_current_year || '-%';

    v_invoice_no := v_prefix || v_current_year || '-' || lpad((v_max_no + 1)::text, 4, '0');

    insert into public.invoices
      (invoice_no, invoice_date, customer_id, job_card_id, invoice_type, total_amount, company_id)
    values
      (v_invoice_no, p_invoice_date, p_customer_id,
       case when p_invoice_type = 'Job Card' then p_job_card_id else null end,
       p_invoice_type, p_total_amount, v_company_id)
    returning id into v_invoice_id;

    v_job_card_id := case when p_invoice_type = 'Job Card' then p_job_card_id else null end;
  end if;

  -- 5) Item lines + stock deduct
  for v_line in
    select * from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
      as x(inward_no text, item_id bigint, item_name text, quantity numeric,
           rate numeric, total numeric, cost_rate numeric, source text)
  loop
    insert into public.invoice_items
      (invoice_id, inward_no, item_id, item_name, quantity, rate, total, cost_rate, company_id)
    values
      (v_invoice_id, v_line.inward_no,
       case when v_line.source = 'Spare Part' then null else v_line.item_id end,
       v_line.item_name, v_line.quantity, v_line.rate, v_line.total, v_line.cost_rate,
       v_company_id);

    if v_line.item_id is not null and v_line.source <> 'Spare Part' then
      update public.item_master
         set opening_stock = greatest(0, coalesce(opening_stock, 0) - coalesce(v_line.quantity, 0))
       where id = v_line.item_id;
    end if;
  end loop;

  -- 6) Job card close (jab saari repairing qty invoice ho jaaye)
  if v_job_card_id is not null then
    select coalesce(repairing_quantity, 0)
      into v_repairing_total
      from public.job_cards
     where id = v_job_card_id
       and company_id = v_company_id;

    select coalesce(sum(ii.quantity), 0)
      into v_repairing_invoiced
      from public.invoice_items ii
      join public.invoices iv on iv.id = ii.invoice_id
     where iv.job_card_id = v_job_card_id
       and iv.company_id = v_company_id
       and ii.inward_no = 'JOB-REP';

    v_repairing_pending := greatest(0, v_repairing_total - v_repairing_invoiced);
    v_job_card_closed := (v_repairing_total <= 0) or (v_repairing_pending <= 0.00001);

    update public.job_cards
       set status = 'Closed', invoice_id = v_invoice_id, closed_at = now()
     where id = v_job_card_id
       and company_id = v_company_id;

    if not v_job_card_closed then
      update public.job_cards
         set status = 'Open', invoice_id = v_invoice_id
       where id = v_job_card_id
         and company_id = v_company_id
         and status = 'Closed';
    end if;
  end if;

  return jsonb_build_object(
    'invoice_id',          v_invoice_id,
    'invoice_no',          v_invoice_no,
    'company_id',          v_company_id,
    'job_card_closed',     v_job_card_closed,
    'repairing_total',     v_repairing_total,
    'repairing_invoiced',  v_repairing_invoiced,
    'repairing_pending',   v_repairing_pending
  );
end;
$$;

-- ---------------------------------------------------------------------------
create or replace function public.delete_invoice_atomic(
  p_invoice_id  bigint,
  p_company_id bigint default null
)
returns text
language plpgsql
as $$
declare
  v_company_id  bigint;
  v_inv         record;
  v_old_line    record;
  v_invoice_no  text;
begin
  v_company_id := coalesce(
    p_company_id,
    (select min(id) from public.companies where active)
  );

  select * into v_inv
    from public.invoices
   where id = p_invoice_id
     and company_id = v_company_id;

  if v_inv is null then
    raise exception 'Invoice not found for this company (id: %)', p_invoice_id;
  end if;

  v_invoice_no := v_inv.invoice_no;

  -- Payment ho chuka hai to delete nahi
  if exists (
    select 1 from public.bank_transactions
     where company_id = v_company_id
       and (particulars ilike '%' || v_invoice_no || '%'
         or notes ilike '%' || v_invoice_no || '%')
  ) then
    raise exception 'Is invoice ke against payment/receipt ho chuki hai, delete nahi ho sakta!';
  end if;

  -- 1) Stock wapas
  for v_old_line in
    select item_id, quantity
      from public.invoice_items
     where invoice_id = p_invoice_id
       and company_id = v_company_id
  loop
    if v_old_line.item_id is not null then
      update public.item_master
         set opening_stock = coalesce(opening_stock, 0) + coalesce(v_old_line.quantity, 0)
       where id = v_old_line.item_id;
    end if;
  end loop;

  -- 2) Job card wapas kholo
  if v_inv.job_card_id is not null then
    update public.job_cards
       set status = 'Open', invoice_id = null
     where id = v_inv.job_card_id
       and company_id = v_company_id;
  end if;

  -- 3) Auto-created bank row hatao
  delete from public.bank_transactions
   where company_id = v_company_id
     and (particulars ilike '%' || v_invoice_no || '%'
       or notes ilike '%' || v_invoice_no || '%');

  -- 4) Lines + header delete
  delete from public.invoice_items
   where invoice_id = p_invoice_id
     and company_id = v_company_id;

  delete from public.invoices
   where id = p_invoice_id
     and company_id = v_company_id;

  return v_invoice_no;
end;
$$;

-- VERIFY
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('save_invoice_atomic','delete_invoice_atomic')
order by p.proname;

-- ================================================================
-- SECTION 21/22: rls-enable-migration.sql
-- ================================================================
-- Maruti Module Service: Enable Row Level Security (RLS)
-- Run ONCE in Supabase Dashboard -> SQL Editor.
--
-- IMPORTANT: After running this, the app will ONLY show data to a USER WHO IS
-- LOGGED IN (Supabase Auth session). Without login -> no data access from DB.
--
-- The app already shows a Login screen when there is no session
-- (App.tsx: `if (!session) return <Login />`), so normal usage is unchanged.
--
-- This script is safe to re-run (idempotent). It does not drop tables or delete data.

-- ---------------------------------------------------------------------------
-- 1) Tables the app reads/writes
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'customers',
    'items',
    'item_master',
    'customer_item_prices',
    'vendors',
    'purchases',
    'invoices',
    'invoice_items',
    'job_cards',
    'bank_transactions',
    'company_settings',
    'technicians',
    'job_card_technicians',
    'warranty_returns'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2) Policies: any AUTHENTICATED (logged-in) user gets full access.
--    Anonymous / not-logged-in users get no access at all.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'customers',
    'items',
    'item_master',
    'customer_item_prices',
    'vendors',
    'purchases',
    'invoices',
    'invoice_items',
    'job_cards',
    'bank_transactions',
    'company_settings',
    'technicians',
    'job_card_technicians',
    'warranty_returns'
  ]
  loop
    execute format('drop policy if exists "rls_all_%I" on public.%I;', t, t);
    execute format(
      'create policy "rls_all_%I" on public.%I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3) Sequences needed by triggers / client code (grant to authenticated)
-- ---------------------------------------------------------------------------
grant usage on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- 4) VERIFY: run this query after execution
--    SELECT schemaname, tablename, rowsecurity
--    FROM pg_tables
--    WHERE schemaname = 'public'
--    ORDER BY tablename;
--    Every row must show rowsecurity = true.
-- ---------------------------------------------------------------------------
-- ================================================================
-- SECTION 22/22: fresh-install-99-finalize.sql
-- ================================================================
-- ── Fresh GST install: Part 99 — final gaps, RLS fallback, grants ─────────────
-- Ye file hamesha SABSE LAST me chalti hai (fresh-install.sql ke end par).

-- 1) Columns jo app code sc() se stamp/expect karta hai par kisi migration file
--    me add nahi hue the (purane DB me manually add kiye gaye the).
alter table public.item_master add column if not exists company_id bigint not null default 1;
alter table public.item_master add column if not exists hsn_code text;
alter table public.item_master add column if not exists gst_percent numeric(6,2) not null default 0;
alter table public.job_card_technicians add column if not exists company_id bigint not null default 1;
alter table public.warranty_returns add column if not exists company_id bigint not null default 1;

-- 2) RLS fallback: har public table par RLS enabled ho, aur jis table par abhi
--    tak koi policy hi nahi bani hai uspar logged-in user ko full access.
--    (audit_log jin tables par apni policy already le chuka hai unhe chhodta hai.)
do $$
declare t text;
begin
  foreach t in array (
    select c.relname::text
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not exists (
         select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
       )
     order by c.relname
  )
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create policy "rls_all_%I" on public.%I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end
$$;

-- 3) Grants: table/sequence/function access (RLS phir bhi data block karega
--    bina login ke; ye sirf permission layer hai — purane setup ke same pattern par).
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to anon, authenticated, service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;

-- 4) VERIFY — run ke baad output yahan se check karein:
--    har table par rowsecurity = true chahiye, aur 0 tables policy ke bina nahi honi chahiye.
select schemaname, tablename, rowsecurity
  from pg_tables
 where schemaname = 'public'
 order by tablename;

select count(*) as total_tables_without_policy
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and not exists (
     select 1 from pg_policies p
      where p.schemaname = 'public' and p.tablename = c.relname
   );
