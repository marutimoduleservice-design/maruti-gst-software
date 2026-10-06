-- ============================================================================
-- assign-accounts-and-transfers.sql      (v2 — real account names ke saath)
--
-- Kya karta hai:
--   1. Opening balances ko 0 karta hai (warna paisa double-count hoga —
--      33 transactions ka net already = 1,21,567.60 hai).
--   2. 33 purani entries sahi account me daalta hai
--        Cash mode              -> "Cash"
--        Bank / UPI / Cheque    -> "MAYUR ASHOK VAIRALE"   (aapka SBI)
--   3. Do missing internal transfer entries insert karta hai (income/expense NAHI):
--        SBI -> Cash   1,40,022.16   (cash tha bank me, shop me aaya)
--        SBI -> Surat     26,591.00  (Surat bank ka paisa)
--   4. Verify karta hai.
--
-- Expected final balances:
--        MAYUR ASHOK VAIRALE   23,564.25
--        MARUTI MODULE SERVICE 26,591.00
--        Cash                  71,412.35
--        GRAND TOTAL          1,21,567.60
--
-- TRANSACTIONAL: kuch galat hua to sab rollback. Do baar chalana safe hai.
-- ============================================================================

begin;

do $$
declare
  v_cash_id     bigint;  v_cash_name   text;  v_cash_open   numeric;
  v_sbi_id      bigint;  v_sbi_name    text;  v_sbi_open    numeric;
  v_surat_id    bigint;  v_surat_name  text;  v_surat_open  numeric;
  v_company     bigint;
  v_rows_total  bigint := 0;
  v_rows_moved  bigint := 0;
  v_rows_left   bigint := 0;
  v_open_reset  int := 0;
