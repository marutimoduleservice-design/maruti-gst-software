-- ============================================================================
-- assign-accounts-and-transfers.sql
--
-- Kya karta hai:
--   1. 33 purani entries ko sahi account me daalta hai
--        Cash mode  -> Cash account
--        Bank/UPI/Cheque -> SBI
--   2. Do "missing" internal transfer entries insert karta hai (income/expense nahi):
--        SBI -> Cash    1,40,022.16   (cash tha bank me, shop me aaya)
--        SBI -> Surat      26,591.00  (aapke balance ke hisaab se)
--   3. Har account ka final balance verify karta hai.
--
-- Opening balance ki zaroorat NAHI padti — saara hisab transaction se baithta hai.
--
-- PREREQ (app ke Bank Passbook -> Manage Accounts se bana lijiye):
--   * ek  BANK  account jiska naam "SBI"  ho
--   * ek  BANK  account jiska naam "The Surat District Co-Operative Bank Ltd." ho
--   * ek  CASH  account (maujooda "Cash Box" chalega)
--
-- Ye script TRANSACTIONAL hai: kuch galat hua to sab rollback ho jaayega.
-- Do baar chalana safe hai (idempotent).
-- ============================================================================

begin;

do $$
declare
  v_cash_id       bigint;
  v_cash_name     text;
  v_sbi_id        bigint;
  v_sbi_name      text;
  v_surat_id      bigint;
  v_surat_name    text;
  v_company       bigint;
  v_rows_total    bigint := 0;
  v_rows_cash     bigint := 0;
  v_rows_bank     bigint := 0;
  v_rows_left     bigint := 0;
  v_bad_company   bigint := 0;
  v_has_transfers boolean := false;
  v_open_cash     numeric;
  v_open_sbi      numeric;
  v_open_surat    numeric;
begin
  -----------------------------------------------------------------------
  -- STEP 0: accounts dhoondho. Na mile toh seedha rok do.
  -----------------------------------------------------------------------
  select id, name into v_cash_id, v_cash_name
    from public.bank_accounts
   where lower(name) in ('cash box', 'cash')
     and account_type = 'Cash'
     and active
   order by is_default desc, id
   limit 1;

  select id, name into v_sbi_id, v_sbi_name
    from public.bank_accounts
   where active
     and (name ilike '%sbi%' or name ilike '%state bank%')
   order by id limit 1;

  select id, name into v_surat_id, v_surat_name
    from public.bank_accounts
   where active
     and (name ilike '%surat%' or name ilike '%co-operative%' or name ilike '%cooperative%')
   order by id limit 1;

  if v_cash_id is null then
    raise exception 'CASH account nahi mila. App > Bank Passbook > Manage Accounts me ek Cash account banao (jaise "Cash").';
  end if;
  if v_sbi_id is null then
    raise exception 'SBI account nahi mila. Manage Accounts me ek BANK account banao jiska naam "SBI" ho.';
  end if;
  if v_surat_id is null then
    raise exception 'Surat Bank account nahi mila. Manage Accounts me ek BANK account banao jiska naam "The Surat District Co-Operative Bank Ltd." ho.';
  end if;
  if v_sbi_id = v_surat_id then
    raise exception 'SBI aur Surat same account lag rahe hain — dono ka naam alag karo.';
  end if;

  select company_id into v_company from public.bank_accounts where id = v_cash_id;

  if exists (select 1 from public.bank_accounts where id in (v_sbi_id, v_surat_id)
               and company_id is distinct from v_company) then
    raise exception 'Teenon accounts ek hi company me nahi hain. Check karo (company_id = %).', v_company;
  end if;

  select opening_balance into v_open_cash  from public.bank_accounts where id = v_cash_id;
  select opening_balance into v_open_sbi   from public.bank_accounts where id = v_sbi_id;
  select opening_balance into v_open_surat from public.bank_accounts where id = v_surat_id;

  -----------------------------------------------------------------------
  -- Pehle ek report dikhao, phir kaam karo.
  -----------------------------------------------------------------------
  select count(*) into v_rows_total
    from public.bank_transactions
   where is_transfer is not true;

  select count(*) into v_rows_cash
    from public.bank_transactions
   where is_transfer is not true
     and lower(coalesce(payment_mode,'')) = 'cash';

  select count(*) into v_rows_bank
    from public.bank_transactions
   where is_transfer is not true
     and lower(coalesce(payment_mode,'')) in ('bank / upi','bank','upi','cheque','neft','rtgs','imps','bank transfer');

  select count(*) into v_rows_left
    from public.bank_transactions
   where is_transfer is not true
     and lower(coalesce(payment_mode,'')) not in
         ('cash','bank / upi','bank','upi','cheque','neft','rtgs','imps','bank transfer');

  select exists (select 1 from public.bank_transactions where is_transfer is true)
    into v_has_transfers;

  -- company guard: sirf us company ki rows hilao jinme ye accounts hain
  select count(*) into v_bad_company
    from public.bank_transactions
   where coalesce(company_id, v_company) is distinct from v_company;

  raise notice '------------------------------------------------------------';
  raise notice 'COMPANY   : %', v_company;
  raise notice 'CASH      : id=%  "%"   opening=%', v_cash_id,  v_cash_name,  v_open_cash;
  raise notice 'SBI       : id=%  "%"   opening=%', v_sbi_id,   v_sbi_name,   v_open_sbi;
  raise notice 'SURAT     : id=%  "%"   opening=%', v_surat_id, v_surat_name, v_open_surat;
  raise notice 'ROWS      : total=%  cash=%  bank=%  OTHER-MODE=%',
                 v_rows_total, v_rows_cash, v_rows_bank, v_rows_left;
  raise notice 'TRANSFERS pehle se maujood: %', v_has_transfers;
  raise notice 'Is company se bahar ki rows (chhoot jayengi): %', v_bad_company;
  raise notice '------------------------------------------------------------';

  if v_rows_left > 0 then
    raise notice 'DHYAN: % rows ka payment_mode in list se bahar hai — wo assign nahi honge.', v_rows_left;
  end if;
  if v_rows_total < 30 then
    raise exception 'Sirf % normal rows mili (33 thi). Kuch galat hai — ruk jao.', v_rows_total;
  end if;

  -----------------------------------------------------------------------
  -- STEP 1: entries ko account me daalo
  -----------------------------------------------------------------------
  update public.bank_transactions bt
     set account_id = v_cash_id,
         company_id = v_company
   where coalesce(bt.company_id, v_company) = v_company
     and coalesce(bt.is_transfer, false) is not true
     and lower(coalesce(bt.payment_mode,'')) = 'cash'
     and bt.account_id is distinct from v_cash_id;

  update public.bank_transactions bt
     set account_id = v_sbi_id,
         company_id = v_company
   where coalesce(bt.company_id, v_company) = v_company
     and coalesce(bt.is_transfer, false) is not true
     and lower(coalesce(bt.payment_mode,'')) in
         ('bank / upi','bank','upi','cheque','neft','rtgs','imps','bank transfer')
     and bt.account_id is distinct from v_sbi_id;

  -----------------------------------------------------------------------
  -- STEP 2: do missing transfers insert karo (app ke shape me, bilkul same)
  -----------------------------------------------------------------------
  if not exists (
       select 1 from public.bank_transactions
        where is_transfer is true
          and particulars = 'Transfer: SBI -> Cash (purana cash withdrawal)')
  then
    insert into public.bank_transactions
      (transaction_date, particulars, notes, transaction_type, amount,
       payment_mode, is_transfer, credit_amount, debit_amount,
       account_id, party_name, type, payment_in, payment_out,
       transfer_to_account_id, company_id)
    values
      ('2026-10-06', 'Transfer: SBI -> Cash (purana cash withdrawal)',
       'Transfer: SBI -> Cash (purana cash withdrawal)',
       'Account Transfer (+/-)', 140022.16, 'Internal Transfer', true, 0, 140022.16,
       v_sbi_id, v_cash_name, 'debit', 0, 140022.16, v_cash_id, v_company),
      ('2026-10-06', 'Transfer: SBI -> Cash (purana cash withdrawal)',
       'Transfer: SBI -> Cash (purana cash withdrawal)',
       'Account Transfer (+/-)', 140022.16, 'Internal Transfer', true, 140022.16, 0,
       v_cash_id, v_sbi_name, 'credit', 140022.16, 0, v_sbi_id, v_company);
  end if;

  if not exists (
       select 1 from public.bank_transactions
        where is_transfer is true
          and particulars = 'Transfer: SBI -> The Surat District Co-Operative Bank Ltd.')
  then
    insert into public.bank_transactions
      (transaction_date, particulars, notes, transaction_type, amount,
       payment_mode, is_transfer, credit_amount, debit_amount,
       account_id, party_name, type, payment_in, payment_out,
       transfer_to_account_id, company_id)
    values
      ('2026-10-06', 'Transfer: SBI -> ' || v_surat_name,
       'Transfer: SBI -> ' || v_surat_name,
       'Account Transfer (+/-)', 26591.00, 'Internal Transfer', true, 0, 26591.00,
       v_sbi_id, v_surat_name, 'debit', 0, 26591.00, v_surat_id, v_company),
      ('2026-10-06', 'Transfer: SBI -> ' || v_surat_name,
       'Transfer: SBI -> ' || v_surat_name,
       'Account Transfer (+/-)', 26591.00, 'Internal Transfer', true, 26591.00, 0,
       v_surat_id, v_sbi_name, 'credit', 26591.00, 0, v_sbi_id, v_company);
  end if;

