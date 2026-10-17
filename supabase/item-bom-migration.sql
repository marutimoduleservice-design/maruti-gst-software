-- Item BOM (Bill of Materials) for Kit/Set items
-- Run in Supabase SQL Editor

create table if not exists public.item_bom (
  id bigserial primary key,
  parent_item_id bigint not null references public.items(id) on delete cascade,
  child_item_id bigint not null references public.items(id) on delete cascade,
  quantity numeric not null default 1,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  unique (parent_item_id, child_item_id)
);

create index if not exists idx_item_bom_parent on public.item_bom(parent_item_id);
create index if not exists idx_item_bom_child on public.item_bom(child_item_id);

alter table public.item_bom enable row level security;

-- RLS policies (read/write for authenticated/anon if needed)
drop policy if exists "Allow all on item_bom" on public.item_bom;
create policy "Allow all on item_bom"
  on public.item_bom for all
  using (true)
  with check (true);

-- BOM for Pulley Set Without Bearing (ITM-0004)
-- Components:
-- 1. Upper Cord (ITM-0006)
-- 2. Only Pulley Cover For Without Bearing Pulley (ITM-0003)
-- 3. Lower Cord - Size - 285mm (ITM-0009)

insert into public.item_bom (parent_item_id, child_item_id, quantity)
select
  (select id from public.items where item_code = 'ITM-0004' limit 1),
  (select id from public.items where item_code = 'ITM-0006' limit 1),
  1
where not exists (
  select 1 from public.item_bom b
  join public.items p on p.id = b.parent_item_id and p.item_code = 'ITM-0004'
  join public.items c on c.id = b.child_item_id and c.item_code = 'ITM-0006'
);

insert into public.item_bom (parent_item_id, child_item_id, quantity)
select
  (select id from public.items where item_code = 'ITM-0004' limit 1),
  (select id from public.items where item_code = 'ITM-0003' limit 1),
  1
where not exists (
  select 1 from public.item_bom b
  join public.items p on p.id = b.parent_item_id and p.item_code = 'ITM-0004'
  join public.items c on c.id = b.child_item_id and c.item_code = 'ITM-0003'
);

insert into public.item_bom (parent_item_id, child_item_id, quantity)
select
  (select id from public.items where item_code = 'ITM-0004' limit 1),
  (select id from public.items where item_code = 'ITM-0009' limit 1),
  1
where not exists (
  select 1 from public.item_bom b
  join public.items p on p.id = b.parent_item_id and p.item_code = 'ITM-0004'
  join public.items c on c.id = b.child_item_id and c.item_code = 'ITM-0009'
);
