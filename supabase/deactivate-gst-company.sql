-- ============================================================================
-- deactivate-gst-company.sql
--
-- Login page aur post-login dono jagah 2 companies dikh rahi hain kyunki
-- `companies` table me 2 active rows hain. GST wali ko `active = false`
-- kar deta hai — UI (Login dropdown + company switcher) se gayab ho jaayegi,
-- data bilkul safe rehta hai (kuch delete nahi hota).
--
-- SAFETY:
--   * Aakhri active company ko kabhi deactivate NAHI karta.
--   * Agar localStorage me purana company_id bacha ho, app `list[0]` par
--     fallback kar deta hai (Login.tsx:25, App.tsx:147) — kaam karega.
-- Transactional: kuch galat hua to rollback.
-- ============================================================================

begin;

-- STEP 1: companies ka report
select id, name, tax_mode, gstin, invoice_prefix, financial_year_start, active
  from public.companies
 order by id;

-- STEP 2: company 2 ka data-kitna hai (batayega delete safe hai ya nahi)
do $$
declare
  tables text[] := array[
    'customers','vendors','items','item_master','purchases','invoices','invoice_items',
    'job_cards','job_card_technicians','bank_transactions','bank_accounts',
    'warranty_claims','warranty_returns','customer_opening_balances',
    'company_business_settings','company_settings','technicians','customer_item_prices'
  ];
  t    text;
  v_n  text;
begin
  foreach t in array tables loop
    if exists (select 1 from information_schema.tables
                where table_schema = 'public' and table_name = t) then
      execute format(
        'select (select count(*) from public.%I where company_id = 2)::text'
        || ' || '' (total '' || (select count(*) from public.%I)::text || '')''',
        t, t) into v_n;
      raise notice 'company 2 -> % = %', t, v_n;
    end if;
  end loop;
end $$;

-- STEP 3: GST wali company deactivate (aakhri active ko chhodega nahi)
do $$
declare
  rec     record;
  v_total int;
  v_done  int := 0;
begin
  select count(*) into v_total from public.companies where active;

  for rec in
    select id, name, tax_mode from public.companies
     where active
       and lower(coalesce(trim(tax_mode), 'non-gst')) <> 'non-gst'
     order by id
  loop
    if v_total - v_done <= 1 then
      raise notice 'STOP: ek active company chhodni padegi — id=% "%" (tax_mode=%) deactivate NAHI ki.',
                    rec.id, rec.name, rec.tax_mode;
      exit;
    end if;

    update public.companies set active = false where id = rec.id;
    v_done := v_done + 1;
    raise notice 'DEACTIVATED id=% "%" (tax_mode=%)', rec.id, rec.name, rec.tax_mode;
  end loop;

  if v_done = 0 then
    raise notice 'Koi active GST company nahi mili — deactivation nahi hua. STEP 1 output dekho.';
  end if;
end $$;

-- STEP 4: verify
select id, name, tax_mode, gstin, active,
       (select count(*) from public.companies where active) as active_count
  from public.companies
 order by id;

commit;
