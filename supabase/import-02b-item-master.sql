-- ============================================================
-- STEP 2b/5  item_master BACKFILL  (legacy twin of items; invoice_items.item_id FKs here)
-- Maruti Module Service | FY 2026-27 | auto-generated
-- Run in order after clean-slate-wipe.sql + fy-numbering-migration.sql
-- ============================================================

-- Run this INSTEAD of re-running import-02 when items / vendors / customers
-- are already loaded.  It only fills item_master, which nothing references
-- yet, so clearing it first is safe.
begin;

delete from public.item_master;

insert into public.item_master (id, item_code, item_name, category, unit, hsn_code,
                                gst_percent, purchase_price, sale_price, opening_stock, minimum_stock)
  values
  (1, 'CS0002', 'Allen Key 2.5 mm', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (2, 'CS0001', 'Bearing For Bearing Pulley', 'Other', 'PCS', NULL, 0, 0.00, 7.00, 0, 0),
  (3, 'MS0040', 'Bearing For Without Bearing Pulley', 'Other', 'PCS', NULL, 0, 0.00, 7.00, 0, 0),
  (4, 'AS0002', 'BL - Steel Upper Cord + New Cover + Labour', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (5, 'MS0039', 'Bolt', 'Other', 'PCS', NULL, 0, 0.00, 7.00, 0, 0),
  (6, 'MS0011', 'Buterfly', 'Other', 'PCS', NULL, 0, 1.50, 2.00, 0, 0),
  (7, 'AS0004', 'CC Upper Cord + New Cover + Labour', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (8, 'CS0012', 'Chemical for Washing', 'Other', 'PCS', NULL, 0, 50.00, 100.00, 0, 0),
  (9, 'MS0041', 'Ciel Card Reparing', 'Other', 'PCS', NULL, 0, 0.00, 50.00, 0, 0),
  (10, 'CS0004', 'Delivery Challan Boook No : 00', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (11, 'MS0042', 'Display Cable Reparing', 'Other', 'PCS', NULL, 0, 0.00, 350.00, 0, 0),
  (12, 'SC0005', 'Distribution Card Reparing', 'Other', 'PCS', NULL, 0, 300.00, 300.00, 0, 0),
  (13, 'CS0010', 'Grees - Castrol - Spheerol - Cv Performance - 80K', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (14, 'CS0007', 'Hand Brush For Cleaning', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (15, 'MS0008', 'Iron Hook', 'Other', 'PCS', NULL, 0, 6.13, 9.00, 0, 0),
  (16, 'MS0022', 'Lower Cord - Size - 285mm', 'Other', 'PCS', NULL, 0, 5.59, 10.00, 74, 0),
  (17, 'MS0023', 'Lower Cord - Size - 320mm', 'Other', 'PCS', NULL, 0, 0.00, 10.00, 0, 0),
  (18, 'MS0024', 'Lower Cord - Size - 340mm', 'Other', 'PCS', NULL, 0, 0.00, 10.00, 0, 0),
  (19, 'MS0025', 'Lower Cord - Size - 360mm', 'Other', 'PCS', NULL, 0, 7.00, 11.00, 0, 0),
  (20, 'MS0026', 'Lower Cord - Size - 380mm', 'Other', 'PCS', NULL, 0, 0.00, 11.00, 0, 0),
  (21, 'MS0027', 'Lower Cord - Size - 400mm', 'Other', 'PCS', NULL, 0, 0.00, 11.00, 0, 0),
  (22, 'MS0001', 'Magnet', 'Other', 'PCS', NULL, 0, 0.00, 25.00, 200, 0),
  (23, 'MS0005', 'Magnet - BL', 'Other', 'PCS', NULL, 0, 0.00, 35.00, 0, 0),
  (24, 'MS0006', 'Magnet - CC - Red', 'Other', 'PCS', NULL, 0, 29.00, 35.00, 0, 0),
  (25, 'MS0002', 'Magnet - DT 1', 'Other', 'PCS', NULL, 0, 8.29, 35.00, 0, 0),
  (26, 'MS0003', 'Magnet - DT 2', 'Other', 'PCS', NULL, 0, 28.00, 35.00, 0, 0),
  (27, 'MS0007', 'Magnet S&S', 'Other', 'PCS', NULL, 0, 0.00, 35.00, 0, 0),
  (28, 'MS0004', 'Magnet - Sun', 'Other', 'PCS', NULL, 0, 0.00, 35.00, 0, 0),
  (29, 'MS0043', 'Module Body', 'Other', 'PCS', NULL, 0, 0.00, 50.00, 23, 0),
  (30, 'CS0008', 'Module Grease', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (31, 'MS0037', 'Module Patti - Middle', 'Other', 'PCS', NULL, 0, 0.00, 5.00, 147, 0),
  (32, 'SC0002', 'Module Service', 'Other', 'PCS', NULL, 0, 0.00, 50.00, 0, 0),
  (33, 'MS0036', 'Module Side - Female', 'Other', 'PCS', NULL, 0, 20.00, 20.00, 0, 0),
  (34, 'MS0035', 'Module Side - Male', 'Other', 'PCS', NULL, 0, 20.00, 20.00, 0, 0),
  (35, 'MS0038', 'Nut and Bolt', 'Other', 'PCS', NULL, 0, 12.00, 15.00, 39, 0),
  (36, 'MS0020', 'Only Pulley Cover For Bearing Pulley', 'Other', 'PCS', NULL, 0, 4.95, 10.00, 0, 0),
  (37, 'MS0021', 'Only Pulley Cover For Without Bearing Pulley', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (38, 'MS0019', 'Only Pulley For With Bearing', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (39, 'MS0018', 'Only Pulley For Without Bearing', 'Other', 'PCS', NULL, 0, 8.08, 15.00, 785, 0),
  (40, 'MS0029', 'Pulley Set With Bearing - Size - 285mm', 'Other', 'PCS', NULL, 0, 33.10, 40.00, 0, 0),
  (41, 'MS0030', 'Pulley Set With Bearing - Size - 320mm', 'Other', 'PCS', NULL, 0, 40.00, 40.00, 0, 0),
  (42, 'MS0031', 'Pulley Set With Bearing - Size - 340mm', 'Other', 'PCS', NULL, 0, 0.00, 40.00, 0, 0),
  (43, 'MS0032', 'Pulley Set With Bearing - Size - 360mm', 'Other', 'PCS', NULL, 0, 40.00, 45.00, 0, 0),
  (44, 'MS0033', 'Pulley Set With Bearing - Size - 380mm', 'Other', 'PCS', NULL, 0, 0.00, 45.00, 0, 0),
  (45, 'MS0034', 'Pulley Set With Bearing - Size - 400mm', 'Other', 'PCS', NULL, 0, 40.00, 45.00, 0, 0),
  (46, 'MS0028', 'Pulley Set Without Bearing', 'Other', 'PCS', NULL, 0, 21.00, 35.00, 0, 0),
  (47, 'SC0003', 'Reject Module', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (48, 'MS0045', 'Ribbon 9 Pin', 'Other', 'PCS', NULL, 0, 200.00, 220.00, 0, 0),
  (49, 'MS0044', 'SMPS 15v 23.2 Amr', 'Other', 'PCS', NULL, 0, 1650.00, 1900.00, 0, 0),
  (50, 'MS0010', 'Spring For Buterfly', 'Other', 'PCS', NULL, 0, 2.00, 2.00, 0, 0),
  (51, 'MS0009', 'Spring For Iron Hook', 'Other', 'PCS', NULL, 0, 0.50, 1.00, 0, 0),
  (52, 'AS0003', 'Sun Upper Cord + New Cover + Labour', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (53, 'CS0003', 'Thiner', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (54, 'MS0012', 'Upper Cord', 'Other', 'PCS', NULL, 0, 5.39, 10.00, 0, 0),
  (55, 'MS0017', 'Upper Cord - BL - Steel', 'Other', 'PCS', NULL, 0, 0.00, 15.00, 0, 0),
  (56, 'MS0014', 'Upper Cord - CC', 'Other', 'PCS', NULL, 0, 6.69, 10.00, 0, 0),
  (57, 'MS0015', 'Upper Cord - CC 2', 'Other', 'PCS', NULL, 0, 6.50, 10.00, 138, 0),
  (58, 'SC0001', 'Upper Cord + New Cover + Labour', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (59, 'MS0016', 'Upper Cord - Sun', 'Other', 'PCS', NULL, 0, 0.00, 10.00, 0, 0),
  (60, 'MS0013', 'Upper Cord - YGMS', 'Other', 'PCS', NULL, 0, 0.00, 10.00, 0, 0),
  (61, 'SC0004', 'Warranty Service', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (62, 'CS0011', 'WD 40', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (63, 'CS0005', 'White Marker', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (64, 'CS0006', 'Whitner', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0),
  (65, 'CS0009', 'Wrapping Roll', 'Other', 'PCS', NULL, 0, 0.00, 0.00, 0, 0);

commit;
