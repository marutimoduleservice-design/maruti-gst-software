-- =============================================================================
-- GOOGLE SHEET IMPORT  (part 1 of 2)  -- verified 28-Sep-2026
-- =============================================================================
-- Run AFTER: clean-slate-wipe.sql + opening-balances-migration.sql
--            + fy-numbering-migration.sql
--
-- Contains: vendors, customers, item master, 15 inward batches,
--           7 vendor pending bills (RSK), 78 customer bills, 2 receipts,
--           bank balance b/f
--
-- Verified totals:
--   Customer outstanding : 24 customers = Rs 2,09,802.30
--   Vendor pending (RSK)  : Rs 8,245.00
--   Inward value (15)     : Rs 1,17,139.00
--   Stock (after outward) : 11 items = Rs 46,789.45
--   Bank balance          : Rs 1,66,127.10 (current 28-Sep-2026)
--
-- NOTE: invoice_items (item-wise sale rows) are intentionally NOT part of this
--       file. They load in part 2 from the item-wise sales sheet.
--       Until then Stock Report will show FULL inward qty (nothing sold).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1) VENDORS  (8)  -- 7 inward suppliers + RSK (job work)
-- -----------------------------------------------------------------------------
insert into public.vendors (vendor_code, business_name, mobile, address)
values
  ('VEN-001', 'King',            null, null),
  ('VEN-002', 'Hemraj',          null, null),
  ('VEN-003', 'Sky Impex',       null, null),
  ('VEN-004', 'Khodal',          null, null),
  ('VEN-005', 'Zota Side',       null, null),
  ('VEN-006', 'Master Tools',    null, null),
  ('VEN-007', 'JMSS',            null, null),
  ('VEN-008', 'RSK',             null, null);

-- -----------------------------------------------------------------------------
-- 2) ITEMS  (11)  -- opening_stock = 0, saara stock inward se aayega
--    ITM-0006 Upper Cord is multi-batch -> weighted rate 20086.50 / 3643 = 5.5132
-- -----------------------------------------------------------------------------
insert into public.items
  (item_code, item_name, unit, hsn_code, gst_percent, purchase_price, sale_price, opening_stock, min_stock)
values
  ('ITM-0001', 'Magnet - DT 1',                        'PCS', null, 18,  5.00,  0, 0, 0),
  ('ITM-0002', 'Magnet - DT 2',                        'PCS', null, 18, 28.00,  0, 0, 0),
  ('ITM-0003', 'Only Pulley Cover For Bearing Pulley', 'PCS', null, 18,  5.00,  0, 0, 0),
  ('ITM-0004', 'Pulley Set Without Bearing',           'PCS', null, 18, 21.00,  0, 0, 0),
  ('ITM-0005', 'Pulley Set With Bearing - Size - 285mm','PCS', null, 18, 35.00,  0, 0, 0),
  ('ITM-0006', 'Upper Cord',                           'PCS', null, 18,  5.51,  0, 0, 0),
  ('ITM-0007', 'Chemical for Washing',                 'PCS', null, 18, 50.00,  0, 0, 0),
  ('ITM-0008', 'Iron Hook',                            'PCS', null, 18,  5.50,  0, 0, 0),
  ('ITM-0009', 'Lower Cord - Size - 285mm',            'PCS', null, 18,  5.70,  0, 0, 0),
  ('ITM-0010', 'Upper Cord - CC',                      'PCS', null, 18,  6.65,  0, 0, 0),
  ('ITM-0011', 'Spring For Iron Hook',                 'PCS', null, 18,  0.50,  0, 0, 0);

-- -----------------------------------------------------------------------------
-- 3) CUSTOMERS  (24)  -- spelling variants merged
-- -----------------------------------------------------------------------------
insert into public.customers
  (customer_code, customer_name, business_name, mobile, business_address, gst_available, payment_term)