begin
  ------------------------------------------------------------------
  -- STEP 0: accounts dhoondho (aapke asli naam se)
  ------------------------------------------------------------------
  select id, name, opening_balance into v_sbi_id, v_sbi_name, v_sbi_open
    from public.bank_accounts
   where lower(trim(name)) = 'mayur ashok vairale'
     and account_type = 'Bank' and active
   limit 1;

  select id, name, opening_balance into v_surat_id, v_surat_name, v_surat_open
    from public.bank_accounts
   where lower(trim(name)) = 'maruti module service'
     and account_type = 'Bank' and active
   limit 1;

  -- Cash: prefer exact "Cash", warna "Cash Box"
  select id, name, opening_balance into v_cash_id, v_cash_name, v_cash_open
    from public.bank_accounts
   where account_type = 'Cash' and active
     and lower(trim(name)) in ('cash', 'cash box')
   order by (lower(trim(name)) = 'cash') desc, is_default desc, id
   limit 1;

  if v_sbi_id is null then
    raise exception 'SBI account nahi mila (naam "MAYUR ASHOK VAIRALE" Bank type). Manage Accounts me check karo.';
  end if;
  if v_surat_id is null then
    raise exception 'Surat account nahi mila (naam "MARUTI MODULE SERVICE" Bank type). Manage Accounts me check karo.';
  end if;
  if v_cash_id is null then
    raise exception 'Cash account nahi mila (naam "Cash" ya "Cash Box", type Cash). Manage Accounts me check karo.';
  end if;
  if v_sbi_id = v_surat_id or v_sbi_id = v_cash_id or v_surat_id = v_cash_id then
    raise exception 'Teenon accounts alag-alag hone chahiye. ids: sbi=% surat=% cash=%',
                    v_sbi_id, v_surat_id, v_cash_id;
  end if;

  select company_id into v_company from public.bank_accounts where id = v_cash_id;

  if exists (select 1 from public.bank_accounts
              where id in (v_sbi_id, v_surat_id)
                and company_id is distinct from v_company) then
    raise exception 'SBI aur Surat ek hi company me nahi hain (company_id = %).', v_company;
  end if;

  ------------------------------------------------------------------
  -- Row count (sirf isi company ki)
  ------------------------------------------------------------------
  select count(*) into v_rows_total
    from public.bank_transactions
   where coalesce(company_id, v_company) = v_company
     and coalesce(is_transfer, false) is not true;

  if v_rows_total < 30 then
    raise exception 'Is company me sirf % normal rows mili (33 thi). Company galat lag rahi hai — ruk jao. company_id=%',
                    v_rows_total, v_company;
  end if;

  raise notice '------------------------------------------------------------';
  raise notice 'COMPANY : %', v_company;
  raise notice 'SBI     : id=% "%"  (opening tha %)', v_sbi_id,   v_sbi_name,   v_sbi_open;
  raise notice 'SURAT   : id=% "%"  (opening tha %)', v_surat_id, v_surat_name, v_surat_open;
  raise notice 'CASH    : id=% "%"  (opening tha %)', v_cash_id,  v_cash_name,  v_cash_open;
  raise notice 'ROWS    : % normal rows mile', v_rows_total;
  raise notice '------------------------------------------------------------';

  ------------------------------------------------------------------
  -- STEP 1: openings -> 0
  ------------------------------------------------------------------
  update public.bank_accounts
     set opening_balance = 0
   where id in (v_sbi_id, v_surat_id, v_cash_id)
     and opening_balance is distinct from 0;
  get diagnostics v_open_reset = row_count;
  raise notice 'Openings reset kiye: % account(s)', v_open_reset;

  ------------------------------------------------------------------
  -- STEP 2: entries ko account me daalo
  ------------------------------------------------------------------
  update public.bank_transactions bt
     set account_id = v_cash_id, company_id = v_company
   where coalesce(bt.company_id, v_company) = v_company
     and coalesce(bt.is_transfer, false) is not true
     and lower(coalesce(bt.payment_mode,'')) = 'cash'
     and bt.account_id is distinct from v_cash_id;
  get diagnostics v_rows_moved = row_count;
  raise notice 'Cash entries move hui: %', v_rows_moved;

  v_rows_moved := 0;
  update public.bank_transactions bt
     set account_id = v_sbi_id, company_id = v_company
   where coalesce(bt.company_id, v_company) = v_company
     and coalesce(bt.is_transfer, false) is not true
     and lower(coalesce(bt.payment_mode,'')) in
         ('bank / upi','bank','upi','cheque','neft','rtgs','imps','bank transfer')
     and bt.account_id is distinct from v_sbi_id;
  get diagnostics v_rows_moved = row_count;
  raise notice 'Bank/Cheque entries move hui: %', v_rows_moved;

  -- kitni rows ka mode abhi bhi unknown hai?
  select count(*) into v_rows_left
    from public.bank_transactions bt
   where coalesce(bt.company_id, v_company) = v_company
     and coalesce(bt.is_transfer, false) is not true
     and lower(coalesce(bt.payment_mode,'')) not in
         ('cash','bank / upi','bank','upi','cheque','neft','rtgs','imps','bank transfer');
  if v_rows_left > 0 then
    raise notice 'DHYAN: % rows ka payment_mode unknown hai — wo assign nahi honge.', v_rows_left;
  end if;

  ------------------------------------------------------------------
  -- STEP 3: do missing transfers (app ke exact shape me)
  ------------------------------------------------------------------
  if not exists (select 1 from public.bank_transactions
                  where is_transfer is true
                    and particulars = 'Transfer: ' || v_sbi_name || ' -> ' || v_cash_name
                      || ' (purana cash withdrawal)')
  then
    insert into public.bank_transactions
      (transaction_date, particulars, notes, transaction_type, amount,
       payment_mode, is_transfer, credit_amount, debit_amount,
       account_id, party_name, type, payment_in, payment_out,
       transfer_to_account_id, company_id)
    values
      ('2026-10-06',
       'Transfer: ' || v_sbi_name || ' -> ' || v_cash_name || ' (purana cash withdrawal)',
       'Transfer: ' || v_sbi_name || ' -> ' || v_cash_name || ' (purana cash withdrawal)',
       'Account Transfer (+/-)', 140022.16, 'Internal Transfer', true, 0, 140022.16,
       v_sbi_id, v_cash_name, 'debit', 0, 140022.16, v_cash_id, v_company),
      ('2026-10-06',
       'Transfer: ' || v_sbi_name || ' -> ' || v_cash_name || ' (purana cash withdrawal)',
       'Transfer: ' || v_sbi_name || ' -> ' || v_cash_name || ' (purana cash withdrawal)',
       'Account Transfer (+/-)', 140022.16, 'Internal Transfer', true, 140022.16, 0,
       v_cash_id, v_sbi_name, 'credit', 140022.16, 0, v_sbi_id, v_company);
    raise notice 'Transfer 1 insert: SBI -> Cash  140022.16';
  else
    raise notice 'Transfer 1 pehle se hai — skip';
  end if;

  if not exists (select 1 from public.bank_transactions
                  where is_transfer is true
                    and particulars = 'Transfer: ' || v_sbi_name || ' -> ' || v_surat_name)
  then
    insert into public.bank_transactions
      (transaction_date, particulars, notes, transaction_type, amount,
       payment_mode, is_transfer, credit_amount, debit_amount,
       account_id, party_name, type, payment_in, payment_out,
       transfer_to_account_id, company_id)
    values
      ('2026-10-06', 'Transfer: ' || v_sbi_name || ' -> ' || v_surat_name,
       'Transfer: ' || v_sbi_name || ' -> ' || v_surat_name,
       'Account Transfer (+/-)', 26591.00, 'Internal Transfer', true, 0, 26591.00,
       v_sbi_id, v_surat_name, 'debit', 0, 26591.00, v_surat_id, v_company),
      ('2026-10-06', 'Transfer: ' || v_sbi_name || ' -> ' || v_surat_name,
       'Transfer: ' || v_sbi_name || ' -> ' || v_surat_name,
       'Account Transfer (+/-)', 26591.00, 'Internal Transfer', true, 26591.00, 0,
       v_surat_id, v_sbi_name, 'credit', 26591.00, 0, v_sbi_id, v_company);
    raise notice 'Transfer 2 insert: SBI -> Surat  26591.00';
  else
    raise notice 'Transfer 2 pehle se hai — skip';
  end if;

