-- ============================================================
-- READ-ONLY DIAGNOSTIC - single query, one result set.
-- Changes nothing.  Paste the whole output back.
-- ============================================================
select '1. items.cost_price' as item, 'cost_price' as detail,
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'items'
                           and column_name = 'cost_price')
            then 'YES - good' else 'NO - import-02 will FAIL' end as status
union all
select '2. columns', c.table_name,
       string_agg(c.column_name
                  || case when c.is_nullable = 'NO' then '!' else '' end
                  || case when c.column_default is not null then '=d' else '' end,
                  ', ' order by c.ordinal_position)
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('items','vendors','customers','purchases',
                       'invoices','invoice_items','bank_transactions')
group by c.table_name
union all
select '3. sequences', s.sequence_name, 'ok'
from information_schema.sequences s
where s.sequence_schema = 'public'
union all
select '4. triggers', t.event_object_table,
       t.trigger_name || ' ' || t.action_timing || ' ' || t.event_manipulation
from information_schema.triggers t
where t.trigger_schema = 'public'
order by 1, 2;
