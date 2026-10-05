-- ============================================================================
-- Company-aware invoice RPCs
-- ============================================================================
-- save_invoice_atomic / delete_invoice_atomic me company_id add kiya gaya hai.
-- Ab invoice number bhi company ke apne prefix se banega (per-company series).
-- Purane 9-argument calls bhi chale rahenge (p_company_id ka default hai).

drop function if exists public.save_invoice_atomic(text, bigint, date, bigint, bigint, text, numeric, jsonb, jsonb);
drop function if exists public.delete_invoice_atomic(bigint);

-- ---------------------------------------------------------------------------
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
  v_old_line          record;
  v_job_card_id       bigint := null;
  v_repairing_total   numeric := 0;
  v_repairing_invoiced numeric := 0;
  v_repairing_pending numeric := 0;
  v_job_card_closed   boolean := false;
begin
  -- Company resolve: parameter > pehli active company
  v_company_id := coalesce(
    p_company_id,
    (select min(id) from public.companies where active)
  );

  -- Company ka apna invoice prefix (Non-GST = INV/, GST = GSTINV/)
  select coalesce(nullif(trim(invoice_prefix), ''), 'INV/')
    into v_prefix
    from public.companies
   where id = v_company_id;

  v_prefix := coalesce(v_prefix, 'INV/');

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

    -- 1) Purani stock wapas
    for v_old_line in
      select * from jsonb_to_recordset(coalesce(p_old_items, '[]'::jsonb))
        as x(item_id bigint, quantity numeric)
    loop
      if v_old_line.item_id is not null then
        update public.item_master
           set opening_stock = coalesce(opening_stock, 0) + coalesce(v_old_line.quantity, 0)
         where id = v_old_line.item_id;
      end if;
    end loop;

    -- 2) Purani lines hatao
    delete from public.invoice_items
     where invoice_id = p_editing_invoice_id
       and company_id = v_company_id;

    -- 3) Header update
    update public.invoices
       set invoice_date = p_invoice_date,
           customer_id = p_customer_id,
           job_card_id = case when p_invoice_type = 'Job Card' then coalesce(v_job_card_id, p_job_card_id) else null end,
           invoice_type = p_invoice_type,
           total_amount = p_total_amount
     where id = p_editing_invoice_id
       and company_id = v_company_id;

    v_invoice_id := p_editing_invoice_id;

    -- 4) Auto-created bank row ka amount adjust
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
    -- CREATE mode: company ke apne prefix se next number
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
      (invoice_no, invoice_date, customer_id, job_card_id, invoice_type, total_amount, company_id)
    values
      (v_invoice_no, p_invoice_date, p_customer_id,
       case when p_invoice_type = 'Job Card' then p_job_card_id else null end,
       p_invoice_type, p_total_amount, v_company_id)
    returning id into v_invoice_id;

    v_job_card_id := case when p_invoice_type = 'Job Card' then p_job_card_id else null end;
  end if;

  -- 5) Item lines + stock deduct
  for v_line in
    select * from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
      as x(inward_no text, item_id bigint, item_name text, quantity numeric,
           rate numeric, total numeric, cost_rate numeric, source text)
  loop
    insert into public.invoice_items
      (invoice_id, inward_no, item_id, item_name, quantity, rate, total, cost_rate, company_id)
    values
      (v_invoice_id, v_line.inward_no,
       case when v_line.source = 'Spare Part' then null else v_line.item_id end,
       v_line.item_name, v_line.quantity, v_line.rate, v_line.total, v_line.cost_rate,
       v_company_id);

    if v_line.item_id is not null and v_line.source <> 'Spare Part' then
      update public.item_master
         set opening_stock = greatest(0, coalesce(opening_stock, 0) - coalesce(v_line.quantity, 0))
       where id = v_line.item_id;
    end if;
  end loop;

  -- 6) Job card close (jab saari repairing qty invoice ho jaaye)
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

-- ---------------------------------------------------------------------------
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
  v_old_line    record;
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

  -- Payment ho chuka hai to delete nahi
  if exists (
    select 1 from public.bank_transactions
     where company_id = v_company_id
       and (particulars ilike '%' || v_invoice_no || '%'
         or notes ilike '%' || v_invoice_no || '%')
  ) then
    raise exception 'Is invoice ke against payment/receipt ho chuki hai, delete nahi ho sakta!';
  end if;

  -- 1) Stock wapas
  for v_old_line in
    select item_id, quantity
      from public.invoice_items
     where invoice_id = p_invoice_id
       and company_id = v_company_id
  loop
    if v_old_line.item_id is not null then
      update public.item_master
         set opening_stock = coalesce(opening_stock, 0) + coalesce(v_old_line.quantity, 0)
       where id = v_old_line.item_id;
    end if;
  end loop;

  -- 2) Job card wapas kholo
  if v_inv.job_card_id is not null then
    update public.job_cards
       set status = 'Open', invoice_id = null
     where id = v_inv.job_card_id
       and company_id = v_company_id;
  end if;

  -- 3) Auto-created bank row hatao
  delete from public.bank_transactions
   where company_id = v_company_id
     and (particulars ilike '%' || v_invoice_no || '%'
       or notes ilike '%' || v_invoice_no || '%');

  -- 4) Lines + header delete
  delete from public.invoice_items
   where invoice_id = p_invoice_id
     and company_id = v_company_id;

  delete from public.invoices
   where id = p_invoice_id
     and company_id = v_company_id;

  return v_invoice_no;
end;
$$;

-- VERIFY
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('save_invoice_atomic','delete_invoice_atomic')
order by p.proname;
