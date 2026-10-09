-- ═══════════════════════════════════════════════════════════════════════════
--  GST migration — schema columns + GST-aware invoice RPCs
-- ═══════════════════════════════════════════════════════════════════════════
-- Fresh install (fresh-install.sql) ke BAAD chalao — ya clean install ke liye
-- fresh-install.sql me already shaamil hai (last section).
--
-- Kya karta hai:
--   1) invoices / invoice_items / purchases / customers / vendors me GST columns
--   2) save_invoice_atomic  → naya GST-aware version (tax breakdown, header GST)
--   3) delete_invoice_atomic → GST-aware version
--   4) Purane (bina-GST) overloads hatata hai
--
-- NOTE: Ye RPC ab stock (`opening_stock`) mutate NAHI karta. App khud stock
-- nikaalta hai = opening_stock + purchases - invoice_items (NetProfitReport.tsx
-- L149). Purana RPC item_master.opening_stock ghatata tha jo app padhta hi nahi
-- tha — usse double-count ka risk tha, isliye hata diya.

-- ── 1) Schema columns ──────────────────────────────────────────────────────
alter table public.invoices add column if not exists taxable_amount  numeric(14,2) not null default 0;
alter table public.invoices add column if not exists cgst_amount     numeric(14,2) not null default 0;
alter table public.invoices add column if not exists sgst_amount     numeric(14,2) not null default 0;
alter table public.invoices add column if not exists igst_amount     numeric(14,2) not null default 0;
alter table public.invoices add column if not exists round_off       numeric(14,2) not null default 0;
alter table public.invoices add column if not exists place_of_supply text;
alter table public.invoices add column if not exists supply_type     text;
alter table public.invoices add column if not exists customer_gstin  text;

alter table public.invoice_items add column if not exists hsn_code      text;
alter table public.invoice_items add column if not exists gst_percent   numeric(6,2)  not null default 0;
alter table public.invoice_items add column if not exists taxable_value numeric(14,2) not null default 0;
alter table public.invoice_items add column if not exists cgst_amount   numeric(14,2) not null default 0;
alter table public.invoice_items add column if not exists sgst_amount   numeric(14,2) not null default 0;
alter table public.invoice_items add column if not exists igst_amount   numeric(14,2) not null default 0;

alter table public.purchases add column if not exists vendor_gstin  text;
alter table public.purchases add column if not exists hsn_code      text;
alter table public.purchases add column if not exists gst_percent   numeric(6,2)  not null default 0;
alter table public.purchases add column if not exists taxable_value numeric(14,2) not null default 0;
alter table public.purchases add column if not exists cgst_amount   numeric(14,2) not null default 0;
alter table public.purchases add column if not exists sgst_amount   numeric(14,2) not null default 0;
alter table public.purchases add column if not exists igst_amount   numeric(14,2) not null default 0;
alter table public.purchases add column if not exists supply_type   text;

alter table public.customers add column if not exists state_code text;
alter table public.customers add column if not exists state_name text;

alter table public.vendors add column if not exists gstin      text;
alter table public.vendors add column if not exists state_code text;
alter table public.vendors add column if not exists state_name text;

create index if not exists invoices_supply_type_idx on public.invoices (company_id, supply_type);
create index if not exists invoice_items_hsn_idx    on public.invoice_items (company_id, hsn_code);
create index if not exists purchases_gstin_idx      on public.purchases (company_id, vendor_gstin);

-- RLS/grants (naye project me default RLS-on hota hai):
alter table public.invoices      enable row level security;
alter table public.invoice_items enable row level security;
alter table public.purchases     enable row level security;
alter table public.customers     enable row level security;
alter table public.vendors       enable row level security;

-- ── 2) Purane RPC overloads hatao ──────────────────────────────────────────
drop function if exists public.save_invoice_atomic(text, bigint, date, bigint, bigint, text, numeric, jsonb, jsonb);
drop function if exists public.save_invoice_atomic(text, bigint, date, bigint, bigint, text, numeric, jsonb, jsonb, bigint);
drop function if exists public.save_invoice_atomic(text, bigint, date, bigint, bigint, text, numeric, jsonb, jsonb, jsonb, bigint);
drop function if exists public.delete_invoice_atomic(bigint);
drop function if exists public.delete_invoice_atomic(bigint, bigint);

