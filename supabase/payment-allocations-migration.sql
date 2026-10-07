-- ── payment_allocations ──────────────────────────────────────────────────────
-- Payment ↔ bill linkage ka permanent source of truth.
--
-- Pehle ye hisaab `bank_transactions.particulars` ke andar text me rakha jata
-- tha ("INV-001: 500.00, INW-3: 1200.00"). Text edit/cut ho jaaye, invoice ka
-- number badal jaaye ya row delete ho jaaye — allocation chup-chaap galat ho
-- jaati thi. Ab har payment ki har bill ke liye yahan ek alag line hogi.
--
-- Chalane ka tareeka: Supabase Dashboard → SQL Editor → ye file paste → Run.
-- Ye file idempotent hai (do baar chalane par kuch nahi bigadta). Run karne se
-- PEHLE app kuch nahi badlega: screens purane text-parse par hi chalte rahengi
-- (fallback), nayi entries par table rows banna shuru honge, aur ek-time
-- backfill purane vouchers ki lines yahan copy kar dega.
--
-- Notes:
--   * RLS enable nahi ki ja rahi (baaki app tables ki posture ke saath).
--   * bank_transactions se FK nahi lagaya — id ka type mismatch hone ka khatra
--     hai; app delete ke waqt khud is table ki rows hata deta hai.
--   * invoice_id / purchase_id par FK nahi: invoice delete ho to payment ki
--     line history me bachi rahe (read par wo line skip ho jaati hai).

create table if not exists payment_allocations (
  id bigserial primary key,
  company_id bigint not null default 1,
  bank_transaction_id bigint not null,
  invoice_id bigint,
  purchase_id bigint,
  amount numeric(12, 2) not null default 0,
  deduction numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  constraint payment_allocations_one_side_ck check (
    (invoice_id is not null and purchase_id is null) or
    (purchase_id is not null and invoice_id is null)
  )
);

create index if not exists payment_allocations_txn_idx
  on payment_allocations (bank_transaction_id);
create index if not exists payment_allocations_invoice_idx
  on payment_allocations (invoice_id);
create index if not exists payment_allocations_purchase_idx
  on payment_allocations (purchase_id);
create index if not exists payment_allocations_company_idx
  on payment_allocations (company_id);
