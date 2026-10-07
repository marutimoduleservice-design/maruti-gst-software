-- =============================================================================
-- OPENING BALANCES TABLE  (Financial Year rollover + first-time setup)
-- =============================================================================
-- Standard accounting software (Tally / Busy / Vyapar) me har nayi FY ke shuru
-- me pichle saal ka closing balance "Balance b/f" (brought forward) naye saal ke
-- opening me aa jata hai. Ye table wahi kaam karti hai.
--
-- ROW TYPES (column `kind`):
--   'stock'     -> item-wise opening stock (quantity + rate)
--   'bank'      -> bank balance b/f
--   'cash'      -> cash in hand b/f
--   'customer'  -> purana receivable (customer ka baki)
--   'vendor'    -> purana payable (supplier ko dena hai)
--
-- Is table se reports me:
--   Outstanding = opening(customer) + current FY invoices - receipts
--   Bank bal.   = opening(bank)    + all money IN - all money OUT
--   Stock       = opening(stock qty) + inward - outward
--
-- Run ONCE in Supabase Dashboard -> SQL Editor.
-- =============================================================================

create table if not exists public.opening_balances (
  id           bigserial primary key,
  fy_label     text        not null,          -- '2026-27'
  kind         text        not null,          -- stock | bank | cash | customer | vendor
  item_id      bigint,                         -- kind='stock' ke liye
  item_code    text,
  item_name    text,
  inward_no    text,                          -- stock batch reference (optional)
  party_id     bigint,                         -- kind='customer'/'vendor' ke liye
  party_name   text,
  quantity     numeric(18,3) default 0,       -- stock qty
  rate         numeric(18,3) default 0,       -- stock rate
  amount       numeric(18,2) default 0,       -- bank/cash/customer/vendor amount
  note         text,
  created_at   timestamptz default now()
);

create index if not exists opening_balances_fy_idx   on public.opening_balances (fy_label);
create index if not exists opening_balances_kind_idx on public.opening_balances (kind);
create unique index if not exists opening_balances_stock_uniq
  on public.opening_balances (fy_label, coalesce(inward_no, ''), lower(coalesce(item_name, '')));

-- RLS (same policy style as the rest of the project)
alter table public.opening_balances enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'opening_balances'
                 and policyname = 'opening_balances_all') then
    create policy opening_balances_all on public.opening_balances
      for all to authenticated using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'opening_balances'
                 and policyname = 'opening_balances_anon') then
    create policy opening_balances_anon on public.opening_balances
      for all to anon using (true) with check (true);
  end if;
end $$;

grant select, insert, update, delete on public.opening_balances to authenticated;
grant select, insert, update, delete on public.opening_balances to anon;
grant usage, select on sequence public.opening_balances_id_seq to authenticated, anon;

-- -----------------------------------------------------------------------------
-- FY rollover: pichle FY ka closing balance naye FY me opening b/f kar do.
--   p_from_fy : jis FY se carry forward karna hai  (e.g. '2026-27')
--   p_to_fy   : nayi FY                            (e.g. '2027-28')
-- Safe to re-run: pehle se maujood rows replace ho jati hain.
-- -----------------------------------------------------------------------------
create or replace function public.rollover_opening_balances(
  p_from_fy text,
  p_to_fy   text,
  p_bank_closing numeric default null,   -- null = apne aap nikalega
  p_cash_closing numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bank numeric;
  v_cash numeric;
begin
  -- closing nikalna: pichle FY ki entries ka net
  select coalesce(sum(coalesce(payment_in, 0) - coalesce(payment_out, 0)), 0)
    into v_bank
    from public.bank_transactions
   where transaction_date >= (left(p_from_fy, 4) || '-04-01')::date
     and transaction_date <= ((left(p_from_fy, 4)::int + 1) || '-03-31')::date;

  select coalesce(v_bank, 0)
         + coalesce((select sum(amount) from public.opening_balances
                      where fy_label = p_from_fy and kind = 'bank'), 0)
   into v_bank;

  v_cash := coalesce(p_cash_closing, 0);
  v_bank := coalesce(p_bank_closing, v_bank);

  delete from public.opening_balances where fy_label = p_to_fy;

  -- customer receivable b/f
  insert into public.opening_balances (fy_label, kind, party_name, amount, note)
  select p_to_fy, 'customer', c.customer_name, sum(t.pending)::numeric,
         'Balance b/f from FY ' || p_from_fy
    from (
      -- pending per customer, from invoices
      select inv.customer_id, sum(inv.total_amount) as pending
        from public.invoices inv
       where inv.invoice_date >= (left(p_from_fy, 4) || '-04-01')::date
         and inv.invoice_date <= ((left(p_from_fy, 4)::int + 1) || '-03-31')::date
       group by inv.customer_id
    ) t
    join public.customers c on c.id = t.customer_id
   group by c.customer_name;

  -- bank + cash b/f
  insert into public.opening_balances (fy_label, kind, party_name, amount, note)
  values (p_to_fy, 'bank', 'Bank Balance b/f', round(v_bank, 2), 'Balance b/f from FY ' || p_from_fy),
         (p_to_fy, 'cash', 'Cash in Hand b/f', round(v_cash, 2), 'Balance b/f from FY ' || p_from_fy);

  return jsonb_build_object('success', true, 'fy', p_to_fy, 'bank_opening', round(v_bank, 2));
end;
$$;

grant execute on function public.rollover_opening_balances(text, text, numeric, numeric) to authenticated;
grant execute on function public.rollover_opening_balances(text, text, numeric, numeric) to anon;