values
  ( 1, 'Om Textile',            'Om Textile',            null, null, false, null),
  ( 2, 'Devangi Textile',       'Devangi Textile',       null, null, false, null),
  ( 3, 'Dipal Fashion',         'Dipal Fashion',         null, null, false, null),
  ( 4, 'Vikas Textile',         'Vikas Textile',         null, null, false, null),
  ( 5, 'Yogi Sales Corporation','Yogi Sales Corporation',null, null, false, null),
  ( 6, 'Nikunj Textile',        'Nikunj Textile',        null, null, false, null),
  ( 7, 'Manav Textile',         'Manav Textile',         null, null, false, null),
  ( 8, 'Balaji Textile',        'Balaji Textile',        null, null, false, null),
  ( 9, 'Dev Fab',               'Dev Fab',               null, null, false, null),
  (10, 'Jay Brahmani Textile',  'Jay Brahmani Textile',  null, null, false, null),
  (11, 'Plot No 252',           'Plot No 252',           null, null, false, null),
  (12, 'Neel Fab',              'Neel Fab',              null, null, false, null),
  (13, 'Shivam Fashion',        'Shivam Fashion',        null, null, false, null),
  (14, 'Ridham Textile',        'Ridham Textile',        null, null, false, null),
  (15, 'Sundaram Fashion',      'Sundaram Fashion',      null, null, false, null),
  (16, 'Disha Fashion',         'Disha Fashion',         null, null, false, null),
  (17, 'Mahadev Textile',       'Mahadev Textile',       null, null, false, null),
  (18, 'Shubham Textile',       'Shubham Textile',       null, null, false, null),
  (19, 'Ruhi Fab',              'Ruhi Fab',              null, null, false, null),
  (20, 'Adesh Silk Mills',      'Adesh Silk Mills',      null, null, false, null),
  (21, 'D B Textile',           'D B Textile',           null, null, false, null),
  (22, 'Jalaram Group F1',      'Jalaram Group F1',      null, null, false, null),
  (23, 'Hiren Textile',         'Hiren Textile',         null, null, false, null),
  (24, 'Rama Sarees',           'Rama Sarees',           null, null, false, null);

-- -----------------------------------------------------------------------------
-- 4) INWARD BATCHES  (15)  -- full original quantity, sale outward loads in part 2
--    purchase_no = inward_no so Purchase page groups correctly
-- -----------------------------------------------------------------------------
insert into public.purchases
  (purchase_no, inward_no, purchase_date, vendor_id, vendor_name, vendor_code,
   item_name, item_code, quantity, rate, total_amount, payment_mode, status, remarks)
select v.purchase_no, v.inward_no, v.purchase_date::date, ven.id, ven.business_name, ven.vendor_code,
       v.item_name, it.item_code, v.quantity, v.rate, v.rate * v.quantity, 'Bank / UPI', 'Paid',
       'Imported from Google Sheet'
  from (values
    ('INW15','INW15','2026-02-05',1,'Magnet - DT 2',                        22,   28.00),
    ('INW19','INW19','2026-03-06',2,'Magnet - DT 1',                        639,   5.00),
    ('INW61','INW61','2026-05-24',2,'Magnet - DT 1',                        800,   5.00),
    ('INW66','INW66','2026-06-08',3,'Only Pulley Cover For Bearing Pulley', 1000,  5.00),
    ('INW90','INW90','2026-07-13',1,'Pulley Set Without Bearing',           8,     21.00),
    ('INW93','INW93','2026-07-15',4,'Upper Cord',                           100,   6.00),
    ('INW109','INW109','2026-08-01',5,'Chemical for Washing',               40,    50.00),
    ('INW118','INW118','2026-08-14',1,'Upper Cord',                          5000,  5.50),
    ('INW122','INW122','2026-08-22',3,'Iron Hook',                           1000,  5.50),
    ('INW124','INW124','2026-09-05',1,'Upper Cord',                          5000,  5.50),
    ('INW125','INW125','2026-09-05',6,'Lower Cord - Size - 285mm',           1000,  5.70),
    ('INW127','INW127','2026-09-07',1,'Upper Cord - CC',                     2000,  6.65),
    ('INW129','INW129','2026-09-07',7,'Spring For Iron Hook',                10000, 0.50),
    ('INW137','INW137','2026-09-28',1,'Upper Cord',                          3000,  5.50),
    ('INW138','INW138','2026-09-28',1,'Pulley Set With Bearing - Size - 285mm', 16,  35.00)
  ) as v(purchase_no, inward_no, purchase_date, vendor_no, item_name, quantity, rate)
  join public.vendors ven on ven.vendor_code = 'VEN-' || lpad(v.vendor_no::text, 3, '0')
  join public.items    it  on it.item_name = v.item_name;

-- -----------------------------------------------------------------------------
-- 5) VENDOR PENDING - RSK job work  (7 bills, all Unpaid, Rs 8,245.00)
--    quantity = 0 on purpose: ye service/job-work charges hain, stock nahi.
--    Isse Stock Report me koi item inward nahi hoga.
-- -----------------------------------------------------------------------------
insert into public.purchases
  (purchase_no, inward_no, purchase_date, vendor_id, vendor_name, vendor_code,
   item_name, item_code, quantity, rate, total_amount, payment_mode, status, remarks)
