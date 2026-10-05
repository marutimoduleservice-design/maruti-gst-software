-- Maruti Module Service: Unify purchase payment status
-- Run ONCE in Supabase Dashboard -> SQL Editor.
-- Makes purchases.status default to 'Pending' so Purchase Report and
-- Payments Ledger always show the same financial result.

alter table public.purchases alter column status set default 'Pending';

-- Backfill any rows that still have no status (treat as pending/unpaid).
update public.purchases
  set status = 'Pending'
  where status is null or status = '';