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