select v.purchase_no, v.inward_no, v.purchase_date::date, ven.id, ven.business_name, ven.vendor_code,
       'Job Work Charges', null, 0, 0, v.amount, 'Bank / UPI', 'Pending', v.remarks
  from (values
    ('RSK-001','RSK-001','2026-08-10', 4160.00,'Qty 74 Vikas Textile (Qty 30 ok 1 not ok Devangi)'),
    ('RSK-002','RSK-002','2026-08-14',  480.00,'Yogi Qty 12 Ciel Card'),
    ('RSK-003','RSK-003','2026-08-22',  765.00,'Qty 17 x 45 Manav'),
    ('RSK-004','RSK-004','2026-08-31',  540.00,'Qty 12 Manav Ciel Card x 45'),
    ('RSK-005','RSK-005','2026-09-23', 1580.00,'Yogi Qty 6 X 40 , DB Qty 26 x 40 Distribution Card Qty 1 Rs 300'),
    ('RSK-006','RSK-006','2026-09-23',  360.00,'Qty 8 x 45 Ciel Card Manav [ 9 Card Lena Baki ]'),
    ('RSK-007','RSK-007','2026-09-26',  360.00,'Qty 9 Ciel Card Manav')
  ) as v(purchase_no, inward_no, purchase_date, amount, remarks)
  join public.vendors ven on ven.vendor_code = 'VEN-008';

-- -----------------------------------------------------------------------------
-- 6) CUSTOMER BILLS  (78)
--    invoice_no = 'INV-2026-' || lpad(bill_no, 4, '0')
--    Bill 351/352/353 intentionally missing (module repair) -> next bill = INV-2026-0355
--    Bill 261 date corrected from 12/05/2026 -> 12/08/2026
-- -----------------------------------------------------------------------------
insert into public.invoices
  (invoice_no, invoice_date, customer_id, invoice_type, total_amount, pending_amount, status, notes)
