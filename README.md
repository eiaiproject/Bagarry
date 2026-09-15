# Kas Amartha Cluster Bagarry

Aplikasi papan pengumuman dan pengelolaan kas cluster, dibangun dari dokumen
[`bagarry.html`](bagarry.html) (PRD, skema database, dan wireframe versi 1.0).

Isi aplikasi:

- **Papan pengumuman publik**: saldo kas, pemasukan dan pengeluaran bulan berjalan, rekap status, dan daftar status iuran per rumah tanpa nama pemilik.
- **Akun warga**: status rumah sendiri, daftar bulan yang belum dibayar, pilih bulan (boleh rapel), unggah bukti transfer, riwayat dan status verifikasi, ganti password.
- **Dashboard bendahara**: verifikasi dan penolakan bukti transfer, kelola rumah, import CSV, catat pengeluaran, laporan bulanan, audit log, pengaturan iuran.

## Teknologi

| Bagian | Pilihan |
| --- | --- |
| Runtime | Cloudflare Workers (Hono 4) |
| Database | Cloudflare D1 (SQLite) |
| Penyimpanan bukti | Cloudflare R2 |
| Tampilan | HTML dirender server dengan CSS yang ditulis tangan di `src/lib/layout.ts`, tanpa proses build dan tanpa framework CSS |
| Ikon | [Reicon](https://reicon.dev) (MIT) lewat paket npm `reicon`, dirender sebagai SVG inline |
| Validasi | Zod (endpoint JSON) dan validasi manual pada form |
| Hash password | PBKDF2-SHA256 lewat Web Crypto |
| Test | Vitest (logika domain), `scripts/smoke.sh` (alur HTTP), `scripts/click-through.mjs` (klik nyata di Chromium headless), dan Playwright (`e2e/`, CRUD lewat antarmuka) |

Halaman memakai form HTML biasa yang dikirim ke Worker. Daftar endpoint JSON di
lampiran 25.1 PRD tersedia juga di `/api/*` dengan service layer yang sama.

## Menjalankan di lokal

```bash
npm install
cp .dev.vars.example .dev.vars          # isi SESSION_SECRET
npm run db:migrate:local                # buat skema + akun bendahara default
npm run db:seed:local                   # opsional: 7 rumah contoh + akun warganya
npm run dev                             # http://localhost:8787
```

Akun bawaan:

| Peran | Login | Password awal |
| --- | --- | --- |
| Bendahara | `bendahara@bagarry.id` | `Bagarry#Admin` |
| Warga contoh | kode rumah, mis. `Lupine-C4/06` | `Bagarry` + blok, mis. `BagarryC4/06` |

Semua akun dibuat dengan `must_change_password = 1`, jadi login pertama langsung
diarahkan ke halaman ganti password. Ganti password bendahara segera setelah deploy.

## Deploy ke Cloudflare

```bash
npx wrangler d1 create bagarry-db           # salin database_id ke wrangler.jsonc
npx wrangler r2 bucket create bagarry-files
npx wrangler secret put SESSION_SECRET      # isi string acak minimal 32 karakter
npm run db:migrate:remote
npx wrangler deploy
```

Setelah deploy, atur **nominal iuran**, **saldo awal**, dan **bulan awal tagihan global**
di menu Pengaturan sebelum mengimpor rumah. Data rumah (±100 unit) diimpor lewat
menu Kelola Rumah, tombol Import CSV, dengan format:

```
jenis_rumah,blok,status_huni,aktif,nama_pemilik
Lupine,C4/06,berpenghuni,1,Budi
Lupine,C4/08,tanah_kosong,0,
```

Baris header opsional. Status huni: `berpenghuni`, `kosong`, `tanah_kosong`, `belum_dihuni`.
Kolom aktif menerima `1/0`, `ya/tidak`, atau kosong (dianggap aktif). Setiap rumah baru
otomatis mendapat akun warga dengan username sama dengan kode rumah.

## Aturan yang dipakai sistem

- **Bulan** berformat `YYYY-MM`, zona waktu `Asia/Jakarta`, nominal berupa integer rupiah.
- **Status pembayaran**: menunggu verifikasi bila ada pengajuan pending; lunas bila pembayaran
  sudah mencakup bulan berjalan; sudah bayar bila ada pembayaran tetapi belum sampai bulan
  berjalan; belum bayar bila tidak ada pembayaran sama sekali. Rumah nonaktif tidak dihitung.
- **Saldo** = saldo awal + pemasukan terverifikasi - pengeluaran. Pengajuan pending dan yang
  ditolak tidak menambah saldo.
- **Pemilihan bulan** wajib berurutan mulai tunggakan terlama, boleh rapel. Satu bulan tidak
  bisa diajukan dua kali selama statusnya masih pending atau sudah dibayar (dijaga unique index).
- **Verifikasi** menandai item bulan menjadi dibayar, menghitung ulang `paid_until`, mencatat
  pemasukan di ledger, dan menulis audit log dalam satu transaksi.
- **Penolakan** mengembalikan bulan menjadi belum dibayar beserta alasan, dan warga bisa
  mengunggah ulang.
- **Bukti transfer** hanya bisa dibuka bendahara dan akun rumah pengunggah. Bukti pengeluaran
  hanya untuk bendahara. File disimpan di R2 dan diakses lewat `/api/files/:id` yang memeriksa
  peran dan kepemilikan.
- **Password** minimal 8 karakter dan tidak boleh sama dengan password default.

## Test

```bash
npm test              # 22 unit test logika domain
npm run typecheck     # TypeScript strict
npm run smoke         # 97 pemeriksaan alur HTTP (butuh `npm run dev` berjalan)
npm run click-through # 141 pemeriksaan di peramban (butuh `npm run dev` berjalan)
npm run test:e2e      # 12 tes CRUD lewat antarmuka (reset database + jalankan server sendiri)
```

`scripts/smoke.sh` berjalan di atas database apa pun: ia membuat rumah dan akunnya
sendiri, membaca nilai awal, lalu membandingkan selisih, sehingga data contoh yang sudah
ada tidak membuat pemeriksaan gagal. Akun bendahara `bendahara@bagarry.id` harus masih
memakai password default `Bagarry#Admin`, jadi jalankan `npm run db:reset:local` lebih
dulu bila passwordnya sudah pernah diganti.

Isi pemeriksaannya: papan publik, login dan ganti password wajib, rate limit login,
pengaturan, kelola rumah, import CSV, validasi unggahan, unggah bukti, verifikasi,
penolakan, pengeluaran, laporan, batas akses antar rumah, isi audit log, dan render
seluruh halaman.

`scripts/click-through.mjs` adalah pemeriksaan di peramban sungguhan. Ia menjalankan
Chromium headless (Brave, Edge, Chrome, atau Chromium yang terpasang) lalu mengendalikannya
lewat Chrome DevTools Protocol memakai WebSocket bawaan Node, tanpa pustaka tambahan. Yang
dilakukannya: mengetik dan mengirim form login sungguhan, mengganti password wajib,
mengklik setiap tautan di setiap halaman satu per satu, mencatat galat konsol, mengukur
luber horizontal dan sasaran sentuh pada lebar 360 px dan 1280 px, menekan Tab untuk
memeriksa cincin fokus, dan menghitung kontras teks dari gaya terhitung.

Peramban bisa ditunjuk lewat variabel `BROWSER_BIN` bila tidak ada di lokasi bawaan.
Keduanya mengubah data lokal (mengganti password default), jadi jalankan
`npm run db:reset:local` dan `npm run db:seed:local` sebelum menjalankannya lagi.

`npm run test:e2e` menjalankan Playwright di `e2e/crud.spec.ts`: 12 tes berurutan yang
melakukan alur CRUD lengkap lewat antarmuka asli, lalu memeriksa ulang hasilnya lewat
endpoint JSON. Cakupannya: login dan ganti password wajib, pengaturan (baca, perbarui
lewat form dan PATCH), rumah (buat, baca, perbarui, nonaktifkan, import CSV), pengajuan
pembayaran warga (unggah bukti, verifikasi, penolakan), pengeluaran, laporan bulanan,
hak akses berkas antar peran, audit log, dan papan publik.

Skrip ini mereset dan mengisi database lokalnya sendiri, lalu menyalakan `wrangler dev`
lewat `webServer` Playwright, jadi tidak perlu menyiapkan apa pun lebih dulu. Playwright
dipasang tanpa mengunduh peramban: ia memakai Brave, Edge, atau Chrome yang sudah ada di
mesin. Set `PW_BROWSER_PATH` untuk menunjuk biner lain, atau jalankan
`npx playwright install chromium` bila tidak ada peramban Chromium sama sekali.

## Catatan implementasi

- **Tabel tambahan di luar DDL PRD**: `houses.owner_name` (karena matriks hak akses 22.2
  menyebut nama pemilik hanya untuk bendahara) dan `login_attempts` (untuk rate limit login).
- **Timestamp disimpan dalam WIB** (`strftime('%Y-%m-%d %H:%M:%S','now','+7 hours')`), bukan UTC,
  supaya laporan bulanan, tanggal verifikasi, dan audit log konsisten dengan zona waktu warga.
- **Iterasi PBKDF2 default 15.000** karena Workers membatasi maksimum 100.000 iterasi dan plan
  Free hanya memberi 10 ms CPU per request. Plan berbayar bisa menaikkan lewat var
  `PBKDF2_ITERATIONS` di `wrangler.jsonc`; hash lama tetap bisa diverifikasi karena jumlah
  iterasi tersimpan di dalam hash.
- **Bulan awal tagihan global sengaja dikosongkan** saat instalasi baru. Selama belum diatur,
  sistem memakai bulan berjalan dan bendahara melihat peringatan di Pengaturan, sehingga tidak
  ada tagihan mundur yang salah.
- **Belum dikerjakan** (sesuai bagian 3.2 PRD yang di luar scope): notifikasi WhatsApp/email,
  grafik, export PDF/Excel/CSV, PWA, multi-role pengurus, iuran khusus, dan denda.

## Arah desain

Reading this as: papan informasi keuangan lingkungan untuk warga dan bendahara, gaya
utilitarian ala layanan publik, dial **ENERGY 1 / RHYTHM 1 / MOTION 1**.

Alasan tiap keputusan:

- **Warna**: teal `#0f766e` sebagai warna aksi utama dan abu-abu slate sebagai netral, keduanya
  diambil dari bahasa visual dokumen PRD. Empat warna status (hijau, biru, kuning, merah) hanya
  muncul di badge status, karena status pembayaran adalah informasi yang harus terbaca sekali lihat.
- **Tipografi**: font sistem tanpa unduhan webfont, karena mayoritas warga membuka aplikasi dari
  HP dengan koneksi seadanya.
- **Bentuk**: permukaan datar dengan garis tipis, tanpa gradien, glow, atau bayangan, supaya angka
  rupiah dan tabel status menjadi fokus. Radius dipakai konsisten (8 px kontrol, 10 px kartu).
- **Fokus tiap layar**: satu kartu saldo kas berwarna penuh di papan publik dan dashboard bendahara.
- **Gerakan**: hanya keadaan hover dan focus-visible (MOTION 1), tanpa animasi masuk.
- **Tema**: satu tema terang, tanpa sakelar gelap. Papan ini dibaca warga di depan papan
  pengumuman dan dari HP pada siang hari, sering kali di luar ruangan, dan kadang dicetak
  bendahara. Latar terang dengan teks gelap memberi kontras terbaik di kondisi itu, dan
  satu tema berarti tidak ada mode kedua yang bisa rusak atau perlu dirawat. Kalau nanti
  warga meminta mode gelap, tema gelap bisa ditambahkan lewat variabel CSS di
  `src/lib/layout.ts`.
- **Umpan balik pengiriman**: karena halaman berpindah lewat muat ulang penuh, tidak ada
  state "memuat" di klien. Satu-satunya jeda yang tidak terlihat adalah saat form dikirim
  ke server, jadi tombol submit dikunci dan labelnya berubah menjadi "Mengirim..." supaya
  pengajuan tidak terkirim dua kali di koneksi lambat.
- **Ukuran kontrol sentuh**: tombol tabel 38 px di desktop karena mouse presisi, naik ke
  44 px di layar sempit untuk jempol. Kolom ketik memakai font 16 px supaya iOS Safari
  tidak melakukan auto-zoom saat fokus.
- **Navigasi**: menu horizontal yang bisa digeser di layar kecil, tanpa menu tersembunyi, dan setiap
  item mengarah ke halaman yang benar-benar ada.
- **Ikon**: hanya dipasang pada navigasi dan tombol aksi karena fungsinya membantu mengenali aksi
  lebih cepat, bukan menghias. Badge status, judul, dan keadaan kosong tetap berupa teks karena
  warna dan kalimatnya sudah membawa seluruh informasi.

## Ikon

Ikon berasal dari [Reicon](https://reicon.dev), pustaka SVG open-source berlisensi MIT, dipasang
lewat paket npm resmi `reicon` dan dirender sebagai SVG inline (`toSvg()`) karena halaman dibuat di
Worker, bukan di browser. Tidak ada permintaan jaringan tambahan dan ikon otomatis mengikuti warna
teks di sekitarnya lewat `currentColor`.

Semua pemetaan ada di `src/lib/icons.ts` memakai nama semantik (`upload`, `approve`, `pending`),
bukan nama vendor, supaya penggantian ikon cukup di satu tempat. Yang dipakai:

| Bagian | Ikon |
| --- | --- |
| Merek di header | MoneyStack |
| Menu dashboard, kelola rumah, pembayaran, pengeluaran, laporan, pengaturan, audit log, ganti password, menunggu verifikasi, riwayat, bayar iuran | ChartSquare, House, MoneyBills, Receipt, ChartBar, Gear, ClipboardList, LockKeyhole, Clock, BillList, Wallet |
| Masuk dan keluar | Login, Logout |
| Unggah dan kirim bukti | CloudUpload, FileSend |
| Setujui dan tolak | CheckCircle, CloseCircle |
| Periksa, lihat bukti, kelola, tambah, impor, simpan, kembali, tampilkan | ClipboardCheck, Eye, Edit, Plus, ClipboardImport, Floppy, ArrowLeft, Search |
| Peringatan dan keterangan | Warning, InfoCircle |

Catatan paket: `npm install` menarik sekitar 50 MB berkas ikon (2.676 ikon dalam dua bobot). Hanya
ikon yang diimpor di `src/lib/icons.ts` yang ikut ke bundel Worker.

## Struktur proyek

```
migrations/          skema dan data awal D1
seed/                data contoh untuk development lokal
scripts/             generator hash password, smoke test
src/
  index.ts           entry Worker, pemasangan middleware dan rute
  middleware.ts      pemuatan sesi, pemeriksaan origin, pembatas peran
  lib/               date, money, password, settings, houses, payments, expenses,
                     ledger, files, audit, csv, html, layout
  routes/            public (papan, login, password), warga, admin, api
test/                unit test logika domain
```
