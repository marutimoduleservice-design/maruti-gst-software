-- Warranty: back date allow karo
-- Run in: Supabase Dashboard -> SQL Editor.
--
-- Purana CHECK constraint `warranty_returns_date_order` warranty_module_date ko
-- job_date se pehle nahi hone deta tha. Wo constraint hataana zaroori hai kyunki
-- purane repair kiye modules warranty me wapas aate hain — module par likhi date
-- (back date) hamesha nayi job card date se purani hoti hai.
--
-- App (frontend) pehle se back date allow kar chuki hai; ye SQL sirf database
-- ka purana rok hatata hai. Existing data par koi asar nahi.
--
-- SAFE TO RE-RUN.

alter table public.warranty_returns
  drop constraint if exists warranty_returns_date_order;

-- Verify: constraint gayab hona chahiye (0 rows).
select conname
from pg_constraint
where conrelid = 'public.warranty_returns'::regclass
  and conname = 'warranty_returns_date_order';
