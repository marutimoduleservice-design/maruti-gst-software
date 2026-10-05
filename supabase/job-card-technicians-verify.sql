-- Maruti Module Service: migration verification (read-only, kuch change nahi karta)
-- Supabase SQL Editor me chalayein — 3 alag result sets aayenge.

-- ---------------------------------------------------------------------------
-- 1) Worker Share Setup — total % 100 hona chahiye
-- ---------------------------------------------------------------------------
select
  id,
  name,
  coalesce(share_percent, 0) as share_percent,
  status,
  case
    when coalesce(share_percent, 0) = 0 then 'FIX: % set karo Technician Master me'
    else 'OK'
  end as note
from technicians
order by coalesce(share_percent, 0) desc, name;

-- ---------------------------------------------------------------------------
-- 2) Total % check (100 aana chahiye)
-- ---------------------------------------------------------------------------
select
  sum(coalesce(share_percent, 0)) as total_share_percent,
  count(*) as total_technicians,
  count(*) filter (where coalesce(share_percent, 0) > 0) as share_workers
from technicians;

-- ---------------------------------------------------------------------------
-- 3) Backfill coverage — teeno numbers barabar hone chahiye
--    Example: share_workers 4, job_cards_covered 60, total_job_cards 60 = sab sahi
-- ---------------------------------------------------------------------------
select
  (select count(*) from technicians where coalesce(share_percent, 0) > 0) as share_workers,
  (select count(distinct job_card_id) from job_card_technicians) as job_cards_covered,
  (select count(*) from job_cards) as total_job_cards,
  (select count(*) from job_cards where id not in (select job_card_id from job_card_technicians))
    as job_cards_missing_assignment;

-- ---------------------------------------------------------------------------
-- 4) Assignment parity — har job card par kitne workers tick hain
-- ---------------------------------------------------------------------------
select
  cnt as workers_per_jobcard,
  count(*) as job_cards
from (
  select job_card_id, count(*) as cnt
  from job_card_technicians
  group by job_card_id
) x
group by cnt
order by cnt;