select 'INV-2026-' || lpad(v.bill_no::text, 4, '0'), v.bill_date::date, c.id,
       'Spare Part', v.bill_amount, v.pending_amount,
       case when v.pending_amount <= 0 then 'Paid'
            when v.received > 0 then 'Partial'
            else 'Pending' end,
       'Imported from Google Sheet'
  from (values
    ('2026-07-02', 164,'Om Textile',             322.00,   0.00, 322.00),
    ('2026-07-07', 173,'Om Textile',             453.00,   0.00, 453.00),
    ('2026-07-10', 176,'Devangi Textile',       4560.00,   0.00, 4560.00),
    ('2026-07-21', 201,'Devangi Textile',       3650.00,   0.00, 3650.00),
    ('2026-07-23', 205,'Devangi Textile',       1975.00,   0.00, 1975.00),
    ('2026-07-24', 207,'Devangi Textile',        672.00,   0.00,  672.00),
    ('2026-07-25', 211,'Devangi Textile',        993.00,   0.00,  993.00),
    ('2026-07-29', 215,'Devangi Textile',       2333.50,   0.00, 2333.50),
    ('2026-08-01', 227,'Dipal Fashion',           91.00,   0.00,   91.00),
    ('2026-08-04', 241,'Devangi Textile',       1561.40,   0.00, 1561.40),
    ('2026-08-04', 246,'Devangi Textile',       2200.00,   0.00, 2200.00),
    ('2026-08-06', 250,'Vikas Textile',         2571.40,   0.00, 2571.40),
    ('2026-08-10', 258,'Vikas Textile',         3700.00,   0.00, 3700.00),
    ('2026-08-10', 259,'Devangi Textile',       1500.00,   0.00, 1500.00),
    ('2026-08-11', 260,'Devangi Textile',       1438.00,   0.00, 1438.00),
    ('2026-08-12', 261,'Vikas Textile',         3457.20,   0.00, 3457.20),
    ('2026-08-13', 264,'Yogi Sales Corporation',6232.20,4781.20,1451.00),
    ('2026-08-18', 270,'Devangi Textile',       1858.60,   0.00, 1858.60),
    ('2026-08-18', 271,'Vikas Textile',         3861.40,   0.00, 3861.40),
    ('2026-08-19', 272,'Yogi Sales Corporation',1818.40,   0.00, 1818.40),
    ('2026-08-18', 273,'Nikunj Textile',        1220.40,   0.00, 1220.40),
    ('2026-08-20', 278,'Vikas Textile',          500.00,   0.00,  500.00),
    ('2026-08-21', 279,'Yogi Sales Corporation',4883.00,   0.00, 4883.00),
    ('2026-08-22', 281,'Manav Textile',          850.00,   0.00,  850.00),
    ('2026-08-22', 280,'Balaji Textile',        4055.00,   0.00, 4055.00),
    ('2026-08-23', 282,'Vikas Textile',         2184.00,   0.00, 2184.00),
    ('2026-08-26', 287,'Manav Textile',         3629.00,   0.00, 3629.00),
    ('2026-08-27', 288,'Vikas Textile',         3555.00,   0.00, 3555.00),
    ('2026-08-28', 289,'Devangi Textile',       2762.00,   0.00, 2762.00),
    ('2026-08-29', 290,'Dev Fab',               7777.00,   0.00, 7777.00),
    ('2026-08-31', 296,'Manav Textile',          600.00,   0.00,  600.00),
    ('2026-09-02', 298,'Yogi Sales Corporation',5744.00,   0.00, 5744.00),
    ('2026-09-03', 299,'Vikas Textile',         5282.00,   0.00, 5282.00),
    ('2026-09-03', 300,'Jay Brahmani Textile',  5229.00,   0.00, 5229.00),
    ('2026-09-04', 301,'Plot No 252',            554.00,   0.00,  554.00),
    ('2026-09-04', 302,'Neel Fab',              6065.00,   0.00, 6065.00),
    ('2026-09-05', 305,'Dev Fab',               5250.00,   0.00, 5250.00),
    ('2026-09-07', 306,'Shivam Fashion',        4003.00,   0.00, 4003.00),
    ('2026-09-08', 307,'Devangi Textile',        941.00,   0.00,  941.00),
    ('2026-09-08', 308,'Ridham Textile',        4265.00,   0.00, 4265.00),
    ('2026-09-09', 309,'Vikas Textile',         4742.00,   0.00, 4742.00),
    ('2026-09-09', 311,'Devangi Textile',       2062.00,   0.00, 2062.00),
    ('2026-09-11', 312,'Sundaram Fashion',       922.00,   0.00,  922.00),
    ('2026-09-11', 313,'Disha Fashion',         1429.00,   0.00, 1429.00),
    ('2026-09-11', 314,'Yogi Sales Corporation',3409.00,   0.00, 3409.00),
    ('2026-09-13', 315,'Yogi Sales Corporation', 850.00,   0.00,  850.00),
    ('2026-09-14', 317,'Mahadev Textile',       2114.00,   0.00, 2114.00),
    ('2026-09-14', 318,'Shubham Textile',        364.00, 104.00,  260.00),
    ('2026-09-15', 319,'Disha Fashion',         1232.00,   0.00, 1232.00),
    ('2026-09-16', 320,'Ruhi Fab',              1166.00,   0.00, 1166.00),
    ('2026-09-17', 321,'Manav Textile',         2774.00,   0.00, 2774.00),
    ('2026-09-17', 326,'Manav Textile',         1100.00,   0.00, 1100.00),
    ('2026-09-20', 322,'Yogi Sales Corporation',11741.00,  0.00,11741.00),
    ('2026-09-21', 325,'Jay Brahmani Textile',  5922.00,   0.00, 5922.00),
    ('2026-09-22', 327,'Neel Fab',             11919.00,   0.00,11919.00),
    ('2026-09-22', 332,'Shubham Textile',       1124.00,   0.00, 1124.00),
    ('2026-09-22', 328,'Adesh Silk Mills',      3609.00,   0.00, 3609.00),
    ('2026-09-22', 329,'Vikas Textile',         3046.00,   0.00, 3046.00),
    ('2026-09-23', 330,'D B Textile',           2840.00,   0.00, 2840.00),
    ('2026-09-23', 331,'Disha Fashion',         2473.00,   0.00, 2473.00),
    ('2026-09-23', 333,'Manav Textile',         1961.00,   0.00, 1961.00),
    ('2026-09-23', 337,'Yogi Sales Corporation', 300.00,   0.00,  300.00),
    ('2026-09-23', 338,'D B Textile',           1600.00,   0.00, 1600.00),
    ('2026-09-23', 339,'Manav Textile',          400.00,   0.00,  400.00),
    ('2026-09-23', 340,'Ridham Textile',        3671.00,   0.00, 3671.00),
    ('2026-09-23', 341,'Rama Sarees',           2640.00,   0.00, 2640.00),
    ('2026-09-24', 334,'Yogi Sales Corporation',6218.00,   0.00, 6218.00),
    ('2026-09-26', 335,'Jalaram Group F1',      2370.00,   0.00, 2370.00),
    ('2026-09-26', 336,'Vikas Textile',         3273.00,   0.00, 3273.00),
    ('2026-09-26', 342,'Hiren Textile',         1221.00,   0.00, 1221.00),
    ('2026-09-26', 343,'Manav Textile',         3041.00,   0.00, 3041.00),
    ('2026-09-26', 344,'D B Textile',            773.00,   0.00,  773.00),
    ('2026-09-27', 346,'Manav Textile',          450.00,   0.00,  450.00),
    ('2026-09-27', 347,'D B Textile',            558.00,   0.00,  558.00),
    ('2026-09-27', 349,'Disha Fashion',         1393.00,   0.00, 1393.00),
    ('2026-09-28', 348,'Hiren Textile',         1720.00,   0.00, 1720.00),
    ('2026-09-28', 350,'Yogi Sales Corporation',2659.00,   0.00, 2659.00),
    ('2026-09-28', 354,'Yogi Sales Corporation',1005.00,   0.00, 1005.00)
  ) as v(bill_date, bill_no, cust, bill_amount, received, pending_amount)
  join public.customers c on c.customer_name = v.cust;

