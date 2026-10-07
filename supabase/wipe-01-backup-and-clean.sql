-- ============================================================================
-- STEP 1 of 2  |  BACKUP + FULL WIPE
-- Maruti Module Service — Supabase SQL Editor
--
-- Deletes EVERY table in the public schema. Nothing is kept.
-- company_settings (company name / address / print terms) is also emptied.
--
--   1. Snapshot — copies every public table into public.bak_*
--   2. Inventory — prints the foreign-key graph and the row counts
--   3. Wipe     — TRUNCATE every table, RESTART IDENTITY, CASCADE
--   4. Verify   — every table must read 0
--
-- To undo: run wipe-99-restore.sql
--
-- About company_settings: the app handles it being empty. MyCompanyDetails.tsx
-- line 97-99 loads a blank form when no row exists, and line 132-144 INSERTS a
-- new row the moment you press Save. So just re-enter your company details once
-- after the wipe. Until then, invoice print headers will be blank.
-- ============================================================================


-- ############################################################################
-- 1. BACKUP
-- Drops any previous bak_* copies first so this file is re-runnable.
-- ############################################################################
do $$
declare
  r record;
begin
  for r in
    select tablename
      from pg_tables
     where schemaname = 'public'
       and tablename like 'bak\_%'
  loop
    execute format('drop table if exists public.%I cascade', r.tablename);
  end loop;

  for r in
    select tablename
      from pg_tables
     where schemaname = 'public'
       and tablename not like 'bak\_%'
  loop
    execute format('create table public.%I as select * from public.%I',
                   'bak_' || r.tablename, r.tablename);
  end loop;
end $$;


-- ############################################################################
-- 2. INVENTORY
-- Read this before moving on. These are the row counts that were just backed up.
-- ############################################################################
select
  format('%I', tablename) as table_name,
  (xpath('/row/c/text()', query_to_xml(
      format('select count(*) as c from public.%I', tablename), false, true, '')))[1]::text::bigint
    as row_count
  from pg_tables
 where schemaname = 'public'
   and tablename not like 'bak\_%'
 order by tablename;

-- Foreign-key graph. CASCADE in step 3 will clear every child table too.
select
  con.conname                   as fk_name,
  child.relname                 as child_table,
  parent.relname                as parent_table,
  pg_get_constraintdef(con.oid) as definition
  from pg_constraint con
  join pg_class child  on child.oid  = con.conrelid
  join pg_class parent on parent.oid = con.confrelid
  join pg_namespace n  on n.oid      = con.connamespace
 where con.contype = 'f'
   and n.nspname = 'public'
 order by parent.relname, child.relname;


-- ############################################################################
-- 3. WIPE
--
-- Every table in public is truncated, found by name at run time. Nothing is
-- hard-coded, so a table you have never heard of still gets emptied.
--
-- TRUNCATE rather than DELETE, so:
--   * foreign-key order does not matter, Postgres resolves the graph itself
--   * CASCADE also clears any child table discovered only at run time
--   * RESTART IDENTITY puts every id / customer_code counter back to 1, so the
--     first record you create afterwards starts from the beginning
-- ############################################################################
do $$
declare
  r record;
begin
  for r in
    select tablename
      from pg_tables
     where schemaname = 'public'
       and tablename not like 'bak\_%'
  loop
    execute format('truncate table public.%I restart identity cascade', r.tablename);
  end loop;
end $$;


-- ############################################################################
-- 4. VERIFY
-- Every row must read 0. company_settings must also be 0 now.
-- ############################################################################
select
  format('%I', tablename) as table_name,
  (xpath('/row/c/text()', query_to_xml(
      format('select count(*) as c from public.%I', tablename), false, true, '')))[1]::text::bigint
    as row_count
  from pg_tables
 where schemaname = 'public'
   and tablename not like 'bak\_%'
 order by tablename;

-- company_settings must be 0 too. If it still shows 1, the wipe did not run.
select count(*) as company_settings_should_be_0 from public.company_settings;

commit;
