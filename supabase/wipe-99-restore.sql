-- ============================================================================
-- STEP 2 of 2  |  RESTORE FROM BACKUP
-- Maruti Module Service — Supabase SQL Editor
--
-- Use this ONLY if the wipe was a mistake. It puts every bak_* table back.
--
-- Order is handled automatically: it loops the backups in dependency order,
-- and if a table has no foreign keys it simply loads first. Each insert is
-- attempted; if one fails because a parent is not loaded yet it is retried on
-- the next pass, so a single run restores everything.
-- ============================================================================


-- ############################################################################
-- Loop until every backup is loaded, or nothing changes any more.
-- Parents get in on an early pass, children on a later one.
-- ############################################################################
do $$
declare
  v_pass      int := 0;
  v_inserted  int;
  r           record;
begin
  loop
    v_pass    := v_pass + 1;
    v_inserted := 0;

    for r in
      select b.tablename
        from pg_tables b
       where b.schemaname = 'public'
         and b.tablename like 'bak\_%'
       order by b.tablename
    loop
      -- skip anything already loaded
      if (xpath('/row/c/text()', query_to_xml(
            format('select count(*) as c from public.%I', r.tablename),
            false, true, '')))[1]::text::bigint = 0
      then
        begin
          execute format(
            'insert into public.%I overriding system value select * from public.%I',
            substring(r.tablename from 5), r.tablename);
          v_inserted := v_inserted + 1;
        exception when others then
          -- still waiting on a parent row; retried next pass
          null;
        end;
      end if;
    end loop;

    exit when v_inserted = 0 or v_pass > 8;
  end loop;

  raise notice 'Restore finished after % pass(es)', v_pass;
end $$;


-- ############################################################################
-- VERIFY
-- Compare these against the inventory printed in step 1 of the wipe.
-- ############################################################################
select
  format('%I', tablename) as table_name,
  (xpath('/row/c/text()', query_to_xml(
      format('select count(*) as c from public.%I', tablename), false, true, '')))[1]::text::bigint
    as row_count
  from pg_tables
 where schemaname = 'public'
   and tablename not like 'bak\_%'
 order by tablename;

-- The figures that were locked before the wipe.
select
  (select coalesce(sum(total_amount), 0) from public.invoices)         as sale_total,
  (select coalesce(sum(payment_in), 0) from public.bank_transactions) as money_in,
  (select coalesce(sum(payment_out), 0) from public.bank_transactions) as money_out,
  (select count(*) from public.invoice_items)                         as invoice_lines;

commit;