-- ── 3) GST-aware save_invoice_atomic ───────────────────────────────────────
create or replace function public.save_invoice_atomic(
  p_mode               text,
  p_editing_invoice_id bigint,
  p_invoice_date       date,
  p_customer_id        bigint,
  p_job_card_id        bigint,
  p_invoice_type       text,
  p_total_amount       numeric,
  p_lines              jsonb,
  p_old_items          jsonb,
  p_tax                jsonb default '{}'::jsonb,
  p_company_id         bigint default null
)
returns jsonb
language plpgsql
as $$
declare
  v_company_id        bigint;
  v_prefix            text;
  v_invoice_id        bigint;
  v_invoice_no        text;
  v_current_year      int;
  v_max_no            int;
  v_current_total     numeric;
  v_diff              numeric;
  v_line              record;
  v_job_card_id       bigint := null;
  v_repairing_total   numeric := 0;
  v_repairing_invoiced numeric := 0;
  v_repairing_pending numeric := 0;
  v_job_card_closed   boolean := false;
  -- GST header values (p_tax se, warna lines se fallback)
  v_place_of_supply   text;
  v_supply_type       text;
  v_customer_gstin    text;
  v_taxable           numeric := 0;
  v_cgst              numeric := 0;
  v_sgst              numeric := 0;
  v_igst              numeric := 0;
  v_round             numeric := 0;
