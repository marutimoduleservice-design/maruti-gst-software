-- Maruti Module Service: Warranty Return tracking
-- Run ONCE in the REAL database -> Supabase Dashboard -> SQL Editor.
--
-- WHY:
--  Job card par warranty_quantity se pata chalta hai kitne modules warranty me aaye
--  the, par KAUNSA module, KAB aaya (module par likhi hui date) aur KYU aaya —
--  ye kahin store nahi hota tha. `warranty_returns` me ek row = ek module.
--
--  Ek row per module isliye: har module par alag date likhi hoti hai, isliye
--  Working Day bhi har module ka alag hota hai.
--
-- SAFE TO RE-RUN (idempotent). Kuch data drop ya delete nahi karta.

-- ---------------------------------------------------------------------------
-- 1) Table
-- ---------------------------------------------------------------------------
create table if not exists public.warranty_returns (
  id bigint generated always as identity primary key,

  -- Kis job card se aaya. Job card delete hua to warranty row bhi chala jayega.
  job_card_id bigint not null references public.job_cards(id) on delete cascade,

  -- Neeche ke 3 fields SNAPSHOT hain (job card se copy), taaki baad me job card
  -- edit/delete hone par bhi purana warranty record waise hi dikhe rahe.
  job_no text not null,
  job_date date not null,
  customer_name text,

  -- Module par likhi hui date — manually entry karni hoti hai.
  warranty_module_date date not null,

  -- warranty_module_date - job_date (days). App bhi ye calculate karti hai, par
  -- save karte waqt likh dete hain taaki baad me date edit karne par report
  -- purana value na badal jaaye.
  working_days integer not null,

  return_reason text not null
    check (return_reason in (
      'A - Module Check And OK',
      'B - Customer Side Problem / Damage',
      'C - Our Side Problem'
    )),

  remark text,
  created_at timestamptz not null default now()
);

-- Pehle yahan CHECK tha ki warranty_module_date job_date se pehle nahi ho sakti.
-- Wo galat nikla: purane repair kiye modules warranty me wapas aate hain, to
-- module par likhi date (back date) hamesha nayi job card date se purani hoti hai.
-- Isliye constraint ab DROP hota hai (dobara run karne par bhi wapas nahi aayega).
alter table public.warranty_returns
  drop constraint if exists warranty_returns_date_order;

-- NOTE: (job_card_id, warranty_module_date) par UNIQUE index nahi hai, kyunki
-- ek hi batch me aaye modules par wahi date likhi ho sakti hai. Ye sirf plain
-- index hai — same date ki multiple entries allow hain (sirf reason alag hoga).

-- Job card wise pending count nikalna hai (warranty_quantity - logged).
create index if not exists warranty_returns_job_idx
  on public.warranty_returns (job_card_id);

-- Date range filter / month-wise reports ke liye.
create index if not exists warranty_returns_date_idx
  on public.warranty_returns (warranty_module_date);

-- ---------------------------------------------------------------------------
-- 2) Row Level Security — same rule as every other table: only logged-in users.
-- ---------------------------------------------------------------------------
alter table public.warranty_returns enable row level security;

drop policy if exists "rls_all_warranty_returns" on public.warranty_returns;
create policy "rls_all_warranty_returns"
  on public.warranty_returns
  for all to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3) VERIFY — iske baad alag se chalayein
-- ---------------------------------------------------------------------------
-- Table ban gayi?
--   select count(*) as rows_in_warranty_returns from warranty_returns;
--
-- Job cards jisme warranty quantity hai vs unme kitni entries ban hain:
--   select
--     jc.job_no,
--     jc.job_date,
--     jc.business_name,
--     coalesce(jc.warranty_quantity, 0) as warranty_qty,
--     count(wr.id) as entries_logged,
--     coalesce(jc.warranty_quantity, 0) - count(wr.id) as pending
--   from job_cards jc
--   left join warranty_returns wr on wr.job_card_id = jc.id
--   where coalesce(jc.warranty_quantity, 0) > 0
--   group by jc.id, jc.job_no, jc.job_date, jc.business_name, jc.warranty_quantity
--   order by jc.job_date desc;
--
-- `pending` negative aaye to us job card par entry zyada ban gayi hai —
-- Warranty menu me se ek delete kar dein.