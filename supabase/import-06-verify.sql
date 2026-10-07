-- ============================================================
-- STEP 5/5  VERIFICATION  (replays the app's own formulas in SQL)
-- Maruti Module Service | FY 2026-27 | auto-generated
-- Run in order after clean-slate-wipe.sql + fy-numbering-migration.sql
-- ============================================================

-- Run AFTER import-02..05.  Every 'got' must equal 'want'.
-- These queries mirror SalesReport.tsx and Stock.tsx, so when they pass the
-- app screens will show the same numbers.

select '=== 1/7  bank ledger  (want 1,150,126.90 / 975,755.80 / 174,371.10 / 489) ===' as diagnostic;
select round(sum(payment_in),2) money_in, round(sum(payment_out),2) money_out,
       round(sum(payment_in)-sum(payment_out),2) closing_bank, count(*) rows_
from public.bank_transactions;

select '=== 2/7  sales  (want 363 invoices / 1,240,489.00 / 1,989 lines) ===' as diagnostic;
select count(*) invoices, round(sum(total_amount),2) sale_total from public.invoices;
select count(*) invoice_lines from public.invoice_items;

select '=== 3/7  purchases  (want 138 batches / 138 rows / 646,678.36) ===' as diagnostic;
select count(distinct inward_no) inward_batches, count(*) rows_,
       round(sum(total_amount),2) inward_total from public.purchases;

select '=== 4/7  pending - SalesReport.tsx receipt cap  (want 1,240,489.00 / 1,020,299.90 / 9,886.80 / 210,302.30) ===' as diagnostic;
with rcpt as (
  select b.id, b.payment_in, i.id inv_id, i.total_amount,
         coalesce((regexp_match(b.particulars,
           '\[Disc: *₹?([0-9.]+)\]','i'))[1]::numeric, 0) disc
  from public.bank_transactions b
  join public.invoices i on b.particulars ilike '%' || i.invoice_no || '%'
  where lower(b.transaction_type) like '%customer receipt%'
     or lower(b.particulars)     like '%customer receipt%'),
seq as (   -- running total, so a receipt is capped at what is still due
  select r.*, sum(r.payment_in) over (partition by r.inv_id order by r.id)
         - r.payment_in prev_cum from rcpt r),
got as (
  select s.*, least(s.payment_in, greatest(0, s.total_amount - s.prev_cum)) got
  from seq s),
got2 as (
  select g.*, sum(g.got) over (partition by g.inv_id order by g.id) - g.got prev_got
  from got g),
alloc as (   -- same min(receipt, outstanding) + deduction cap as the app
  select inv_id, sum(got) received,
         sum(least(disc, greatest(0, total_amount - prev_got - got))) deduct
  from got2 group by inv_id)
select round(sum(i.total_amount),2) billed,
       round(sum(coalesce(a.received,0)),2) received,
       round(sum(coalesce(a.deduct,0)),2) deducted,
       round(sum(greatest(0, i.total_amount - coalesce(a.received,0)
             - coalesce(a.deduct,0))),2) pending
from public.invoices i left join alloc a on a.inv_id = i.id;

select '=== 5/7  COGS - SalesReport.tsx getLineCostRate chain  (want 599,359.91 cogs / 641,129.09 profit / 0 fallbacks) ===' as diagnostic;
with c as (
  select v.id, v.quantity, v.cost_rate,
         coalesce(max(p.rate),0) batch_rate,
         coalesce(max(it.purchase_price),0) master_purchase,
         coalesce(max(it.cost_price),0)    master_cost
  from public.invoice_items v
  left join public.items it on lower(it.item_name) = lower(v.item_name)
  left join public.purchases p on p.inward_no = v.inward_no
       and lower(p.item_name) = lower(v.item_name)
  group by v.id, v.quantity, v.cost_rate)
select round(sum(quantity * (case when cost_rate      > 0 then cost_rate
                            when batch_rate     > 0 then batch_rate
                            when master_purchase> 0 then master_purchase
                            when master_cost    > 0 then master_cost
                            else 0 end)),2) cogs from c;
select count(*) lines_falling_back_to_item_price
from public.invoice_items where cost_rate <= 0;
--  profit = 1,240,489.00 - 599,359.91 = 641,129.09

select '=== 6/7  stock value - Stock.tsx inward proration ===' as diagnostic;
with b as (   -- one inward batch = (inward_no, item), as Stock.tsx:105 keys it
  select p.inward_no, lower(p.item_name) it,
         sum(p.quantity) bqty, sum(p.quantity*p.rate) bval
  from public.purchases p group by p.inward_no, lower(p.item_name)),
r as (       -- a sale only ever eats the batch it names (Stock.tsx:189-198)
  select b.it, greatest(0, b.bqty - coalesce((select sum(v.quantity)
           from public.invoice_items v where v.inward_no = b.inward_no
             and lower(v.item_name) = b.it),0)) rq,
         case when b.bqty > 0 then b.bval * greatest(0, b.bqty - coalesce(
           (select sum(v.quantity) from public.invoice_items v
            where v.inward_no = b.inward_no and lower(v.item_name) = b.it),0))
           / b.bqty else 0 end rv
  from b),
tgt as (
  select lower(i.item_name) it,
         (i.item_name ilike '%module service%'
          or i.item_name ilike '%warranty service%'
          or i.item_name ilike '%reject module%') is_svc,
         coalesce(i.opening_stock,0)
         + coalesce((select sum(quantity) from public.purchases p
              where lower(p.item_name)=lower(i.item_name)),0)
         - coalesce((select sum(quantity) from public.invoice_items v
              where lower(v.item_name)=lower(i.item_name)),0) qty,
         coalesce(nullif(i.purchase_price,0), i.cost_price, 0) rate
  from public.items i),
val as (
  select t.it, t.is_svc, t.qty, t.rate,
         coalesce(sum(r.rv),0) batch_value, coalesce(sum(r.rq),0) batch_left
  from tgt t left join r on r.it = t.it
  group by t.it, t.is_svc, t.qty, t.rate)
select round(sum(case when is_svc then 0
       else batch_value + greatest(0, qty - batch_left) * rate end),2) stock_value,
       round(sum(greatest(0, qty)),2) closing_qty_units from val;
--  Stock.tsx does NOT walk batches by date: it prorates each batch down by
--  remaining_qty/before_qty, so batches no sale ever names keep full value.

select '=== 7/7  negative stock - labour items are expected, anything else is not ===' as diagnostic;
with tgt as (
  select lower(i.item_name) it, i.item_name,
         coalesce(i.opening_stock,0)
         + coalesce((select sum(quantity) from public.purchases p
              where lower(p.item_name)=lower(i.item_name)),0)
         - coalesce((select sum(quantity) from public.invoice_items v
              where lower(v.item_name)=lower(i.item_name)),0) qty
  from public.items i)
select item_name, round(qty,2) closing_qty from tgt
where qty < -0.001 order by qty;
--  expect only these 3: module service -7425, warranty service -395, reject module -4
--  They are labour/service items sold far beyond what was inwarded, which is
--  normal for a repair shop.  A FOURTH row means invoice_items.quantity was
--  still integer and the one fractional line rounded - see import-05a.
commit;
