-- ── Fresh GST install: Part 1 — reconstructed base tables ─────────────────────
-- Ye tables purane DB me manually bani thin (repo me unka CREATE nahi tha),
-- isliye app code + import SQL + migrations se reconstruct ki gayi hain.
-- Sirf NAYE Supabase project par chalayein (SQL Editor), fresh DB ke liye.
-- Iske baad fresh-install.sql ke baaki hisse (migrations + RPC + policies) chalte hain.

create table if not exists public.companies (
  id bigserial primary key,
  name text not null,
  tax_mode text not null default 'Non-GST',
  gstin text,
  pan text,
  state_code text,
  state_name text,
  address text,
  phone text,
  email text,
  website text,
  bank_name text,
  bank_account_no text,
  bank_ifsc text,
  upi_id text,
  signatory text,
  invoice_prefix text,
  financial_year_start text default '04-01',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Default company: app pehli login par isi company ko use karega (company_id = 1).
-- banks ke default accounts bhi isi company par banenge (bank-accounts-migration).
insert into public.companies (id, name, tax_mode, active)
values (1, 'Maruti Module Service', 'Non-GST', true)
on conflict (id) do nothing;
select setval(
  pg_get_serial_sequence('public.companies', 'id'),
  coalesce((select max(id) from public.companies), 1)
);

create table if not exists public.company_settings (
  id bigserial primary key,
  company_id bigint not null default 1,
  business_name text,
  tagline text,
  business_address text,
  state text,
  state_code text,
  phone text,
  email text,
  website text,
  tax_mode text,
  gstin text,
  pan text,
  udyam_number text,
  bank_account_holder text,
  bank_account_number text,
  bank_name text,
  bank_ifsc text,
  bank_branch text,
  upi_id text,
  invoice_prefix text,
  invoice_start_number integer,
  financial_year_start text,
  signature_name text,
  po_terms text,
  sales_terms text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customers (
  id bigint generated always as identity primary key,
  customer_code integer,
  customer_name text not null,
  business_name text,
  mobile text,
  business_address text,
  gst_available boolean not null default false,
  gst_number text,
  payment_term text,
  company_id bigint not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.vendors (
  id bigint generated always as identity primary key,
  vendor_code text,
  vendor_name text,
  business_name text,
  contact_person text,
  mobile text,
  address text,
  gst_status text,
  payment_term text,
  company_id bigint not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.items (
  id bigint generated always as identity primary key,
  item_code text,
  item_name text not null,
  unit text,
  hsn_code text,
  gst_percent numeric(6,2) not null default 0,
  purchase_price numeric(12,2) not null default 0,
  cost_price numeric(12,2) not null default 0,
  sale_price numeric(12,2) not null default 0,
  opening_stock numeric(14,3) not null default 0,
  min_stock numeric(14,3) not null default 0,
  company_id bigint not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id bigserial primary key,
  inward_no text,
  purchase_no text,
  purchase_date date,
  vendor_id bigint,
  vendor_name text,
  vendor_code text,
  item_name text,
  item_code text,
  quantity numeric(14,3) not null default 0,
  rate numeric(12,2) not null default 0,
  purchase_rate numeric(12,2) not null default 0,
  total_amount numeric(12,2) not null default 0,
  payment_mode text,
  remarks text,
  status text not null default 'Pending',
  company_id bigint not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists purchases_date_idx on public.purchases (purchase_date);
create index if not exists purchases_vendor_idx on public.purchases (vendor_id);

create table if not exists public.job_cards (
  id bigserial primary key,
  job_no text,
  job_date date,
  customer_id bigint,
  business_name text,
  received_quantity numeric(14,3) not null default 0,
  service_type text,
  technician text,
  repairing_quantity numeric(14,3) not null default 0,
  warranty_quantity numeric(14,3) not null default 0,
  reject_quantity numeric(14,3) not null default 0,
  remarks text,
  module_image_url text,
  received_image_url text,
  status text not null default 'Open',
  closed_at timestamptz,
  invoice_id bigint,
  created_at timestamptz not null default now(),
  company_id bigint not null default 1
);
create index if not exists job_cards_customer_idx on public.job_cards (customer_id);
create index if not exists job_cards_status_idx on public.job_cards (status);

create table if not exists public.invoices (
  id bigint generated always as identity primary key,
  invoice_no text not null,
  invoice_date date not null,
  customer_id bigint not null,
  job_card_id bigint,
  invoice_type text not null default 'Direct',
  total_amount numeric(14,2) not null default 0,
  company_id bigint not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists invoices_customer_idx on public.invoices (customer_id);
create index if not exists invoices_date_idx on public.invoices (invoice_date);
create index if not exists invoices_jobcard_idx on public.invoices (job_card_id);

create table if not exists public.invoice_items (
  id bigserial primary key,
  invoice_id bigint not null,
  inward_no text,
  item_id bigint,
  item_name text,
  quantity numeric(14,3) not null default 0,
  rate numeric(12,2) not null default 0,
  total numeric(12,2) not null default 0,
  cost_rate numeric(14,7) not null default 0,
  company_id bigint not null default 1,
  constraint invoice_items_invoice_fk
    foreign key (invoice_id) references public.invoices (id) on delete cascade
);
create index if not exists invoice_items_invoice_idx on public.invoice_items (invoice_id);
create index if not exists invoice_items_inward_idx on public.invoice_items (inward_no);
create index if not exists invoice_items_item_idx on public.invoice_items (item_id);

create table if not exists public.technicians (
  id bigserial primary key,
  name text not null,
  mobile text,
  salary numeric(12,2) not null default 0,
  status text not null default 'Active',
  share_percent numeric(5,2),
  company_id bigint not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.bank_transactions (
  id bigserial primary key,
  company_id bigint not null default 1,
  account_id bigint,
  transaction_no text,
  transaction_date date,
  date_time timestamptz,
  particulars text,
  notes text,
  party_name text,
  transaction_type text,
  type text,
  payment_in numeric(14,2) not null default 0,
  payment_out numeric(14,2) not null default 0,
  credit_amount numeric(14,2) not null default 0,
  debit_amount numeric(14,2) not null default 0,
  amount numeric(14,2) not null default 0,
  total_amount numeric(14,2),
  payment_mode text,
  remarks text,
  is_transfer boolean not null default false,
  transfer_to_account_id bigint,
  cheque_no text,
  cheque_date date,
  utr_no text,
  bounce_reason text,
  bounced_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists bank_txn_date_idx on public.bank_transactions (transaction_date);
create index if not exists bank_txn_company_account_idx on public.bank_transactions (company_id, account_id);
create index if not exists bank_txn_account_date_idx on public.bank_transactions (account_id, transaction_date);
create index if not exists bank_txn_txnno_idx on public.bank_transactions (transaction_no);
create index if not exists bank_txn_bounced_idx on public.bank_transactions (company_id, bounced_at)
  where bounced_at is not null;

create table if not exists public.customer_item_prices (
  id bigserial primary key,
  company_id bigint not null default 1,
  customer_id bigint not null,
  item_id bigint not null,
  agreed_rate numeric(12,2) not null default 0,
  active boolean not null default true,
  effective_from date,
  created_at timestamptz not null default now(),
  constraint customer_item_prices_customer_fk
    foreign key (customer_id) references public.customers (id) on delete cascade,
  constraint customer_item_prices_item_fk
    foreign key (item_id) references public.items (id) on delete cascade,
  constraint customer_item_prices_unique unique (customer_id, item_id)
);
