-- READ-ONLY diagnostic. Isko Supabase SQL Editor me chalayein.
-- Koi data modify nahi hota (sirf select).

-- ============================================================
-- TEST 1: Live save_invoice_atomic kaunsa table mutate karta hai?
-- ============================================================
-- Interpret:
--   mutates_items      = true  -> `items` par stock decrement ho raha hai
--   mutates_item_master= true  -> `item_master` par stock decrement ho raha hai
-- Dono true ho sakte hain (kyunki prosrc me dono ka naam aa sakta hai),
-- islie Test 2 bhi zaroor dekhein.
select
  p.proname,
  p.prosrc like '%public.items%'       as mutates_items,
  p.prosrc like '%public.item_master%' as mutates_item_master,
  p.prosrc like '%greatest(0%'          as has_zero_clamp
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'save_invoice_atomic';

-- ============================================================
-- TEST 2: Per-item reconciliation — kaunsi table ghati hui hai?
-- ============================================================
-- invoice_items.item_id Spare Part lines par NULL hota hai, isliye
-- item_name se join kiya gaya hai.
--
-- columns:
--   items_opening        = items.opening_stock            (app isko dikhata hai)
--   master_opening       = item_master.opening_stock      (legacy twin)
--   invoiced_qty         = jitna is item par invoice hua
--   items_minus_master   = items_opening - master_opening
--   unexplained          = invoiced_qty - items_minus_master
--
-- Interpret:
--   unexplained ~= 0            -> `items` par decrement hua hai => BUG LIVE
--                                   (har invoice me stock 2 baar kat raha hai)
--   items_minus_master = 0
--     aur unexplained = invoiced_qty
--                                  -> sirf `item_master` ghatta hai,
--                                     `items` saaf hai => reports sahi hain
--   dono columns 0                -> koi farak nahi, healthy
--
-- NOTE: zero-clamp wale items (jahan greatest(0,...) ne 0 par rok diya)
--       me unexplained 0 se bada dikhega, kyunki original opening recover
--       nahi ho paati. unhe alag se dekhna hoga.
with inv as (
  select lower(trim(item_name)) as k,
         sum(quantity)         as sold
  from public.invoice_items
  where item_name is not null
    and (inward_no is null or inward_no not like 'JOB-%')
  group by 1
)
select
  i.id,
  i.item_code,
  i.item_name,
  i.opening_stock                        as items_opening,
  m.opening_stock                        as master_opening,
  coalesce(inv.sold, 0)                  as invoiced_qty,
  (i.opening_stock - coalesce(m.opening_stock, 0))          as items_minus_master,
  round(coalesce(inv.sold, 0)
        - (i.opening_stock - coalesce(m.opening_stock, 0)), 3) as unexplained
from public.items i
left join public.item_master m on m.id = i.id
left join inv on inv.k = lower(trim(i.item_name))
where coalesce(inv.sold, 0) > 0
   or i.opening_stock <> coalesce(m.opening_stock, 0)
order by unexplained desc;

-- ============================================================
-- TEST 3: Total summary — kitna stock galat hai?
-- ============================================================
-- Ye ek line hai: isse pata chalega kitna repair karna hai.
with inv as (
  select lower(trim(item_name)) as k,
         sum(quantity)         as sold
  from public.invoice_items
  where item_name is not null
    and (inward_no is null or inward_no not like 'JOB-%')
  group by 1
)
select
  count(*) filter (where coalesce(inv.sold, 0) > 0)                        as items_sold_at_least_once,
  count(*) filter (where i.opening_stock <> coalesce(m.opening_stock, 0))    as tables_disagree,
  round(sum(coalesce(inv.sold, 0)), 3)                                      as total_invoiced_qty,
  round(sum(i.opening_stock - coalesce(m.opening_stock, 0)), 3)            as total_items_minus_master,
  round(sum(coalesce(inv.sold, 0)
        - (i.opening_stock - coalesce(m.opening_stock, 0))), 3)             as total_unexplained
from public.items i
left join public.item_master m on m.id = i.id
left join inv on inv.k = lower(trim(i.item_name));

-- ============================================================
-- TEST 4: Stock zero-clamp me phasa hai kya?
-- ============================================================
-- greatest(0, ...) wahan laga jahan `items` ya `item_master` 0 par
-- clamp ho gaya tha. Aise items ka original opening recover nahi
-- hota, unhe manually set karna padega.
-- ============================================================
select
  i.id,
  i.item_code,
  i.item_name,
  i.opening_stock as items_opening,
  m.opening_stock as master_opening
from public.items i
left join public.item_master m on m.id = i.id
where i.opening_stock = 0
  and exists (
    select 1 from public.invoice_items ii
    where lower(trim(ii.item_name)) = lower(trim(i.item_name))
      and (ii.inward_no is null or ii.inward_no not like 'JOB-%')
  )
order by i.item_name;