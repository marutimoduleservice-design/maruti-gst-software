-- Maruti Module Service: Partial (part) Job Card Invoicing
-- Run ONCE in Supabase Dashboard -> SQL Editor.
--
-- Problem: save_invoice_atomic closed the job card on the FIRST invoice and
-- blocked a second invoice for the same job card. So a 20-qty repairing job
-- could not be billed 10 now + 10 at delivery.
--
-- Fix:
--   1. Multiple invoices per job card are now allowed.
--   2. The job card is closed only when the TOTAL invoiced "JOB-REP" qty
--      reaches job_cards.repairing_quantity.
--   3. The result now returns job_card_closed / repairing_pending / repairing_total
--      so the UI can tell the user what is still left to bill.

create or replace function public.save_invoice_atomic(
  p_mode text,                  -- 'create' | 'edit'
  p_editing_invoice_id bigint default null,
  p_invoice_date date default null,
  p_customer_id bigint default null,
  p_job_card_id bigint default null,
  p_invoice_type text default 'Direct',
  p_total_amount numeric default 0,
  p_lines jsonb default '[]',           -- [{inward_no,item_id,item_name,quantity,rate,total,cost_rate,source}]
  p_old_items jsonb default '[]'        -- edit mode only: [{item_id,quantity}] to restore stock
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice_id bigint;
  v_invoice_no text;
  v_current_year int;
  v_max_no int;
  v_current_total numeric;
  v_diff numeric;
  v_line record;
  v_old_line record;
  v_job_card_id bigint := null;
  v_repairing_total numeric := 0;
  v_repairing_invoiced numeric := 0;
  v_repairing_pending numeric := 0;
  v_job_card_closed boolean := false;
begin
  if p_mode = 'edit' then
    select invoice_no, job_card_id
      into v_invoice_no, v_job_card_id
      from public.invoices where id = p_editing_invoice_id;

    if v_invoice_no is not null and exists (
      select 1 from public.bank_transactions
       where particulars ilike '%' || v_invoice_no || '%'
          or notes ilike '%' || v_invoice_no || '%'
    ) then
      raise exception 'Is invoice ka payment ho chuka hai, update allowed nahi hai!';
    end if;

    select coalesce(total_amount, 0)
      into v_current_total
      from public.invoices where id = p_editing_invoice_id;

    -- 1) Restore old stock
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

    -- 2) Delete old item lines
    delete from public.invoice_items where invoice_id = p_editing_invoice_id;

    -- 3) Update invoice header
    update public.invoices
       set invoice_date = p_invoice_date,
           customer_id = p_customer_id,
           job_card_id = case when p_invoice_type = 'Job Card' then coalesce(v_job_card_id, p_job_card_id) else null end,
           invoice_type = p_invoice_type,
           total_amount = p_total_amount
     where id = p_editing_invoice_id;

    v_invoice_id := p_editing_invoice_id;

    -- 4) Adjust the auto-created bank row amount by the difference
    v_diff := p_total_amount - v_current_total;
    if v_diff <> 0 and v_invoice_no is not null then
      update public.bank_transactions
         set amount = coalesce(amount, 0) + v_diff,
             payment_in = coalesce(payment_in, 0) + v_diff
       where particulars ilike '%' || v_invoice_no || '%'
          or notes ilike '%' || v_invoice_no || '%';
    end if;
  else
    -- CREATE mode: next invoice number
    v_current_year := extract(year from p_invoice_date);
    select coalesce(max(case
                 when substring(trim(invoice_no) from '[0-9]+$') ~ '^[0-9]+$'
                 then substring(trim(invoice_no) from '[0-9]+$')::int
                 else 0 end), 0)
      into v_max_no
      from public.invoices
     where invoice_no like 'INV-' || v_current_year || '-%';

    v_invoice_no := 'INV-' || v_current_year || '-' || lpad((v_max_no + 1)::text, 4, '0');

    insert into public.invoices (invoice_no, invoice_date, customer_id, job_card_id, invoice_type, total_amount)
    values (v_invoice_no, p_invoice_date, p_customer_id,
            case when p_invoice_type = 'Job Card' then p_job_card_id else null end,
            p_invoice_type, p_total_amount)
    returning id into v_invoice_id;

    v_job_card_id := case when p_invoice_type = 'Job Card' then p_job_card_id else null end;
  end if;

  -- 5) Insert item lines + deduct spare-part/stock
  for v_line in
    select * from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
      as x(inward_no text, item_id bigint, item_name text, quantity numeric,
           rate numeric, total numeric, cost_rate numeric, source text)
  loop
    insert into public.invoice_items
      (invoice_id, inward_no, item_id, item_name, quantity, rate, total, cost_rate)
    values
      (v_invoice_id, v_line.inward_no,
       case when v_line.source = 'Spare Part' then null else v_line.item_id end,
       v_line.item_name, v_line.quantity, v_line.rate, v_line.total, v_line.cost_rate);

    if v_line.item_id is not null and v_line.source <> 'Spare Part' then
      update public.item_master
         set opening_stock = greatest(0, coalesce(opening_stock, 0) - coalesce(v_line.quantity, 0))
       where id = v_line.item_id;
    end if;
  end loop;

  -- 6) Close the job card ONLY when every repairing qty has been invoiced.
  --    Multiple invoices may point at the same job card now, so invoice_id keeps
  --    the latest one for reference.
  if v_job_card_id is not null then
    select coalesce(repairing_quantity, 0)
      into v_repairing_total
      from public.job_cards where id = v_job_card_id;

    select coalesce(sum(ii.quantity), 0)
      into v_repairing_invoiced
      from public.invoice_items ii
      join public.invoices iv on iv.id = ii.invoice_id
     where iv.job_card_id = v_job_card_id
       and ii.inward_no = 'JOB-REP';

    v_repairing_pending := greatest(0, v_repairing_total - v_repairing_invoiced);
    v_job_card_closed := (v_repairing_total <= 0) or (v_repairing_pending <= 0.00001);

    if v_job_card_closed then
update public.job_cards
          set status = 'Closed', invoice_id = v_invoice_id, closed_at = now()
        where id = v_job_card_id;
    else
      -- Part invoice: keep the card open so the rest can be billed later.
      update public.job_cards
         set status = 'Open', invoice_id = v_invoice_id
       where id = v_job_card_id
         and status = 'Closed';
    end if;
  end if;

  return jsonb_build_object(
    'invoice_id',    v_invoice_id,
    'invoice_no',    v_invoice_no,
    'job_card_closed',      v_job_card_closed,
    'repairing_total',      v_repairing_total,
    'repairing_invoiced',   v_repairing_invoiced,
    'repairing_pending',    v_repairing_pending
  );
end;
$$;

grant execute on function public.save_invoice_atomic(text, bigint, date, bigint, bigint, text, numeric, jsonb, jsonb) to authenticated;
grant execute on function public.save_invoice_atomic(text, bigint, date, bigint, bigint, text, numeric, jsonb, jsonb) to anon;


