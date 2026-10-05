-- Maruti Module Service: Print serial numbers + Terms & Conditions migration
-- Run once in Supabase SQL Editor. This script does not drop tables or delete data.

-- 1) Receipt / Payment serial numbers (RC-2026-0001, PM-2026-0001) stored on each
--    bank_transactions row so Print Center can print with the same number.
alter table public.bank_transactions add column if not exists transaction_no text;

-- 2) Editable Terms & Conditions tied to company settings.
--    PO (Purchase Order) -> po_terms, Sales Invoice -> sales_terms
alter table public.company_settings add column if not exists po_terms text;
alter table public.company_settings add column if not exists sales_terms text;

create index if not exists bank_transactions_transaction_no_idx
  on public.bank_transactions (transaction_no);