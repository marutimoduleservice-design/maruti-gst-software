-- Maruti Module Service: bank_accounts duplicate cleanup + future-proofing
-- Run ONCE in Supabase Dashboard -> SQL Editor.
--
-- KYU:
--  `bank-accounts-migration.sql` me `on conflict do nothing` likha tha, lekin
--  `bank_accounts` par (company_id, name) ka koi UNIQUE constraint nahi tha.
--  Postgres ko koi conflict dikha hi nahi, isliye har run par naye duplicate
--  accounts ban gaye (abhi 4 hain: 2 asli + 2 duplicate).
--
-- RULE (simple aur safe):
--  Har (company_id, name) group me SABSE CHHOTA id wala account survivor hai.
--  Step 1 pehle har us account ki transactions usi par bhej deta hai, phir
--  Step 2 baaki accounts delete kar deta hai. Isliye survivor ke paas hamesha
--  poori transactions pahunchegi — chahe transactions pehle kisi bhi account
--  par thi.
--
-- SAFE TO RE-RUN (idempotent).
--
-- IMPORTANT: `bank_transactions` me se koi row DELETE nahi hoti — sirf
-- `account_id` column badalta hai (Step 1). `bank_accounts` se duplicate
-- accounts hatate hain (Step 2). Invoices, purchases, job_cards, customers,
-- items, technicians — in me se kisi bhi table ko haath nahi lagta.

-- ---------------------------------------------------------------------------
-- 0) PEHLE: current state dekho (sirf padhna)
-- ---------------------------------------------------------------------------
select
  a.id,
  a.name,
  a.is_default,
  (select count(*) from public.bank_transactions bt where bt.account_id = a.id) as txn_count
  from public.bank_accounts a
 order by a.company_id, a.id;

-- ---------------------------------------------------------------------------
-- STEP 1: Har duplicate account ki transactions uske survivor par bhejo.
--
--        NOTE: `update ... from` me target table ka alias (`bt`) sirf WHERE
--        clause me refer ho sakta hai, FROM ke join condition me nahi.
--        Isliye join `keeper` <-> `old_acc` par hai, aur `bt` ka reference
--        WHERE me.
-- ---------------------------------------------------------------------------
with keeper as (
  select company_id, name, min(id) as keeper_id
    from public.bank_accounts
   group by company_id, name
)
update public.bank_transactions bt
   set account_id = k.keeper_id
  from keeper k
  join public.bank_accounts old_acc
    on old_acc.company_id = k.company_id
   and old_acc.name = k.name
   and old_acc.id <> k.keeper_id
 where old_acc.id = bt.account_id;

-- ---------------------------------------------------------------------------
-- STEP 2: Ab duplicate accounts hata do. (survivor = min id wala)
--
--        IMPORTANT SAFETY GUARD:
--        `and not exists (... bank_transactions ...)`. Ye ensure karta hai ki
--        jis account me transactions bachi hui hain, wo DELETE hi na ho — chahe
--        Step 1 kisi wajah se chala na ho. Matlab paisa kahin nahi ja sakta.
--        Agar koi account reh jaye to wo sirf isliye hai ki usme data hai.
-- ---------------------------------------------------------------------------
delete from public.bank_accounts
 where id <> (
         select min(a2.id)
           from public.bank_accounts a2
          where a2.company_id = bank_accounts.company_id
            and a2.name = bank_accounts.name
       )
   and not exists (
         select 1
           from public.bank_transactions bt
          where bt.account_id = bank_accounts.id
       );

-- ---------------------------------------------------------------------------
-- STEP 3: Ab (company_id, name) UNIQUE — future duplicate impossible.
--        Aage se `bank-accounts-migration.sql` dobara bhi chale to
--        `on conflict do nothing` sach me kaam karega.
-- ---------------------------------------------------------------------------
do $$
begin
  -- Agar Step 2 ke baad bhi koi duplicate bacha hai (jisme transactions hain),
  -- to ye constraint chup-chaap fail na ho — saaf message aaye.
  if exists (
    select 1 from public.bank_accounts
     group by company_id, name having count(*) > 1
  ) then
    raise exception
      'Cleanup adhoora: kuch accounts abhi bhi duplicate hain aur unme transactions hain. '
      'Step 0 ka output dekhein — un transactions ko sahi account par move karna hoga.';
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'bank_accounts_company_name_key'
  ) then
    alter table public.bank_accounts
      add constraint bank_accounts_company_name_key unique (company_id, name);
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- STEP 4: VERIFY — sirf 2 accounts dikhne chahiye:
--        id 1 = Bank / General (Old Pool), saari transactions (529 ya jo bhi)
--        id 2 = Cash Box, 0 transactions
-- ---------------------------------------------------------------------------
select
  a.id,
  a.name,
  a.account_type,
  a.opening_balance,
  a.is_default,
  a.active,
  (select count(*) from public.bank_transactions bt where bt.account_id = a.id) as txn_count
  from public.bank_accounts a
 order by a.company_id, a.sort_order, a.id;

-- Aur business data bilkul same hai ya nahi — ye numbers 118371.29 hone CHAHIYE:
select
  count(*)                                               as bank_rows,
  round(sum(coalesce(payment_in,  credit_amount, 0)), 2) as total_in,
  round(sum(coalesce(payment_out, debit_amount,  0)), 2) as total_out,
  round(sum(coalesce(payment_in,  credit_amount, 0))
      - sum(coalesce(payment_out, debit_amount,  0)), 2) as net
  from public.bank_transactions;
