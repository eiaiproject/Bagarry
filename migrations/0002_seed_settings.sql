-- Nilai default pengaturan.
-- global_billing_start_month sengaja dikosongkan: bendahara wajib mengisinya di /admin/settings
-- agar sistem tidak menagih bulan yang salah pada instalasi baru.
INSERT OR IGNORE INTO settings (key, value) VALUES
  ('monthly_fee', '50000'),
  ('opening_balance', '0'),
  ('opening_balance_date', ''),
  ('global_billing_start_month', '');
