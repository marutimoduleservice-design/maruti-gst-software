-- Maruti Module Service: purane job cards ka worker assignment backfill
--
-- KAB CHALAYEIN:
--   `job-card-technicians-migration.sql` chalane ke BAAD. Agar migration ke
--   waqt kisi worker ka % nahi mila tha (naam alag spelling me tha), to pehle
--   Technician Master me uska Module Service Share % set kar dein, phir ye
--   script chalayein. Salary tab tak workers ki list me nahi dikhega.
--
-- KYA KARTA HAI:
--   Har share-bearing worker (>0%) ko SAARE job cards me tick kar deta hai —
--   yaani purane job cards ki salary bilkul wahi rehti hai jo naye cards par
--   sab tick hone se banti hai.
--
-- SAFE TO RE-RUN:
--   `on conflict do nothing` + pehle se mojood rows chhod deta hai. Jo job card
--   par kuch worker already tick hai, use bilkul nahi chhedta. Naya backfill
--   sirf MISSING combinations add karta hai.
--
-- NOTE: Chutti wale purane job cards par aap manually untick kar sakte hain —
--       Job Card edit karke tick hata dein, salary report turant update ho jayega.

insert into public.job_card_technicians (job_card_id, technician_id, technician_name)
select jc.id, t.id, t.name
from public.job_cards jc
cross join public.technicians t
where coalesce(t.share_percent, 0) > 0
on conflict (job_card_id, technician_id) do nothing;

-- ---------------------------------------------------------------------------
-- VERIFY — ye chalayein aur dekhein ki har job card par utne hi workers hain
-- jitne Technician Master me share > 0 wale hain.
-- ---------------------------------------------------------------------------
-- select
--   (select count(*) from technicians where coalesce(share_percent, 0) > 0) as share_workers,
--   (select count(distinct job_card_id) from job_card_technicians) as job_cards_covered,
--   (select count(*) from job_cards) as total_job_cards;
--
-- Teenon numbers barabar hone chahiye. Kam ho to kisi worker ka % 0 reh gaya hai.
