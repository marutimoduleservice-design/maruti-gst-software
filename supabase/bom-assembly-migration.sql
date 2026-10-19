-- Maruti Module Service: BOM / Set Assembly
-- Supabase SQL Editor me ek baar run karo.
--
-- Kya karta hai:
--   1. Naya menu "BOM Assembly" set/kit ko PHYSICALLY banata hai:
--        - Set ka stock badhta hai (naye inward no. INW-xxxx ke saath)
--        - Components ka stock unke PURANE inward batches se FIFO kata jaata hai
--   2. Purchases / vendor bills ko BILKUL nahi chhoota - assembly alag table me
--      rehti hai, isliye Purchase Report aur Payments Ledger safe rehte hain.
--
-- Stock formula (ab tak wahi, sirf assembly add hui):
--   stock = opening + purchases(inward) - invoice_items(sold) + assembly(set) - assembly(components)
--
-- Pehle ke virtual "BOM-SET" logic (jo sirf invoice screen par tha) hataya ja raha
-- hai - ab set ka stock asli hota hai, isliye wo virtual rows nahi chahiye.

-- ============================================================
-- 1. TABLE: bom_assemblies (set banane ka header)
-- ============================================================
create table if not exists public.bom_assemblies (
  id              bigserial primary key,
  company_id      bigint not null default 1,
  assembly_no     text not null,                    -- INW-xxxx (set ka inward no.)
  assembly_date   date not null default (now() at time zone 'utc')::date,
  set_item_id     bigint not null references public.items(id) on delete cascade,
  set_item_name   text not null,
  set_item_code   text default '',
  set_quantity    numeric not null check (set_quantity > 0),
  set_rate        numeric not null default 0,       -- cost per set (components ka total)
  total_cost      numeric not null default 0,       -- set_quantity * set_rate
  remarks         text default '',
  created_at      timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists idx_bom_assemblies_company on public.bom_assemblies (company_id);
create index if not exists idx_bom_assemblies_set_item on public.bom_assemblies (set_item_id);
create unique index if not exists uq_bom_assemblies_no on public.bom_assemblies (company_id, assembly_no);

-- ============================================================
-- 2. TABLE: bom_assembly_items (components jo khaaye gaye)
--    component_inward_no = kaun se inward batch se kata (FIFO allocation)
-- ============================================================
create table if not exists public.bom_assembly_items (
  id                   bigserial primary key,
  company_id           bigint not null default 1,
  assembly_id          bigint not null references public.bom_assemblies(id) on delete cascade,
  component_item_id    bigint not null references public.items(id) on delete cascade,
  component_item_name  text not null,
  component_item_code  text default '',
  component_inward_no  text not null,               -- jis inward batch se kata
  quantity             numeric not null check (quantity > 0),
  rate                 numeric not null default 0,  -- us batch ka purchase rate
  created_at           timestamp with time zone not null default timezone('utc'::text, now())
);

create index if not exists idx_bom_assembly_items_assembly on public.bom_assembly_items (assembly_id);
create index if not exists idx_bom_assembly_items_component on public.bom_assembly_items (component_item_id);
create index if not exists idx_bom_assembly_items_line on public.bom_assembly_items (component_inward_no, component_item_name);

-- ============================================================
-- 3. RLS (item_bom wahi pattern follow karta hai)
-- ============================================================
alter table public.bom_assemblies enable row level security;
drop policy if exists "Allow all on bom_assemblies" on public.bom_assemblies;
create policy "Allow all on bom_assemblies"
  on public.bom_assemblies for all
  using (true)
  with check (true);

alter table public.bom_assembly_items enable row level security;
drop policy if exists "Allow all on bom_assembly_items" on public.bom_assembly_items;
create policy "Allow all on bom_assembly_items"
  on public.bom_assembly_items for all
  using (true)
  with check (true);

-- ============================================================
-- 4. RPC: run_bom_assembly  (sab kuch EK transaction me)
--    - Set ka naya INW number nikaalta hai (running series)
--    - Har component ko purane inward batch se FIFO kata hai
--    - Agar kisi component ka stock kam hua to POORA rollback
-- ============================================================
drop function if exists public.run_bom_assembly(bigint, numeric, date, text, bigint) cascade;

create or replace function public.run_bom_assembly(
  p_set_item_id     bigint,
  p_set_qty         numeric  default 1,
  p_assembly_date   date     default null,
  p_remarks         text     default '',
  p_company_id      bigint   default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id   bigint;
  v_qty          numeric;
  v_set          record;
  v_assembly_no  text;
  v_assembly_id  bigint;
  v_max_pur      bigint;
  v_max_asm      bigint;
  v_next         bigint;
  v_total_cost   numeric := 0;
  v_set_rate     numeric := 0;
  v_components   jsonb := '[]'::jsonb;
  v_child        record;
  v_batch        record;
  v_need         numeric;
  v_consumed     numeric;
  v_alloc        numeric;
  v_batch_rate   numeric;
  v_batch_inw    text;
  v_child_cost   numeric;
begin
  v_company_id := coalesce(
    p_company_id,
    (select min(id) from public.companies where active),
    1
  );

  v_qty := coalesce(p_set_qty, 0);
  if v_qty is null or v_qty < 1 then
    raise exception 'Set quantity kam se kam 1 honi chahiye.';
  end if;

  -- Set item hona chahiye + uski BOM definition honi chahiye
  select id, item_name, coalesce(item_code, '') as item_code
    into v_set
    from public.items
   where id = p_set_item_id;

  if not found then
    raise exception 'Set item nahi mila (id %).', p_set_item_id;
  end if;

  if not exists (
    select 1 from public.item_bom where parent_item_id = p_set_item_id
  ) then
    raise exception '"%" ki BOM definition nahi hai. Pehle Item Master me is item ka BOM banao.',
      v_set.item_name;
  end if;

  -- ----------------------------------------------------------
  -- Running INW series: purchases aur pehle ki assemblies dono
  -- se max nikaal kar ek aage badhao.
  -- ----------------------------------------------------------
  select coalesce(max(nullif(regexp_replace(
           coalesce(nullif(trim(p.inward_no), ''), nullif(trim(p.purchase_no), '')),
           '\D', '', 'g'), '')::bigint), 1000)
    into v_max_pur
    from public.purchases p;

  select coalesce(max(nullif(regexp_replace(
           trim(a.assembly_no), '\D', '', 'g'), '')::bigint), 1000)
    into v_max_asm
    from public.bom_assemblies a;

  v_next := greatest(coalesce(v_max_pur, 1000), coalesce(v_max_asm, 1000)) + 1;
  v_assembly_no := 'INW-' || v_next::text;

  -- Header pehle insert taaki allocation rows seedhe link ho sakeng.
  insert into public.bom_assemblies
    (company_id, assembly_no, assembly_date, set_item_id, set_item_name,
     set_item_code, set_quantity, set_rate, total_cost, remarks)
  values
    (v_company_id, v_assembly_no, coalesce(p_assembly_date, now()::date),
     v_set.id, v_set.item_name, v_set.item_code, v_qty, 0, 0, coalesce(p_remarks, ''))
  returning id into v_assembly_id;

  -- ----------------------------------------------------------
  -- Har component: need = BOM qty * set qty, FIFO allocation
  -- ----------------------------------------------------------
  for v_child in
    select b.child_item_id,
           b.quantity                     as bom_qty,
           i.item_name,
           coalesce(i.item_code, '')      as item_code
      from public.item_bom b
      join public.items i on i.id = b.child_item_id
     where b.parent_item_id = p_set_item_id
     order by b.id
  loop
    v_need      := v_child.bom_qty * v_qty;
    v_consumed  := 0;
    v_child_cost := 0;

    for v_batch in
      select p.inward_no, coalesce(p.rate, 0) as rate,
             p.quantity
               - coalesce((
                   select sum(si.quantity)
                     from public.invoice_items si
                    where lower(trim(si.inward_no)) = lower(trim(p.inward_no))
                      and lower(trim(si.item_name))  = lower(trim(p.item_name))
                      and coalesce(si.inward_no, '') not like 'JOB-%'
                 ), 0)
               - coalesce((
                   select sum(ai.quantity)
                     from public.bom_assembly_items ai
                    where lower(trim(ai.component_inward_no)) = lower(trim(p.inward_no))
                      and lower(trim(ai.component_item_name)) = lower(trim(p.item_name))
                 ), 0)
               as avail
        from public.purchases p
       where p.quantity > 0
         and (
               lower(trim(p.item_name)) = lower(trim(v_child.item_name))
               or (
                 nullif(trim(p.item_code), '') is not null
                 and nullif(trim(v_child.item_code), '') is not null
                 and lower(trim(p.item_code)) = lower(trim(v_child.item_code))
               )
             )
       order by p.id asc
    loop
      exit when (v_need - v_consumed) <= 0;
      -- avail 0 ya usse kam ho to us batch ko chhod do
      if coalesce(v_batch.avail, 0) <= 0 then
        continue;
      end if;

      v_alloc      := least(v_batch.avail, v_need - v_consumed);
      v_batch_inw  := trim(v_batch.inward_no);
      v_batch_rate := coalesce(v_batch.rate, 0);
      exit when v_alloc <= 0;

      insert into public.bom_assembly_items
        (company_id, assembly_id, component_item_id, component_item_name,
         component_item_code, component_inward_no, quantity, rate)
      values
        (v_company_id, v_assembly_id, v_child.child_item_id, v_child.item_name,
         v_child.item_code, v_batch_inw, v_alloc, v_batch_rate);

      v_consumed   := v_consumed + v_alloc;
      v_child_cost := v_child_cost + (v_alloc * v_batch_rate);
    end loop;

    if v_consumed < v_need then
      raise exception 'Component "%" ka stock sirf % hai (chahiye %). Stock kam hai - pehle Purchase karo.',
        v_child.item_name, v_consumed, v_need;
    end if;

    v_total_cost := v_total_cost + v_child_cost;
    v_components := v_components || jsonb_build_array(jsonb_build_object(
      'item_id', v_child.child_item_id,
      'name',    v_child.item_name,
      'qty',     v_need,
      'cost',    round(v_child_cost, 2)
    ));
  end loop;

  -- Cost per set = total component cost / set qty
  v_set_rate := case when v_qty > 0 then round(v_total_cost / v_qty, 2) else 0 end;

  update public.bom_assemblies
     set set_rate   = v_set_rate,
         total_cost = round(v_total_cost, 2)
   where id = v_assembly_id;

  return jsonb_build_object(
    'assembly_id',   v_assembly_id,
    'assembly_no',   v_assembly_no,
    'set_item_name', v_set.item_name,
    'set_quantity',  v_qty,
    'set_rate',      v_set_rate,
    'total_cost',    round(v_total_cost, 2),
    'components',    v_components
  );
end;
$$;

grant execute on function public.run_bom_assembly(bigint, numeric, date, text, bigint) to authenticated;
grant execute on function public.run_bom_assembly(bigint, numeric, date, text, bigint) to anon;
