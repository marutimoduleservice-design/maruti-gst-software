-- Maruti Module Service: Job Card "Warranty OK" quantity
-- Run ONCE in the REAL database -> Supabase Dashboard -> SQL Editor.
--
-- WHY:
--  Warranty me aaye modules me se saare kharab nahi hote — kuch check karne
--  par OK nikalte hain. Job card par ye OK count store karte hain, taaki
--  Net Profit ka "Warranty %" sirf genuine faulty modules dikhaye
--  (Warranty % = (Warranty Qty − Warranty OK) ÷ Module Service Qty × 100).
--
-- SAFE TO RE-RUN (idempotent). Kuch data drop ya delete nahi karta.
-- Purane job cards ke liye default 0 lag jaata hai (yani sabhi warranty
-- modules faulty maane jaate hain, jo pehle jaisa hi hai).

alter table public.job_cards
  add column if not exists warranty_ok_quantity integer not null default 0;

-- ---------------------------------------------------------------------------
-- VERIFY — iske baad alag se chalayein
-- ---------------------------------------------------------------------------
-- Column ban gaya?
--   select column_name, data_type, column_default, is_nullable
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'job_cards'
--     and column_name = 'warranty_ok_quantity';
