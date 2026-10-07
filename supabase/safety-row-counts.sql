-- SAFETY CHECK — READ-ONLY. Isse kabhi bhi chalaya ja sakta hai.
--
-- Ye kuch bhi modify NAHI karta. Sirf har table ki row count dikhata hai.
--
-- KAISE USE KAREIN:
--   1. Cleanup se PEHLE  isko chalayein -> output note kar lein
--   2. Cleanup ke BAAD me isko chalayein -> counts compare karein
--
-- Agar saare counts same hain, to kuch bhi delete nahi hua.
-- Sirf bank_accounts ki count kam hogi (4 se 2) — wo NAYA table hai,
-- aapka business data nahi.

select 'invoices'           as table_name, count(*) as rows from public.invoices
union all select 'invoice_items',        count(*) from public.invoice_items
union all select 'job_cards',            count(*) from public.job_cards
union all select 'job_card_technicians', count(*) from public.job_card_technicians
union all select 'warranty_returns',     count(*) from public.warranty_returns
union all select 'warranty_claims',      count(*) from public.warranty_claims
union all select 'customers',            count(*) from public.customers
union all select 'vendors',              count(*) from public.vendors
union all select 'items',                count(*) from public.items
union all select 'item_master',          count(*) from public.item_master
union all select 'purchases',            count(*) from public.purchases
union all select 'technicians',          count(*) from public.technicians
union all select 'customer_item_prices', count(*) from public.customer_item_prices
union all select 'bank_transactions',    count(*) from public.bank_transactions
union all select 'bank_accounts',        count(*) from public.bank_accounts
order by table_name;

-- Aur paisa kitna hai — ye number hi sabse important hai:
select
  round(sum(coalesce(payment_in,  credit_amount,  0)), 2) as total_in,
  round(sum(coalesce(payment_out, debit_amount,   0)), 2) as total_out,
  round(sum(coalesce(payment_in,  credit_amount,  0))
      - sum(coalesce(payment_out, debit_amount,   0)), 2) as net
  from public.bank_transactions;
