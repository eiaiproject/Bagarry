-- Akun bendahara default.
-- Password awal: Bagarry#Admin  (must_change_password = 1, wajib diganti saat login pertama)
-- Ganti password akun ini segera setelah deploy pertama.
INSERT OR IGNORE INTO users (role, email, username, password_hash, must_change_password, is_active)
VALUES (
  'admin',
  'bendahara@bagarry.id',
  NULL,
  'pbkdf2$sha256$15000$3a8ggU1fTSPzw8pgdh0P0g==$Vq150iUmaGiF5AZOSO1mzVY+/n6ix7zGB8rWm6NuavU=',
  1,
  1
);
