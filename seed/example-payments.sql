-- Data contoh aktivitas kas untuk development lokal (JANGAN dipakai di production).
-- Bulan dihitung relatif bulan berjalan WIB: M1 = 2 bulan lalu, M2 = 1 bulan lalu, M3 = bulan ini.
-- Aman diulang: setiap insert dijaga kondisi NOT EXISTS.

UPDATE settings SET value = '50000' WHERE key = 'monthly_fee';
UPDATE settings SET value = '2000000' WHERE key = 'opening_balance';
UPDATE settings SET value = strftime('%Y-%m-01', 'now', '+7 hours', '-2 months') WHERE key = 'opening_balance_date';
UPDATE settings SET value = strftime('%Y-%m', 'now', '+7 hours', '-2 months') WHERE key = 'global_billing_start_month';

-- 1. Lupine-C4/06 sudah lunas sampai bulan berjalan.
INSERT INTO payments (house_id, created_by, period_start, period_end, months_count, amount, status, note, verified_by, verified_at, created_at, updated_at)
SELECT h.id, a.id,
       strftime('%Y-%m', 'now', '+7 hours', '-2 months'),
       strftime('%Y-%m', 'now', '+7 hours'),
       3, 150000, 'verified', 'Contoh data development', a.id,
       datetime('now', '+7 hours', '-20 days'), datetime('now', '+7 hours', '-21 days'), datetime('now', '+7 hours', '-20 days')
FROM houses h, users a
WHERE h.house_code = 'Lupine-C4/06' AND a.role = 'admin'
  AND NOT EXISTS (SELECT 1 FROM payments WHERE house_id = h.id);

INSERT INTO payment_items (payment_id, house_id, period_month, status)
SELECT p.id, p.house_id, m.month, 'paid'
FROM payments p
JOIN (
  SELECT strftime('%Y-%m', 'now', '+7 hours', '-2 months') AS month
  UNION ALL SELECT strftime('%Y-%m', 'now', '+7 hours', '-1 months')
  UNION ALL SELECT strftime('%Y-%m', 'now', '+7 hours')
) m
WHERE p.house_id = (SELECT id FROM houses WHERE house_code = 'Lupine-C4/06')
  AND p.note = 'Contoh data development';

-- 2. Lupine-C4/10 baru membayar satu bulan.
INSERT INTO payments (house_id, created_by, period_start, period_end, months_count, amount, status, note, verified_by, verified_at, created_at, updated_at)
SELECT h.id, a.id,
       strftime('%Y-%m', 'now', '+7 hours', '-2 months'),
       strftime('%Y-%m', 'now', '+7 hours', '-2 months'),
       1, 50000, 'verified', 'Contoh data development', a.id,
       datetime('now', '+7 hours', '-3 days'), datetime('now', '+7 hours', '-4 days'), datetime('now', '+7 hours', '-3 days')
FROM houses h, users a
WHERE h.house_code = 'Lupine-C4/10' AND a.role = 'admin'
  AND NOT EXISTS (SELECT 1 FROM payments WHERE house_id = h.id);

INSERT INTO payment_items (payment_id, house_id, period_month, status)
SELECT p.id, p.house_id, strftime('%Y-%m', 'now', '+7 hours', '-2 months'), 'paid'
FROM payments p
WHERE p.house_id = (SELECT id FROM houses WHERE house_code = 'Lupine-C4/10')
  AND p.note = 'Contoh data development';

-- 3. Lupine-C4/11 mengajukan bukti dan masih menunggu verifikasi.
INSERT INTO payments (house_id, created_by, period_start, period_end, months_count, amount, status, note, created_at, updated_at)
SELECT h.id, u.id,
       strftime('%Y-%m', 'now', '+7 hours', '-2 months'),
       strftime('%Y-%m', 'now', '+7 hours', '-2 months'),
       1, 50000, 'pending', 'Transfer dari BCA', datetime('now', '+7 hours', '-1 days'), datetime('now', '+7 hours', '-1 days')
FROM houses h
JOIN users u ON u.house_id = h.id
WHERE h.house_code = 'Lupine-C4/11'
  AND NOT EXISTS (SELECT 1 FROM payments WHERE house_id = h.id);

INSERT INTO payment_items (payment_id, house_id, period_month, status)
SELECT p.id, p.house_id, strftime('%Y-%m', 'now', '+7 hours', '-2 months'), 'pending'
FROM payments p
WHERE p.house_id = (SELECT id FROM houses WHERE house_code = 'Lupine-C4/11')
  AND p.note = 'Transfer dari BCA';

-- 4. paid_until mengikuti pembayaran terverifikasi yang berurutan.
UPDATE houses SET paid_until = strftime('%Y-%m', 'now', '+7 hours')
WHERE house_code = 'Lupine-C4/06';
UPDATE houses SET paid_until = strftime('%Y-%m', 'now', '+7 hours', '-2 months')
WHERE house_code = 'Lupine-C4/10';

-- 5. Pemasukan masuk ledger supaya saldo kas konsisten.
INSERT INTO ledger_entries (entry_date, entry_type, amount, description, house_id, payment_id, created_by)
SELECT date(p.verified_at), 'income', p.amount, 'Iuran contoh - ' || h.block, p.house_id, p.id, p.verified_by
FROM payments p
JOIN houses h ON h.id = p.house_id
WHERE p.note = 'Contoh data development'
  AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE payment_id = p.id);

-- 6. Satu pengeluaran pada bulan berjalan.
INSERT INTO expenses (expense_date, description, amount, created_by, created_at, updated_at)
SELECT date('now', '+7 hours', 'start of month', '+9 days'), 'Perbaikan lampu jalan blok C', 350000, a.id,
       datetime('now', '+7 hours'), datetime('now', '+7 hours')
FROM users a
WHERE a.role = 'admin'
  AND NOT EXISTS (SELECT 1 FROM expenses);

INSERT INTO ledger_entries (entry_date, entry_type, amount, description, expense_id, created_by)
SELECT e.expense_date, 'expense', e.amount, e.description, e.id, e.created_by
FROM expenses e
WHERE e.description = 'Perbaikan lampu jalan blok C'
  AND NOT EXISTS (SELECT 1 FROM ledger_entries WHERE expense_id = e.id);