end $$;

-- ============================================================================
-- VERIFY 1: abhi account-wise balance kya aa raha hai
-- ============================================================================
select
  a.id,
  a.name,
  a.account_type,
  round(a.opening_balance, 2)                                    as opening,
  round(coalesce(t.in_sum, 0), 2)                                as total_in,
  round(coalesce(t.out_sum, 0), 2)                               as total_out,
  count(bt.id)                                                   as txn_count,
  round(a.opening_balance + coalesce(t.in_sum,0) - coalesce(t.out_sum,0), 2)
                                                                 as balance
from public.bank_accounts a
left join public.bank_transactions bt on bt.account_id = a.id
left join (
    select account_id,
           sum(coalesce(payment_in, 0))  as in_sum,
           sum(coalesce(payment_out, 0)) as out_sum
      from public.bank_transactions
     group by account_id
) t on t.account_id = a.id
where a.active
group by a.id, a.name, a.account_type, a.opening_balance, t.in_sum, t.out_sum
order by a.sort_order, a.id;

-- ============================================================================
-- VERIFY 2: grand total 1,21,567.60 hona chahiye
-- ============================================================================
select
  round(sum(a.opening_balance + coalesce(t.in_sum,0) - coalesce(t.out_sum,0)), 2)
    as grand_total,
  count(distinct a.id) as accounts_count
from public.bank_accounts a
left join (
    select account_id,
           sum(coalesce(payment_in, 0))  as in_sum,
           sum(coalesce(payment_out, 0)) as out_sum
      from public.bank_transactions
     group by account_id
) t on t.account_id = a.id
where a.active;

-- ============================================================================
-- VERIFY 3: koi bhi transaction bina account ke toh nahi
-- ============================================================================
select count(*) as orphan_rows
from public.bank_transactions
where is_transfer is not true
  and account_id is null;

commit;
