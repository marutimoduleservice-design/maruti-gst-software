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