end $$;

-- ============================================================================
-- VERIFY 1: account-wise balance
-- ============================================================================
with agg as (
  select account_id,
         sum(coalesce(payment_in, 0))  as in_sum,
         sum(coalesce(payment_out, 0)) as out_sum,
         count(*)                      as cnt
    from public.bank_transactions
   group by account_id
)
select
  a.id,
  a.name,
  a.account_type,
  round(a.opening_balance, 2)                    as opening,
  coalesce(g.cnt, 0)                             as txns,
  round(coalesce(g.in_sum, 0), 2)                as total_in,
  round(coalesce(g.out_sum, 0), 2)               as total_out,
  round(a.opening_balance + coalesce(g.in_sum,0) - coalesce(g.out_sum,0), 2) as balance
from public.bank_accounts a
left join agg g on g.account_id = a.id
where a.active
order by a.sort_order, a.id;

-- ============================================================================
-- VERIFY 2: grand total  -> 121567.60
-- ============================================================================
with agg as (
  select account_id,
         sum(coalesce(payment_in, 0))  as in_sum,
         sum(coalesce(payment_out, 0)) as out_sum
    from public.bank_transactions
   group by account_id
)
select
  count(distinct a.id) as accounts,
  round(coalesce(sum(a.opening_balance + coalesce(g.in_sum,0) - coalesce(g.out_sum,0)),0), 2)
    as grand_total
from public.bank_accounts a
left join agg g on g.account_id = a.id
where a.active;

-- ============================================================================
-- VERIFY 3: orphan rows (account_id khaali)
-- ============================================================================
select count(*) as orphan_rows
from public.bank_transactions
where coalesce(is_transfer, false) is not true
  and account_id is null;

-- ============================================================================
-- VERIFY 4: transfers dikhao
-- ============================================================================
select id, transaction_date, left(particulars, 70) as particulars,
       round(payment_in, 2) as credit, round(payment_out, 2) as debit, account_id
from public.bank_transactions
where is_transfer is true
order by id;

commit;
