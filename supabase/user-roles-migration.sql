-- ============================================================
-- USER ROLES & PERMISSIONS
-- Chalayein: Supabase Dashboard > SQL Editor > New query > Run.
-- Ye migration idempotent hai — dobara chalana safe hai.
-- ============================================================

-- 1) App users table ------------------------------------------------
create table if not exists public.app_users (
  id bigserial primary key,
  auth_user_id uuid unique,
  email text not null unique,
  full_name text not null default '',
  role text not null default 'pending'
    check (role in ('admin','accountant','store','technician','auditor','pending')),
  technician_id bigint,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists app_users_role_idx on public.app_users (role);

-- 2) Login history (kaun kab login hua) ------------------------------
create table if not exists public.login_events (
  id bigserial primary key,
  auth_user_id uuid,
  email text,
  full_name text,
  role text,
  user_agent text,
  logged_in_at timestamptz not null default now()
);

create index if not exists login_events_time_idx on public.login_events (logged_in_at desc);

-- 3) Kya current user admin hai? -------------------------------------
-- Table khaali ho to har authenticated user "admin" maana jata hai
-- (bootstrap) — is tarah pehla login user khud ko admin ke roop me
-- app_users me insert kar sakta hai. Ek baar profile banne ke baad
-- sirf role='admin' wala hi admin hota hai.
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.app_users u
    where u.auth_user_id = auth.uid()
      and u.role = 'admin'
      and u.active
  ) or not exists (select 1 from public.app_users);
$$;

-- 4) Profile ka auth_user_id khali hai to login par apna auth uid link kare.
-- Security definer: RLS bypass hota hai, par WHERE sirf apne email par
-- hi update karne deta hai — role/active column kabhi badal nahi sakta.
create or replace function public.claim_app_user()
returns void
language sql
security definer
set search_path = public
as $$
  update public.app_users
     set auth_user_id = auth.uid(),
         updated_at = now()
   where auth_user_id is null
     and lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

-- 5) Row Level Security ---------------------------------------------
alter table public.app_users enable row level security;
alter table public.login_events enable row level security;

-- app_users: admin sab ko dekhe/sakta hai; har koi apni profile dekh sakta
-- hai (email match) — chahe auth_user_id abhi link na ho.
drop policy if exists app_users_select on public.app_users;
create policy app_users_select on public.app_users
  for select to authenticated
  using (
    public.is_admin()
    or auth_user_id = auth.uid()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- Insert: sirf admin. (Table khaali ho to is_admin() true hai -> bootstrap.)
drop policy if exists app_users_admin_insert on public.app_users;
create policy app_users_admin_insert on public.app_users
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists app_users_admin_update on public.app_users;
create policy app_users_admin_update on public.app_users
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists app_users_admin_delete on public.app_users;
create policy app_users_admin_delete on public.app_users
  for delete to authenticated
  using (public.is_admin());

-- login_events: koi bhi authenticated apna login record kare;
-- history sirf admin (aur khud) dekh sake.
drop policy if exists login_events_insert on public.login_events;
create policy login_events_insert on public.login_events
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists login_events_select on public.login_events;
create policy login_events_select on public.login_events
  for select to authenticated
  using (public.is_admin() or auth_user_id = auth.uid());
