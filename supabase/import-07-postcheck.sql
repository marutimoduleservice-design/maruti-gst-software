-- ============================================================================
-- POST-IMPORT CHECKS  (READ-ONLY — deletes nothing, changes nothing)
-- Run in Supabase Dashboard -> SQL Editor.
--
-- Closes out the items that could not be checked from the import files alone.
-- Every query here is a SELECT. Safe to run any number of times.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- CHECK A  |  save_invoice_atomic RPC present?
-- The whole invoice save flow (Invoices.tsx:711) calls this one function.
-- If it is missing, no new invoice can be saved at all.
-- Expected: exists = true
-- ---------------------------------------------------------------------------
select
  exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'save_invoice_atomic'
  ) as save_invoice_atomic_exists;


-- ---------------------------------------------------------------------------
-- CHECK B  |  Vendor payable
-- Mirrors PaymentsLedger.tsx:305-309 — sum of purchase bills that are not Paid.
-- Expected: payable 75504.60 across 25 unpaid inward batches
-- ---------------------------------------------------------------------------
select
  count(*)                                        as unpaid_bills,
  coalesce(sum(total_amount), 0)                  as payable
  from public.purchases
 where status is distinct from 'Paid';

-- Expected: 25 / 75504.60
-- If a bill shows NULL status it is treated as Pending, matching the app.


-- ---------------------------------------------------------------------------
-- CHECK C  |  Customer codes assigned by trg_generate_customer_code
-- Expected: 45 customers, 0 NULL codes, 0 duplicate codes
-- ---------------------------------------------------------------------------
select
  count(*)                                        as customers,
  count(*) filter (where customer_code is null)   as null_codes,
  count(*) - count(distinct customer_code)        as duplicate_codes
  from public.customers;

-- Show the first and last few, so the code format can be eyeballed.
select customer_code, customer_name, business_name, mobile
  from public.customers
 order by customer_code
 limit 5;

-- highest code, so the CSV uploader's next code is predictable
select max(customer_code) as highest_code from public.customers;


-- ---------------------------------------------------------------------------
-- CHECK D  |  Opening balance tables
-- These were never part of the import. If they hold rows, they will silently
-- add to receivables/payables on screen and disagree with the locked figures.
-- Expected: 0 rows in both (they may not even exist).
-- ---------------------------------------------------------------------------
select 'opening_balances' as tbl, count(*) from public.opening_balances
union all
select 'customer_opening_balances', count(*) from public.customer_opening_balances;


-- ---------------------------------------------------------------------------
-- CHECK E  |  Advance receipts — date fidelity
-- Receipts where the money arrived BEFORE the invoice it is linked to, or that
-- are not linked to any invoice at all. The aggregate money-in is already
-- confirmed exact (1150126.90); this lists the individual dates so they can be
-- compared against the source PDF by eye.
-- ---------------------------------------------------------------------------
select
  b.transaction_date      as receipt_date,
  b.payment_in            as amount,
  b.particulars,
  v.invoice_no             as linked_invoice,
  v.invoice_date           as invoice_date,
  case
    when v.invoice_no is null then 'no invoice link'
    when b.transaction_date::date < v.invoice_date then 'advance (before invoice)'
    else 'normal'
  end                      as kind
  from public.bank_transactions b
  left join public.invoices v
         on b.particulars ilike '%' || v.invoice_no || '%'
 where b.payment_in > 0
   and (coalesce(b.transaction_type, '') ilike '%customer receipt%'
        or coalesce(b.particulars, '') ilike '%customer receipt%')
   and (v.invoice_no is null
        or b.transaction_date::date < v.invoice_date)
 order by b.transaction_date;


-- ---------------------------------------------------------------------------
-- CHECK F  |  item_master cost_price backfill applied?
-- Run item-master-cost-price-fix.sql first, then this should read 0 nulls.
-- (Needed because SalesReport.tsx:99 and NetProfitReport.tsx:50 both select
--  this column from item_master, which did not exist in the original schema.)
-- ---------------------------------------------------------------------------
select
  count(*)                                        as item_master_rows,
  count(*) filter (where cost_price is null)       as null_cost_price
  from public.item_master;


-- ---------------------------------------------------------------------------
-- CHECK G  |  Confirm the locked figures one more time (nothing should drift)
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.items)                                     as items,
  (select count(*) from public.item_master)                                as item_master,
  (select count(*) from public.vendors)                                    as vendors,
  (select count(*) from public.customers)                                  as customers,
  (select count(*) from public.purchases)                                  as purchases,
  (select count(*) from public.bank_transactions)                          as bank_rows,
  (select count(*) from public.invoices)                                   as invoices,
  (select count(*) from public.invoice_items)                              as invoice_lines;

select
  (select coalesce(sum(total_amount), 0) from public.invoices)            as sale_total_1240489,
  (select coalesce(sum(payment_in), 0) from public.bank_transactions)     as money_in_1150126_90,
  (select coalesce(sum(payment_out), 0) from public.bank_transactions)    as money_out_975755_80,
  (select coalesce(sum(total_amount), 0) from public.purchases)           as inward_646678_36;
