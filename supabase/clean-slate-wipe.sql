-- =============================================================================
-- CLEAN SLATE: sab transactional data delete karo (NEW financial year start)
-- =============================================================================
-- WARNING: Ye PERMANENT delete hai. Google Sheet me aapka data safe hai, to
--          ghabraye mat — sheet se wapas daal denge.
--
-- Ye kya NAHI karega:
--   - koi table drop nahi hoga (schema safe)
--   - RLS policies safe rahenge
--   - company_settings (company details, print terms) SAFE rahega
-- =============================================================================

-- 1) Pehle count dikhao (delete se pehle ka record)
select 'bank_transactions' as tbl, count(*) from public.bank_transactions
union all select 'invoices', count(*) from public.invoices
union all select 'invoice_items', count(*) from public.invoice_items
union all select 'purchases', count(*) from public.purchases
union all select 'job_cards', count(*) from public.job_cards
union all select 'warranty_claims', count(*) from public.warranty_claims
union all select 'items', count(*) from public.items
union all select 'item_master', count(*) from public.item_master
union all select 'customer_item_prices', count(*) from public.customer_item_prices
union all select 'technicians', count(*) from public.technicians;

-- =============================================================================
-- 2) DELETE transactional data  (customers + vendors BHI — kyunki sheet se
--    fresh load karenge, warna duplicate code milenge)
-- =============================================================================
delete from public.invoice_items;
delete from public.invoices;
delete from public.bank_transactions;
delete from public.purchases;
delete from public.job_cards;
delete from public.warranty_claims;
delete from public.customer_item_prices;
delete from public.items;
delete from public.item_master;
delete from public.customers;
delete from public.vendors;
delete from public.technicians;

-- 3) Sequences reset (naye codes 1 se shuru honge)
do $$
declare t text;
begin
  foreach t in array array['invoices','bank_transactions','purchases','job_cards','warranty_claims','items','item_master','customers','vendors','technicians','customer_item_prices'] loop
    begin
      execute format('alter sequence public.%I_id_seq restart with 1', t);
    exception when others then
      null; -- sequence nahi hai to chhod do, koi problem nahi
    end;
  end loop;
end $$;

-- 4) Confirm: sab zero hona chahiye (company_settings ke alawa)
select 'bank_transactions' as tbl, count(*) from public.bank_transactions
union all select 'invoices', count(*) from public.invoices
union all select 'invoice_items', count(*) from public.invoice_items
union all select 'purchases', count(*) from public.purchases
union all select 'job_cards', count(*) from public.job_cards
union all select 'items', count(*) from public.items
union all select 'customers', count(*) from public.customers
union all select 'vendors', count(*) from public.vendors
union all select 'company_settings (SAFE - 1 rehna chahiye)', count(*) from public.company_settings;
