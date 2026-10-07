-- READ-ONLY diagnostic: bank accounts migration ka hisaab.
-- Isko Supabase SQL Editor me chalayein. Koi data modify nahi hota.
--
-- Pichle verify query ka total (108822.39) aur app ka total (118371.29)
-- me 9548.90 ka farak tha. Ye query batata hai ki wo farak kahan se aaya:
--
--   TEST 1  -> koi transaction orphan to nahi (account_id NULL / khatam account)?
--   TEST 2  -> kitni legacy rows hain jahan payment_in/payment_out khaale
--               the aur sirf `amount` bhara tha? (inhe app count karta hai,
--               simple SQL sum nahi karta)
--   TEST 3  -> app ka EXACT logic (resolveInOut) SQL me replicate karke total.
--               Ye 118371.29 aana chahiye.
--   TEST 4  -> har account ka balance, taaki pata chale kahan farak hai.
--
-- NOTE: `bank_transactions` me `total_amount` column nahi hai, isliye raw
-- amount sirf `amount` se aata hai.

-- ===========================================================================
-- TEST 1: Orphan transactions — koi row account se judi nahi?
-- ===========================================================================
select
  count(*)                                                        as total_rows,
  count(*) filter (where bt.account_id is null)                   as null_account_id,
  count(*) filter (
    where bt.account_id is not null
      and not exists (select 1 from public.bank_accounts a where a.id = bt.account_id)
  )                                                               as dangling_account_id
from public.bank_transactions bt;

-- ===========================================================================
-- TEST 2: Legacy "amount-only" rows
--   payment_in/credit_amount aur payment_out/debit_amount dono zero,
--   par amount me kuch hai. Inhe app transaction_type se direction guess
--   karke ginti hai — plain sum inhe 0 maanta hai.
-- ===========================================================================
select
  count(*)                                                as legacy_rows,
  round(sum(coalesce(bt.amount, 0)), 2)                  as legacy_amount_sum,
  string_agg(distinct coalesce(nullif(bt.transaction_type, ''), bt.type, '(blank)'), ' | ')
                                                            as legacy_types
from public.bank_transactions bt
where coalesce(bt.payment_in, bt.credit_amount, 0) = 0
  and coalesce(bt.payment_out, bt.debit_amount, 0) = 0
  and coalesce(bt.amount, 0) <> 0;

-- ===========================================================================
-- TEST 3: App ka exact resolveInOut logic, SQL me.
--   Ye number 118371.29 aana chahiye (aapke live passbook ka balance).
-- ===========================================================================
with resolved as (
  select
    bt.account_id,
    case
      when coalesce(bt.payment_in, bt.credit_amount, 0) = 0
       and coalesce(bt.payment_out, bt.debit_amount, 0) = 0
      then case
             when lower(coalesce(nullif(bt.transaction_type, ''), bt.type, ''))
                  ~ '\+|deposit|capital|credit|income|receipt'
             then coalesce(bt.amount, 0)
             else 0
           end
      else coalesce(bt.payment_in, bt.credit_amount, 0)
    end as p_in,
    case
      when coalesce(bt.payment_in, bt.credit_amount, 0) = 0
       and coalesce(bt.payment_out, bt.debit_amount, 0) = 0
      then case
             when lower(coalesce(nullif(bt.transaction_type, ''), bt.type, ''))
                  ~ '\+|deposit|capital|credit|income|receipt'
             then 0
             else coalesce(bt.amount, 0)
           end
      else coalesce(bt.payment_out, bt.debit_amount, 0)
    end as p_out
  from public.bank_transactions bt
)
select
  round(sum(p_in), 2)                        as total_in,
  round(sum(p_out), 2)                       as total_out,
  round(sum(p_in) - sum(p_out), 2)           as app_total_balance
from resolved;

-- ===========================================================================
-- TEST 4: Har account ka balance (app logic ke saath)
--
--   NOTE: pehle isme `bank_transactions` ko bhi saath join kiya tha — wo
--   CARTESIAN product bana raha tha (529 x 529 rows) aur totals 529 guna
--   inflate ho gaye the. Ab sirf `resolved` CTE se count + sum dono lete hain.
-- ===========================================================================
with resolved as (
  select
    bt.id,
    bt.account_id,
    case
      when coalesce(bt.payment_in, bt.credit_amount, 0) = 0
       and coalesce(bt.payment_out, bt.debit_amount, 0) = 0
      then case
             when lower(coalesce(nullif(bt.transaction_type, ''), bt.type, ''))
                  ~ '\+|deposit|capital|credit|income|receipt'
             then coalesce(bt.amount, 0)
             else 0
           end
      else coalesce(bt.payment_in, bt.credit_amount, 0)
    end as p_in,
    case
      when coalesce(bt.payment_in, bt.credit_amount, 0) = 0
       and coalesce(bt.payment_out, bt.debit_amount, 0) = 0
      then case
             when lower(coalesce(nullif(bt.transaction_type, ''), bt.type, ''))
                  ~ '\+|deposit|capital|credit|income|receipt'
             then 0
             else coalesce(bt.amount, 0)
           end
      else coalesce(bt.payment_out, bt.debit_amount, 0)
    end as p_out
  from public.bank_transactions bt
)
select
  a.id,
  a.name,
  a.account_type,
  a.opening_balance,
  count(r.id)                                  as txn_count,
  round(coalesce(sum(r.p_in), 0), 2)          as total_in,
  round(coalesce(sum(r.p_out), 0), 2)         as total_out,
  round(a.opening_balance
        + coalesce(sum(r.p_in), 0)
        - coalesce(sum(r.p_out), 0), 2)       as balance
from public.bank_accounts a
left join resolved r on r.account_id = a.id
group by a.id, a.name, a.account_type, a.opening_balance
order by a.company_id, a.sort_order, a.id;
