# Panduan agen untuk repo ini

Proyek: aplikasi kas cluster Bagarry (Cloudflare Workers + Hono + D1 + R2, halaman
dirender server). Bahasa percakapan dengan pemilik proyek: Indonesia.

Sebelum mengubah `src/`, jalankan `npm run typecheck` dan `npx vitest run`. Untuk alur
end-to-end jalankan `npm run test:e2e` (Playwright, mereset database dan menyalakan server
sendiri). `npm run smoke` dan `npm run click-through` juga tersedia dan membutuhkan
`npm run dev` yang sudah berjalan.

Perubahan pada antarmuka sebaiknya diverifikasi di peramban sungguhan, bukan hanya dari
kode: `npm run click-through` memeriksa tautan, fokus keyboard, kontras, dan breakpoint
mobile di Chromium headless.

<!-- antislop:start -->
## antislop

Paket antislop ada di repo ini, bukan di folder global. Untuk pekerjaan UI, teks, aksesibilitas, tata letak mobile, atau komentar kode, baca berkas inti `skills/antislop/SKILL.md`, lalu skill yang sesuai dengan tugas:

- UI / visual: `skills/antislop-ui/SKILL.md`
- Teks dan copywriting: `skills/antislop-copywriting/SKILL.md`
- Aksesibilitas dan manusia: `skills/antislop-human/SKILL.md` (butuh `skills/antislop-human/contrast-check.py`)
- Mobile / responsif: `skills/antislop-layoutmobile/SKILL.md`
- Komentar kode: `skills/antislop-code/SKILL.md`

Sebelum mulai, tanyakan ke pengguna kapan antislop dipakai: selama pengerjaan, atau setelah selesai.

Arah desain proyek ini tertulis di `README.md` bagian "Arah desain" dengan dial
ENERGY 1 / RHYTHM 1 / MOTION 1.

Hasil audit ada di `anti-slop/`, bernomor berurutan. Jangan mengubah apa pun dari daftar temuan sebelum nomor tertentu disetujui.
<!-- antislop:end -->
