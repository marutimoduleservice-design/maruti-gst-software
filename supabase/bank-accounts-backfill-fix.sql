-- Maruti Module Service: bank_accounts backfill ke reh gaye rows theek karo
-- Run ONCE in Supabase Dashboard -> SQL Editor.
--
-- KYU:
--  `bank-accounts-migration.sql` ka backfill ye condition use karta tha:
--
--      where a.company_id = bt.company_id
--
--  Agar kisi purani row ka `company_id` NULL hai, to ye comparison NULL ho
--  jaata hai aur woh row KABHI update nahi hoti. Result: kuch transactions
--  `account_id = NULL` reh gaye — wo app me dikhti hain (app account ke bina
--  sab dikhata tha), lekin kisi account ke balance me count nahi hoti.
--
--  Isi wajah se:
--      app ka total        = 118371.29   (sab rows)
--      per-account total   = 108822.39   (account se judge rows)
--      farak               =   9548.90
--
-- Ye script har NULL / dangling account_id ko sahi "Old Pool" par bhejta hai.
-- Ye KABHI koi row DELETE nahi karta, KABHI amount/date/particulars nahi
-- badalta — sirf `account_id` column set karta hai.
--
-- SAFE TO RE-RUN (idempotent).

-- ---------------------------------------------------------------------------
-- PEHLE: kitni rows reh gayi thi? (ye number note kar lein)
-- ---------------------------------------------------------------------------
select 'BEFORE' as stage,
       count(*)                                                          as total_rows,
       count(*) filter (where account_id is null)                        as null_account,
       count(*) filter (where account_id is null and company_id is null)  as null_acct_null_company,
       count(*) filter (where account_id is null and company_id is not null) as null_acct_has_company,
       count(*) filter (
         where account_id is not null
           and not exists (select 1 from public.bank_accounts a where a.id = bank_transactions.account_id)
       )                                                                 as dangling_account
  from public.bank_transactions;

-- ---------------------------------------------------------------------------
-- STEP 1: jinka company_id hai, unhe apne hi company ke Old Pool par bhejo
-- ---------------------------------------------------------------------------
update public.bank_transactions bt
   set account_id = k.id
  from public.bank_accounts k
 where bt.account_id is null
   and bt.company_id is not null
   and k.company_id = bt.company_id
   and k.name = 'Bank / General (Old Pool)';

-- ---------------------------------------------------------------------------
-- STEP 2: jinka company_id NULL hai (purani import rows), unhe company 1 ke
--         Old Pool par bhejo. `sc()` bhi company 1 hi filter karta hai, to
--         wahi ek hi sahi jagah hai.
-- ---------------------------------------------------------------------------
update public.bank_transactions bt
   set account_id = k.id
  from public.bank_accounts k
 where bt.account_id is null
   and bt.company_id is null
   and k.company_id = 1
   and k.name = 'Bank / General (Old Pool)';

-- ---------------------------------------------------------------------------
-- STEP 3: jo account_id kisi hata diye gaye (duplicate) account par point
--         kar raha tha, use bhi sahi pool par le jaao
-- ---------------------------------------------------------------------------
update public.bank_transactions bt
   set account_id = k.id
  from public.bank_accounts k
 where bt.account_id is not null
   and not exists (select 1 from public.bank_accounts a where a.id = bt.account_id)
   and k.name = 'Bank / General (Old Pool)'
   and k.company_id = coalesce(bt.company_id, 1);

-- ---------------------------------------------------------------------------
-- BAAD ME: null_account aur dangling_account dono 0 hona chahiye
-- ---------------------------------------------------------------------------
select 'AFTER' as stage,
       count(*)                                                          as total_rows,
       count(*) filter (where account_id is null)                        as null_account,
       count(*) filter (where account_id is null and company_id is null)  as null_acct_null_company,
       count(*) filter (where account_id is null and company_id is not null) as null_acct_has_company,
       count(*) filter (
         where account_id is not null
           and not exists (select 1 from public.bank_accounts a where a.id = bank_transactions.account_id)
       )                                                                 as dangling_account
  from public.bank_transactions;

-- ---------------------------------------------------------------------------
-- FINAL CHECK: ye 118371.29 aana chahiye.
--   Agar ye number 108822.39 reh gaya, to koi transaction phir bhi kisi
--   account se nahi jui — stop karein, batayiye, hum aur dekhenge.
-- ---------------------------------------------------------------------------
select
  round(sum(coalesce(a.opening_balance, 0)
            + coalesce(in_.total_in, 0)
            - coalesce(out_.total_out, 0)), 2) as per_account_total_balance
  from public.bank_accounts a
  left join (
    select account_id, sum(coalesce(payment_in, credit_amount, 0)) as total_in
      from public.bank_transactions group by account_id
  ) in_ on in_.account_id = a.id
  left join (
    select account_id, sum(coalesce(payment_out, debit_amount, 0)) as total_out
      from public.bank_transactions group by account_id
  ) out_ on out_.account_id = a.id;

-- Aur row counts apne aap check ho jayenge: saare same rehne chahiye.
-- (`bank_transactions` ki count kabhi nahi badlegi — sirf account_id set hua hai.)
