-- Data contoh untuk development lokal.
-- JANGAN dipakai di production. Import rumah sebenarnya lewat /admin/houses (Import CSV).
INSERT OR IGNORE INTO houses (house_type, block, house_code, occupancy_status, is_active, notes) VALUES
  ('Lupine', 'C4/06', 'Lupine-C4/06', 'berpenghuni', 1, 'Data contoh'),
  ('Lupine', 'C4/07', 'Lupine-C4/07', 'berpenghuni', 1, 'Data contoh'),
  ('Lupine', 'C4/08', 'Lupine-C4/08', 'kosong',        1, 'Data contoh'),
  ('Lupine', 'C4/09', 'Lupine-C4/09', 'belum_dihuni',  1, 'Data contoh'),
  ('Lupine', 'C4/10', 'Lupine-C4/10', 'berpenghuni',   1, 'Data contoh'),
  ('Lupine', 'C4/11', 'Lupine-C4/11', 'berpenghuni',   1, 'Data contoh'),
  ('Lupine', 'C4/12', 'Lupine-C4/12', 'tanah_kosong',  0, 'Data contoh');