begin
  v_company_id := coalesce(
    p_company_id,
    (select min(id) from public.companies where active)
  );

  select coalesce(nullif(trim(invoice_prefix), ''), 'INV/')
    into v_prefix
    from public.companies
   where id = v_company_id;
  v_prefix := coalesce(v_prefix, 'INV/');

  -- ── GST header values ──
  v_place_of_supply := nullif(trim(coalesce(p_tax->>'place_of_supply', '')), '');
  v_supply_type     := nullif(trim(coalesce(p_tax->>'supply_type', '')), '');
  v_customer_gstin  := nullif(trim(coalesce(p_tax->>'customer_gstin', '')), '');
  v_taxable := coalesce((p_tax->>'taxable_amount')::numeric, 0);
  v_cgst    := coalesce((p_tax->>'cgst_amount')::numeric, 0);
  v_sgst    := coalesce((p_tax->>'sgst_amount')::numeric, 0);
  v_igst    := coalesce((p_tax->>'igst_amount')::numeric, 0);
  v_round   := coalesce((p_tax->>'round_off')::numeric, 0);

  -- p_tax na diya ho to lines se tax totals nikaal lo (safety fallback)
  if v_taxable = 0 and v_cgst = 0 and v_sgst = 0 and v_igst = 0 then
    select coalesce(sum(coalesce((l->>'taxable_value')::numeric, 0)), 0),
           coalesce(sum(coalesce((l->>'cgst_amount')::numeric, 0)), 0),
           coalesce(sum(coalesce((l->>'sgst_amount')::numeric, 0)), 0),
           coalesce(sum(coalesce((l->>'igst_amount')::numeric, 0)), 0)
      into v_taxable, v_cgst, v_sgst, v_igst
      from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) as l;
  end if;

  -- ── Customer state (place of supply + GSTIN derive) ──
  if v_place_of_supply is null then
    select coalesce(nullif(trim(state_name), ''), nullif(trim(state_code), ''))
      into v_place_of_supply
      from public.customers
     where id = p_customer_id;
  end if;
  if v_customer_gstin is null then
    select nullif(trim(gst_number), '')
      into v_customer_gstin
      from public.customers
     where id = p_customer_id;
  end if;
  if v_supply_type is null then
    v_supply_type := case when v_customer_gstin is not null then 'B2B' else 'B2C' end;
  end if;

  if p_mode = 'edit' then
    select invoice_no, job_card_id
      into v_invoice_no, v_job_card_id
      from public.invoices
     where id = p_editing_invoice_id
       and company_id = v_company_id;

    if v_invoice_no is null then
      raise exception 'Invoice not found for this company (id: %)', p_editing_invoice_id;
    end if;

    if exists (
      select 1 from public.bank_transactions
       where company_id = v_company_id
         and (particulars ilike '%' || v_invoice_no || '%'
           or notes ilike '%' || v_invoice_no || '%')
    ) then
      raise exception 'Is invoice ka payment ho chuka hai, update allowed nahi hai!';
    end if;

    select coalesce(total_amount, 0)
      into v_current_total
      from public.invoices
     where id = p_editing_invoice_id;

    -- Purani lines hatao (stock ab app khud invoice_items se nikaalta hai)
    delete from public.invoice_items
     where invoice_id = p_editing_invoice_id
       and company_id = v_company_id;

    update public.invoices
       set invoice_date = p_invoice_date,
           customer_id = p_customer_id,
           job_card_id = case when p_invoice_type = 'Job Card' then coalesce(v_job_card_id, p_job_card_id) else null end,
           invoice_type = p_invoice_type,
           total_amount = p_total_amount,
           taxable_amount = v_taxable,
           cgst_amount = v_cgst,
           sgst_amount = v_sgst,
           igst_amount = v_igst,
           round_off = v_round,
           place_of_supply = v_place_of_supply,
           supply_type = v_supply_type,
           customer_gstin = v_customer_gstin
     where id = p_editing_invoice_id
       and company_id = v_company_id;

    v_invoice_id := p_editing_invoice_id;

    v_diff := p_total_amount - v_current_total;
    if v_diff <> 0 then
      update public.bank_transactions
         set amount = coalesce(amount, 0) + v_diff,
             payment_in = coalesce(payment_in, 0) + v_diff
       where company_id = v_company_id
         and (particulars ilike '%' || v_invoice_no || '%'
           or notes ilike '%' || v_invoice_no || '%');
    end if;
  else
    v_current_year := extract(year from p_invoice_date);

    select coalesce(max(
               case
                 when substring(trim(invoice_no) from '[0-9]+$') ~ '^[0-9]+$'
                 then substring(trim(invoice_no) from '[0-9]+$')::int
                 else 0
               end), 0)
      into v_max_no
      from public.invoices
     where company_id = v_company_id
       and invoice_no like v_prefix || v_current_year || '-%';

    v_invoice_no := v_prefix || v_current_year || '-' || lpad((v_max_no + 1)::text, 4, '0');

    insert into public.invoices
      (invoice_no, invoice_date, customer_id, job_card_id, invoice_type, total_amount,
       taxable_amount, cgst_amount, sgst_amount, igst_amount, round_off,
       place_of_supply, supply_type, customer_gstin, company_id)
    values
      (v_invoice_no, p_invoice_date, p_customer_id,
       case when p_invoice_type = 'Job Card' then p_job_card_id else null end,
       p_invoice_type, p_total_amount,
       v_taxable, v_cgst, v_sgst, v_igst, v_round,
       v_place_of_supply, v_supply_type, v_customer_gstin, v_company_id)
    returning id into v_invoice_id;

    v_job_card_id := case when p_invoice_type = 'Job Card' then p_job_card_id else null end;
  end if;

  -- ── Item lines ──
  for v_line in
    select * from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
      as x(inward_no text, item_id bigint, item_name text, quantity numeric,
           rate numeric, total numeric, cost_rate numeric, source text,
           hsn_code text, gst_percent numeric, taxable_value numeric,
           cgst_amount numeric, sgst_amount numeric, igst_amount numeric)
  loop
    insert into public.invoice_items
      (invoice_id, inward_no, item_id, item_name, quantity, rate, total, cost_rate,
       hsn_code, gst_percent, taxable_value, cgst_amount, sgst_amount, igst_amount,
       company_id)
    values
      (v_invoice_id, v_line.inward_no,
       case when v_line.source = 'Spare Part' then null else v_line.item_id end,
       v_line.item_name, v_line.quantity, v_line.rate, v_line.total, v_line.cost_rate,
       v_line.hsn_code, coalesce(v_line.gst_percent, 0), coalesce(v_line.taxable_value, 0),
       coalesce(v_line.cgst_amount, 0), coalesce(v_line.sgst_amount, 0), coalesce(v_line.igst_amount, 0),
       v_company_id);
  end loop;

  -- ── Job card close (jab saari repairing qty invoice ho jaaye) ──
  if v_job_card_id is not null then
    select coalesce(repairing_quantity, 0)
      into v_repairing_total
      from public.job_cards
     where id = v_job_card_id
       and company_id = v_company_id;

    select coalesce(sum(ii.quantity), 0)
      into v_repairing_invoiced
      from public.invoice_items ii
      join public.invoices iv on iv.id = ii.invoice_id
     where iv.job_card_id = v_job_card_id
       and iv.company_id = v_company_id
       and ii.inward_no = 'JOB-REP';

    v_repairing_pending := greatest(0, v_repairing_total - v_repairing_invoiced);
    v_job_card_closed := (v_repairing_total <= 0) or (v_repairing_pending <= 0.00001);

    update public.job_cards
       set status = 'Closed', invoice_id = v_invoice_id, closed_at = now()
     where id = v_job_card_id
       and company_id = v_company_id;

    if not v_job_card_closed then
      update public.job_cards
         set status = 'Open', invoice_id = v_invoice_id
       where id = v_job_card_id
         and company_id = v_company_id
         and status = 'Closed';
    end if;
  end if;

  return jsonb_build_object(
    'invoice_id',          v_invoice_id,
    'invoice_no',          v_invoice_no,
    'company_id',          v_company_id,
    'job_card_closed',     v_job_card_closed,
    'repairing_total',     v_repairing_total,
    'repairing_invoiced',  v_repairing_invoiced,
    'repairing_pending',   v_repairing_pending
  );
