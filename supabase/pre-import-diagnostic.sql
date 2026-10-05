-- =============================================================================
-- FY ROLLOVER: PRE-IMPORT DIAGNOSTIC  (READ-ONLY — kuch change NAHI karta)
-- =============================================================================
-- Ye chalane ke baad mujhe (assistant) output bhej do. Isse pata chalega:
--   1) Software me abhi stock kahan hai — `items` table me ya `item_master` me?
--   2) Kaun se items pehle se maujood hain?
--   3) Koi purana invoice/receipt/purchase pada to nahi jo aapke sheet ke
--      ulta ho? (Warna opening daalne se double count ho jayega)
-- =============================================================================

-- 1) Dono tables me kitne items hain?
select 'items' as table_name, count(*) as row_count from public.items
union all
select 'item_master', count(*) from public.item_master;

-- 2) `items` table ka poora content (stock qty + rates)
select id, item_code, item_name, opening_stock, purchase_price, cost_price
from public.items
order by item_name;

-- 3) `item_master` table ka poora content
select id, item_code, item_name, opening_stock, purchase_price, sale_price
from public.item_master
order by item_name;

-- 4) Kya stock items ke naam already `purchases` me hain? (duplicate batch check)
select item_name,
       count(*) as inward_rows,
       sum(quantity) as total_qty,
       string_agg(distinct inward_no, ', ' order by inward_no) as inward_nos
from public.purchases
group by item_name
order by item_name;

-- 5) Purane invoices / receipts / job cards ka summary
select
  (select count(*) from public.invoices)                       as invoice_count,
  (select count(*) from public.invoice_items)                  as invoice_item_count,
  (select count(*) from public.bank_transactions)              as bank_txn_count,
  (select count(*) from public.purchases)                      as purchase_row_count,
  (select count(*) from public.job_cards)                      as job_card_count,
  (select count(*) from public.customers)                      as customer_count,
  (select count(*) from public.vendors)                        as vendor_count;

-- 6) Invoice numbering ab kya chal raha hai (FY series check)
select invoice_no, invoice_date, total_amount
from public.invoices
order by invoice_date desc
limit 15;

-- 7) Bank / cash ke purane transactions
select transaction_no, transaction_date, transaction_type, party_name,
       amount, payment_in, payment_out
from public.bank_transactions
order by transaction_date desc
limit 20;
