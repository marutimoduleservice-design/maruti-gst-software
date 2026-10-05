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
