-- Maruti Module Service: Enable Row Level Security (RLS)
-- Run ONCE in Supabase Dashboard -> SQL Editor.
--
-- IMPORTANT: After running this, the app will ONLY show data to a USER WHO IS
-- LOGGED IN (Supabase Auth session). Without login -> no data access from DB.
--
-- The app already shows a Login screen when there is no session
-- (App.tsx: `if (!session) return <Login />`), so normal usage is unchanged.
--
-- This script is safe to re-run (idempotent). It does not drop tables or delete data.

-- ---------------------------------------------------------------------------
-- 1) Tables the app reads/writes
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'customers',
    'items',
    'item_master',
    'customer_item_prices',
    'vendors',
    'purchases',
    'invoices',
    'invoice_items',
    'job_cards',
    'bank_transactions',
    'company_settings',
    'technicians',
    'job_card_technicians',
    'warranty_returns'
  ]
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 2) Policies: any AUTHENTICATED (logged-in) user gets full access.
--    Anonymous / not-logged-in users get no access at all.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'customers',
    'items',
    'item_master',
    'customer_item_prices',
    'vendors',
    'purchases',
    'invoices',
    'invoice_items',
    'job_cards',
    'bank_transactions',
    'company_settings',
    'technicians',
    'job_card_technicians',
    'warranty_returns'
  ]
  loop
    execute format('drop policy if exists "rls_all_%I" on public.%I;', t, t);
    execute format(
      'create policy "rls_all_%I" on public.%I for all to authenticated using (true) with check (true);',
      t, t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3) Sequences needed by triggers / client code (grant to authenticated)
-- ---------------------------------------------------------------------------
grant usage on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- 4) VERIFY: run this query after execution
--    SELECT schemaname, tablename, rowsecurity
--    FROM pg_tables
--    WHERE schemaname = 'public'
--    ORDER BY tablename;
--    Every row must show rowsecurity = true.
-- ---------------------------------------------------------------------------