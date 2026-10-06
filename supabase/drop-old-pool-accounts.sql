-- ============================================================================
-- drop-old-pool-accounts.sql
--
-- "Bank / General (Old Pool)" account hataata hai — ab uska kuch kaam nahi
-- kyunki saari 33 entries SBI / Cash me shift ho chuki hain.
--
-- SAFETY:
--   * Sirf us account ko delete karta hai jiske paas 0 transactions hain.
--   * Agar kisi account par transactions hain to SKIP karta hai (notice ke saath).
--   * Delete ke baad jis company ka default account chala gaya, wahan
--     "MAYUR ASHOK VAIRALE" (nahi to koi bhi Bank account) default bana deta hai.
--
-- Transactional: kuch galat hua to rollback.
-- ============================================================================

begin;

-- STEP 1: kitni transactions hain har Old Pool account par (report)
select a.id, a.company_id, a.name, a.is_default, a.active,
       (select count(*) from public.bank_transactions bt where bt.account_id = a.id) as txn_count
  from public.bank_accounts a
 where a.name = 'Bank / General (Old Pool)';

-- STEP 2: sirf 0-transaction wale delete karo
do $$
declare
  rec    record;
  v_cnt  bigint;
  v_del  int := 0;
begin
  for rec in
    select id, company_id from public.bank_accounts
     where name = 'Bank / General (Old Pool)'
     order by id
  loop
    select count(*) into v_cnt from public.bank_transactions where account_id = rec.id;
    if v_cnt > 0 then
      raise notice 'SKIP id=% — us par % transactions hain, delete nahi kiya.', rec.id, v_cnt;
    else
      delete from public.bank_accounts where id = rec.id;
      v_del := v_del + 1;
      raise notice 'DELETED id=% (company_id=%)', rec.id, rec.company_id;
    end if;
  end loop;
  raise notice 'Total deleted: %', v_del;
end $$;

-- STEP 3: default account theek karo (warna nayi entry me "कोई अकाउंट नहीं" aayega)
do $$
declare
  c     record;
  v_id  bigint;
begin
  for c in select distinct company_id from public.bank_accounts where active
  loop
    if not exists (
         select 1 from public.bank_accounts
          where company_id = c.company_id and is_default and active
       )
    then
      select id into v_id from public.bank_accounts
       where company_id = c.company_id and active
         and lower(trim(name)) = 'mayur ashok vairale'
       limit 1;

      if v_id is null then
        select id into v_id from public.bank_accounts
         where company_id = c.company_id and active and account_type = 'Bank'
         order by sort_order, id limit 1;
      end if;

      if v_id is not null then
        update public.bank_accounts set is_default = true where id = v_id;
        raise notice 'Default account set -> id=% (company %)', v_id, c.company_id;
      else
        raise notice 'WARNING: company % me koi Bank account nahi mila — default set nahi hua.', c.company_id;
      end if;
    end if;
  end loop;
end $$;

-- STEP 4: verify — ab kaunse accounts bache
select a.id, a.company_id, a.name, a.account_type,
       a.opening_balance, a.is_default, a.active,
       (select count(*) from public.bank_transactions bt where bt.account_id = a.id) as txn_count
  from public.bank_accounts a
 order by a.company_id, a.sort_order, a.id;

-- STEP 5: total abhi bhi 121567.60 hona chahiye
with agg as (
  select account_id,
         sum(coalesce(payment_in,0))  as i,
         sum(coalesce(payment_out,0)) as o
    from public.bank_transactions group by account_id
)
select
  (select count(*) from public.bank_accounts where active)      as active_accounts,
  (select count(*) from public.bank_transactions
    where coalesce(is_transfer,false) is not true and account_id is null) as orphan_rows,
  round(coalesce(sum(a.opening_balance + coalesce(g.i,0) - coalesce(g.o,0)),0), 2) as grand_total
from public.bank_accounts a
left join agg g on g.account_id = a.id
where a.active;

commit;
