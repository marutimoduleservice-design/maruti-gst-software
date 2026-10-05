-- ============================================================
-- STEP 4a/5  WIDEN invoice_items.quantity integer -> numeric
-- Maruti Module Service | FY 2026-27 | auto-generated
-- Run in order after clean-slate-wipe.sql + fy-numbering-migration.sql
-- ============================================================

-- purchases.quantity and items.opening_stock are already numeric, so this is
-- just an inconsistency in the old schema.  One source line has qty 2.50;
-- as an integer column it rounded to 3 and left Module Patti - Middle at
-- -0.50 closing stock.  numeric(14,3) matches the other quantity columns.
begin;

alter table public.invoice_items
  alter column quantity type numeric(14,3) using quantity::numeric;

commit;
