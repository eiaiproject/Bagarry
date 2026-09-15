-- Akun warga untuk data contoh di atas. Hanya untuk development lokal.
-- Username = house_code, password default = "Bagarry" + blok, wajib diganti saat login pertama.
INSERT OR IGNORE INTO users (role, house_id, username, password_hash, must_change_password, is_active)
SELECT 'resident', id, house_code,
  CASE house_code
    WHEN 'Lupine-C4/06' THEN 'pbkdf2$sha256$15000$alCA1jGj/IRFtdiNtygLlg==$2ga+5FHrOMvuebdzLc5G/EnorOdGfE/4Zks0Rmo5Vb8='
    WHEN 'Lupine-C4/07' THEN 'pbkdf2$sha256$15000$YrgBocfKUJ9XkwK6f350SA==$IhhXZpH9Gjm7WGzBtKeFGZyPVDTt+7GQBqY/S8BKikw='
    WHEN 'Lupine-C4/08' THEN 'pbkdf2$sha256$15000$zfFam6qJWBdKrAmrQ6kMtA==$sYpfTjrDoHcqC6EtiCA0zNkPf1EbEyF1TQdoydgzSG8='
    WHEN 'Lupine-C4/09' THEN 'pbkdf2$sha256$15000$46xXsuLtuJS1s6JNBUkTJw==$hSY/i0n1RPnMqaxX3EKhaYJ+jFum/R+1lBiHHLlVAmg='
    WHEN 'Lupine-C4/10' THEN 'pbkdf2$sha256$15000$K4/1J2UoCqymWSwtsGVFaQ==$xTkaDyyyfRMP3xIIYq4O4MTwjTdFjZyT7fyNmsBJBxQ='
    WHEN 'Lupine-C4/11' THEN 'pbkdf2$sha256$15000$dYFJlYX9dBLI0ASM2TotMg==$8BItFz5pM3rxzUmHoB5jwDK2qTqYmzENr1hMvfCTuUc='
    WHEN 'Lupine-C4/12' THEN 'pbkdf2$sha256$15000$TbmAV3HYmT/1W7Nw86QNMw==$oBkFisWn1UxKKdSOByaBbcB6sxaaIIAkmgWjDvvNRno='
  END,
  1, 1
FROM houses
WHERE house_code IN ('Lupine-C4/06','Lupine-C4/07','Lupine-C4/08','Lupine-C4/09','Lupine-C4/10','Lupine-C4/11','Lupine-C4/12')
  AND house_code NOT IN (SELECT COALESCE(username, '') FROM users);
