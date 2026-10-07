-- ============================================================================
-- unique_mobile error — diagnose
-- Maruti Module Service — Supabase SQL Editor
--
-- Read-only. Run this, then paste the output back.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Which table carries the constraint, and is it really UNIQUE?
-- ---------------------------------------------------------------------------
select
  con.conname                              as constraint_name,
  con.contype                             as type,
  tbl.relname                             as table_name,
  pg_get_constraintdef(con.oid)           as definition
  from pg_constraint con
  join pg_class tbl     on tbl.oid = con.conrelid
  join pg_namespace ns   on ns.oid = con.connamespace
 where ns.nspname = 'public'
   and (con.conname ilike '%mobile%'
        or pg_get_constraintdef(con.oid) ilike '%mobile%')
 order by tbl.relname, con.conname;


-- ---------------------------------------------------------------------------
-- 2. Current row counts — did the wipe actually run, or is data already in?
-- ---------------------------------------------------------------------------
select 'customers' as tbl, count(*) as rows from public.customers
union all select 'vendors',   count(*) from public.vendors
union all select 'items',     count(*) from public.items
union all select 'invoices',  count(*) from public.invoices
order by 1;


-- ---------------------------------------------------------------------------
-- 3. Duplicate mobiles ALREADY in the database, per table.
--    If these come back empty, the clash is inside your CSV file.
-- ---------------------------------------------------------------------------
select 'customers' as tbl, mobile, count(*) as times_used,
       array_agg(customer_name order by customer_name) as names
  from public.customers
 where mobile is not null and btrim(mobile) <> ''
 group by mobile having count(*) > 1
union all
select 'vendors', mobile, count(*), array_agg(vendor_name order by vendor_name)
  from public.vendors
 where mobile is not null and btrim(mobile) <> ''
 group by mobile having count(*) > 1
order by 1, 2;


-- ---------------------------------------------------------------------------
-- 4. Format problems that will fail the same way later.
--    The single-add form enforces /^[0-9+\-\s]{7,15}$/ (Customers.tsx:154).
--    The CSV path does NOT, so odd formats slip through silently.
-- ---------------------------------------------------------------------------
select
  'customers' as tbl,
  count(*) filter (where mobile !~ '^[0-9+\-\s]{7,15}$') as bad_format,
  count(*) filter (where mobile ~ '\s')                   as has_spaces,
  count(*) filter (where length(mobile) > 15)              as too_long
  from public.customers
 where mobile is not null and btrim(mobile) <> ''
union all
select
  'vendors',
  count(*) filter (where mobile !~ '^[0-9+\-\s]{7,15}$'),
  count(*) filter (where mobile ~ '\s'),
  count(*) filter (where length(mobile) > 15)
  from public.vendors
 where mobile is not null and btrim(mobile) <> '';
