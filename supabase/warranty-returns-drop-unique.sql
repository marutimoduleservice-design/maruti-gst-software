-- Maruti Module Service: warranty_returns unique index hatao
--
-- KYU:
--  Purana index `(job_card_id, warranty_module_date)` UNIQUE tha. Par ek hi
--  batch me aaye 11 modules par wahi date likhi ho sakti hai (aam baat hai) —
--  unique hone se doosri entry save hi nahi hoti thi. Ye galat restriction
--  thi, isliye ab plain index rakhte hain: same date ki multiple entries
--  allowed hain (sirf reason/remark alag hota hai).
--
-- SAFE TO RE-RUN (idempotent).
--
-- Ye sirf wahi karta hai jo purani `warranty-returns-migration.sql` me bana tha.
-- Naya install ho to seedhi `warranty-returns-migration.sql` chalayein, ye
-- alag se chahiye hi nahi.

drop index if exists public.warranty_returns_unique;

-- Ab ye index bachega (data delete nahi hota, sirf constraint hat-ta hai):
create index if not exists warranty_returns_job_date_idx
  on public.warranty_returns (job_card_id, warranty_module_date);

-- ---------------------------------------------------------------------------
-- VERIFY — `warranty_returns_unique` list me nahi aana chahiye, aur
-- `warranty_returns_job_date_idx` aana chahiye.
--
-- NOTE: `pg_indexes` me `is_unique` column hota hi nahi (wahi error aata hai),
-- isliye yahan `indexdef` se uniqueness dekhna padta hai — `CREATE UNIQUE INDEX`
-- me UNIQUE likha hota hai.
-- ---------------------------------------------------------------------------
select indexname, indexdef
from pg_indexes
where schemaname = 'public' and tablename = 'warranty_returns'
order by indexname;

-- Aur ek seedha PASS/FAIL, taaki interpretation me confusion na ho:
--
--   'OK'  -> unique index nahi bacha, normal index bana hua hai
--   'FAIL'-> abhi bhi koi UNIQUE index pada hua hai (same date ki do entry
--             phir bhi block hogi)
select case
         when exists (
           select 1 from pg_indexes
            where schemaname = 'public'
              and tablename = 'warranty_returns'
              and indexdef ilike '%unique%'
         )
           then 'FAIL - abhi bhi UNIQUE index mojood hai'
         when exists (
           select 1 from pg_indexes
            where schemaname = 'public'
              and tablename = 'warranty_returns'
              and indexname = 'warranty_returns_job_date_idx'
         )
           then 'OK - same-date ki multiple entries allowed hain'
         else 'FAIL - warranty_returns_job_date_idx bhi nahi bana'
       end as same_date_duplicates_allowed;