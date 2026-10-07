-- ============================================================
-- Payment Details (Cheque no/date + UTR) aur Bounce / Return
-- ------------------------------------------------------------
-- Run: Supabase SQL Editor me ye poora file paste karke run karein.
--
-- 1. bank_transactions me 5 naye columns:
--    cheque_no / cheque_date  -> Cheque payment ka proof
--    utr_no                   -> UPI/NEFT/IMPS/RTGS reference (sabse important proof)
--    bounce_reason            -> dishonour ka karan
--    bounced_at               -> NON-NULL = payment bounce/return ho chuka.
--                                Aisa row paisa bank se bahar nahi gaya —
--                                balance, expense, profit aur bill
--                                allocation SABKI calculation se exclude hota hai.
-- 2. Bounced rows par fast partial index.
-- ============================================================

alter table public.bank_transactions
  add column if not exists cheque_no text,
  add column if not exists cheque_date date,
  add column if not exists utr_no text,
  add column if not exists bounce_reason text,
  add column if not exists bounced_at timestamptz;

comment on column public.bank_transactions.cheque_no   is 'Cheque number (payment proof)';
comment on column public.bank_transactions.cheque_date is 'Cheque date';
comment on column public.bank_transactions.utr_no      is 'UTR / UPI ref no (bank transfer proof)';
comment on column public.bank_transactions.bounce_reason is 'Cheque bounce / payment return ka karan';
comment on column public.bank_transactions.bounced_at  is 'Non-null = bounced/returned. Paisa nahi gaya — totals aur bill allocation se exclude karo.';

create index if not exists bank_transactions_bounced_idx
  on public.bank_transactions (company_id, bounced_at)
  where bounced_at is not null;

-- RLS: bank_transactions par pehle se policies hain (authenticated ALL),
-- naye columns unke under hi aate hain — koi nayi policy zaroori nahi.

select
  column_name,
  data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'bank_transactions'
  and column_name in ('cheque_no', 'cheque_date', 'utr_no', 'bounce_reason', 'bounced_at')
order by column_name;
