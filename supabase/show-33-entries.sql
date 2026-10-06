-- Sirf 33 entries ki list. Read-only, kuch nahi badalta.
-- Output seedha copy karke bhej dijiye.

select
  bt.id,
  bt.transaction_date          as date,
  coalesce(nullif(bt.payment_mode, ''), '(mode khali)') as mode,
  left(bt.particulars, 70)     as particulars,
  left(coalesce(bt.party_name, ''), 30) as party,
  round(coalesce(bt.payment_in, 0), 2)  as credit,
  round(coalesce(bt.payment_out, 0), 2) as debit
  from public.bank_transactions bt
 order by bt.transaction_date, bt.id;
