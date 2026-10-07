-- Maruti Module Service: invoice item source / inward reference
-- Run once in Supabase SQL Editor. It only adds a missing column; no data is deleted.

alter table public.invoice_items
  add column if not exists inward_no text;

create index if not exists invoice_items_inward_no_idx
  on public.invoice_items (inward_no);