end;
$$;

-- ── 4) GST-aware delete_invoice_atomic ─────────────────────────────────────
create or replace function public.delete_invoice_atomic(
  p_invoice_id  bigint,
  p_company_id bigint default null
)
returns text
language plpgsql
as $$
declare
  v_company_id  bigint;
  v_inv         record;
  v_invoice_no  text;
begin
  v_company_id := coalesce(
    p_company_id,
    (select min(id) from public.companies where active)
  );

  select * into v_inv
    from public.invoices
   where id = p_invoice_id
     and company_id = v_company_id;

  if v_inv is null then
    raise exception 'Invoice not found for this company (id: %)', p_invoice_id;
  end if;

  v_invoice_no := v_inv.invoice_no;

  if exists (
    select 1 from public.bank_transactions
     where company_id = v_company_id
       and (particulars ilike '%' || v_invoice_no || '%'
         or notes ilike '%' || v_invoice_no || '%')
  ) then
    raise exception 'Is invoice ke against payment/receipt ho chuki hai, delete nahi ho sakta!';
  end if;

  if v_inv.job_card_id is not null then
    update public.job_cards
       set status = 'Open', invoice_id = null
     where id = v_inv.job_card_id
       and company_id = v_company_id;
  end if;

  delete from public.bank_transactions
   where company_id = v_company_id
     and (particulars ilike '%' || v_invoice_no || '%'
       or notes ilike '%' || v_invoice_no || '%');

  delete from public.invoice_items
   where invoice_id = p_invoice_id
     and company_id = v_company_id;

  delete from public.invoices
   where id = p_invoice_id
     and company_id = v_company_id;

  return v_invoice_no;
end;
$$;

-- ── 5) Grants ──────────────────────────────────────────────────────────────
grant execute on function public.save_invoice_atomic(text, bigint, date, bigint, bigint, text, numeric, jsonb, jsonb, jsonb, bigint) to authenticated, anon;
grant execute on function public.delete_invoice_atomic(bigint, bigint) to authenticated, anon;

-- VERIFY
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('save_invoice_atomic', 'delete_invoice_atomic')
order by p.proname;