-- -----------------------------------------------------------------------------
-- 7) RECEIPTS  (2)  -- sirf wahi 2 jo sheet me "Recived Amount" me hain
--    Particulars me invoice number likha hai taaki per-bill allocation work kare
-- -----------------------------------------------------------------------------
insert into public.bank_transactions
  (transaction_no, transaction_date, payment_in, payment_out, particulars, notes)
select v.transaction_no, v.txn_date::date, v.amount, 0, v.particulars,
       'Imported from Google Sheet (payment date not given in sheet)'
  from (values
    ('RC-2026-0001','2026-08-13', 4781.20,'Yogi Sales Corporation - INV-2026-0264'),
    ('RC-2026-0002','2026-09-14',  104.00,'Shubham Textile - INV-2026-0318')
  ) as v(transaction_no, txn_date, amount, particulars);

-- -----------------------------------------------------------------------------
-- 8) BANK BALANCE b/f  -- Rs 1,61,241.90 on 01-Apr-2026 (FY start)
--    User confirmed Rs 1,66,127.10 is the CURRENT (28-Sep-2026) balance, so the
--    2 receipts in section 7 are already inside it. To avoid double counting:
--        1,66,127.10 - 4,781.20 - 104.00 = 1,61,241.90  (1-Apr opening)
--    After section 7 the running balance returns to 1,66,127.10.
--    NOTE: this assumes NO other bank transactions between 1-Apr and 28-Sep.
--          If there were (vendor payments, expenses), share them and we adjust.
-- -----------------------------------------------------------------------------
insert into public.bank_transactions
  (transaction_no, transaction_date, payment_in, payment_out, particulars, notes)
values ('RC-2026-0000', '2026-04-01', 161241.90, 0,
        'Bank Balance b/f', 'Opening bank balance = 1,66,127.10 current minus receipts 4,885.20');

commit;

-- =============================================================================
-- VERIFICATION  (sab numbers match hone chahiye)
-- =============================================================================
select 'Customer outstanding' as check, count(distinct customer_id)::text || ' customers' as detail,
       round(sum(pending_amount), 2) as amount, 209802.30 as expected
  from public.invoices;

select 'Vendor pending' as check, count(*)::text || ' bills' as detail,
       round(sum(total_amount), 2) as amount, 8245.00 as expected
  from public.purchases where status <> 'Paid';

select 'Inward value' as check, count(*)::text || ' batches' as detail,
       round(sum(total_amount), 2) as amount, 117139.00 as expected
  from public.purchases where item_code is not null;

select 'Bank balance' as check, 'running' as detail,
       round(sum(payment_in - payment_out), 2) as amount, 166127.10 as expected
  from public.bank_transactions;

-- next invoice number should be INV-2026-0355
select invoice_no from public.invoices
 order by substring(invoice_no from '[0-9]+$')::int desc limit 1;
