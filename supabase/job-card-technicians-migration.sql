-- Maruti Module Service: Job Card worker assignment + worker share %
-- Run ONCE in the REAL database -> Supabase Dashboard -> SQL Editor.
--
-- WHY:
--  1. Salary report ko pata chalna chahiye ki kis job card par kaun kaam kiya.
--     Pehle `job_cards.technician` sirf EK naam (text) store karta tha, jo team
--     ko represent nahi kar sakta. Ab `job_card_technicians` se ek job card par
--     multiple workers tick ho sakte hain.
--  2. Worker ke naam aur unka Module Service % dono Technician Master
--     (`technicians` table) se aate hain — code me kuch hardcoded nahi hai.
--
-- CHUTTI: worker ko job card par tick NA karna hi "chutti" hai. Uska share
-- 0 ho jata hai aur baaki workers ko koi extra nahi milta (renormalize nahi hota).
--
-- This script is safe to re-run (idempotent). It does not drop tables or delete data.

-- ---------------------------------------------------------------------------
-- 1) Worker ka Module Service share % — Technician Master me dikhega
-- ---------------------------------------------------------------------------
alter table public.technicians
  add column if not exists share_percent numeric(5,2);

-- Pehle se maujood technicians me se unhe % do jinke naam aapne diye hain.
-- Agar aapne koi alag naam use kiya hai (jaise "Karan S."), to yahan unka
-- naam likh dijiye — kyunki Technician Master wahi source hai.
update public.technicians set share_percent = case lower(trim(name))
  when 'behra'   then 20
  when 'kalyani' then 20
  when 'karan'   then 27
  when 'mayur'   then 33
end
where lower(trim(name)) in ('behra', 'kalyani', 'karan', 'mayur')
  and share_percent is null;

-- Naye workers ko default 0 (matlab abhi salary share nahi).
update public.technicians set share_percent = 0 where share_percent is null;

-- ---------------------------------------------------------------------------
-- 2) Assignment table — one row per (job card, worker)
-- ---------------------------------------------------------------------------
create table if not exists public.job_card_technicians (
  id bigint generated always as identity primary key,
  job_card_id bigint not null references public.job_cards(id) on delete cascade,
  technician_id bigint not null references public.technicians(id) on delete cascade,
  technician_name text not null,
  created_at timestamptz not null default now()
);

-- Same worker ek hi job card par do baar na aaye.
create unique index if not exists job_card_technicians_unique
  on public.job_card_technicians (job_card_id, technician_id);

-- Salary report har job card ka assignment ek saath padhta hai.
create index if not exists job_card_technicians_job_idx
  on public.job_card_technicians (job_card_id);

-- ---------------------------------------------------------------------------
-- 3) Backfill — every EXISTING job card gets ALL share-bearing workers ticked
--    Purane job cards ka earning pehle wale fixed 20/20/27/33 jaisa hi rahega.
-- ---------------------------------------------------------------------------
insert into public.job_card_technicians (job_card_id, technician_id, technician_name)
select jc.id, t.id, t.name
from public.job_cards jc
cross join public.technicians t
where coalesce(t.share_percent, 0) > 0
on conflict (job_card_id, technician_id) do nothing;

-- ---------------------------------------------------------------------------
-- 4) Row Level Security — same rule as every other table: only logged-in users.
-- ---------------------------------------------------------------------------
alter table public.job_card_technicians enable row level security;

drop policy if exists "rls_all_job_card_technicians" on public.job_card_technicians;
create policy "rls_all_job_card_technicians"
  on public.job_card_technicians
  for all to authenticated
  using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 5) VERIFY — inhe execution ke baad alag se run karein
-- ---------------------------------------------------------------------------
-- A) Workers + unke % (yahi Salary menu ke cards banenge, isi naam se Job Card
--    ke checkbox bhi bante hain):
--   select id, name, share_percent, status from technicians
--   order by share_percent desc, name;
--
-- B) Jinke % 0 reh gaye — inhe Technician Master me % bharna hoga, warna
--    inki salary aur purane job cards ki entry dono nahi banegi:
--   select id, name, share_percent from technicians
--   where coalesce(share_percent, 0) = 0 order by name;
--
-- C) Total % 100 hona chahiye:
--   select sum(coalesce(share_percent, 0)) as total_share_percent from technicians;
--
-- D) Kitne job cards par kitne workers tick hain:
--   select cnt as workers_per_jobcard, count(*) as job_cards
--   from (
--     select job_card_id, count(*) cnt
--     from job_card_technicians group by job_card_id
--   ) x group by cnt order by cnt;
--
-- AGAR B me koi naam aaya (aapne alag spelling use ki hui hai), to uska %
-- Technician Master me set kar dein, phir `job-card-technicians-backfill.sql`
-- chalayein — poorane purane job cards ki entry wahin se ban jayegi.
