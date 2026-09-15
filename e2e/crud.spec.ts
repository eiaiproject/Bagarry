// E2E CRUD lengkap dengan Playwright di atas data lokal yang direset lebih dulu
// (lihat `npm run test:e2e`). Setiap operasi ditulis dan dibaca lewat antarmuka asli,
// lalu diverifikasi ulang lewat endpoint JSON supaya hasilnya tidak hanya terlihat benar.
//
// Tes berjalan berurutan karena memakai satu database yang sama.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 8787);
const BASE = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

const ADMIN = { identifier: 'bendahara@bagarry.id', password: 'Bagarry#Admin', baru: 'BagarryAdmin2026' };
const WARGA = { identifier: 'Lupine-C4/06', password: 'BagarryC4/06', baru: 'WargaC606baru' };
const WARGA_LAIN = { identifier: 'Lupine-C4/07', password: 'BagarryC4/07', baru: 'WargaC607baru' };

const FIXTURE_DIR = join('test-results', 'e2e-fixtures');
const BUKTI_PNG = join(FIXTURE_DIR, 'bukti.png');
const BUKTI_TXT = join(FIXTURE_DIR, 'salah.txt');

function jakartaMonth(offset = 0): string {
  const now = new Date();
  const [year, month] = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
  })
    .format(now)
    .split('-')
    .map(Number);
  return new Date(Date.UTC(year!, month! - 1 + offset, 1)).toISOString().slice(0, 7);
}

const START = jakartaMonth(-2);
const M2 = jakartaMonth(-1);
const M3 = jakartaMonth(0);

let rumahId = 0;
let pengajuanId = 0;
let pengeluaranId = 0;
let buktiFileId: number | null = null;

/** Masuk lewat HTTP dan simpan cookie di context, supaya tes bisa langsung fokus ke UI. */
async function login(context: BrowserContext, identifier: string, password: string): Promise<void> {
  const res = await context.request.post(`${BASE}/login`, {
    form: { identifier, password },
    maxRedirects: 0,
  });
  expect(res.status(), `login ${identifier}`).toBe(303);
}

async function loginAdmin(context: BrowserContext): Promise<void> {
  await login(context, ADMIN.identifier, ADMIN.baru);
}

/** Isi dan kirim form, lalu tunggu perpindahan halaman. */
async function submitForm(page: Page, buttonText: string): Promise<void> {
  await page.getByRole('button', { name: buttonText }).click();
}

async function expectFlash(page: Page, text: string): Promise<void> {
  await expect(page.locator('.flash')).toContainText(text);
}

async function saldoKas(page: Page): Promise<number> {
  const res = await page.request.get(`${BASE}/api/public/summary`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()).balance as number;
}

test.beforeAll(() => {
  // Bukti transfer disiapkan saat berjalan supaya tidak ada berkas biner di repo.
  mkdirSync(FIXTURE_DIR, { recursive: true });
  writeFileSync(
    BUKTI_PNG,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  writeFileSync(BUKTI_TXT, 'bukan gambar');
});

test.describe.serial('E2E CRUD Bagarry', () => {
  test('01 auth: login bendahara dan ganti password wajib', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Masuk' })).toBeVisible();

    await page.fill('#identifier', ADMIN.identifier);
    await page.fill('#password', ADMIN.password);
    await submitForm(page, 'Masuk');
    await expect(page).toHaveURL(/\/ganti-password/);

    await page.fill('#current', ADMIN.password);
    await page.fill('#next', ADMIN.baru);
    await page.fill('#confirm', ADMIN.baru);
    await submitForm(page, 'Simpan password');
    await expect(page).toHaveURL(/\/admin\?ok=/);
    await expect(page.getByRole('heading', { name: 'Dashboard bendahara' })).toBeVisible();

    // Password lama tidak berlaku lagi.
    const res = await page.request.post(`${BASE}/login`, {
      form: { identifier: ADMIN.identifier, password: ADMIN.password },
      maxRedirects: 0,
    });
    expect([302, 303]).toContain(res.status());
    expect(res.headers()['location']).toContain('/login?err=');
  });

  test('02 pengaturan: baca dan perbarui', async ({ page, context }) => {
    await loginAdmin(context);
    await page.goto('/admin/settings');

    await expect(page.locator('#monthlyFee')).toHaveValue('50000');
    await expect(page.locator('#openingBalance')).toHaveValue('0');

    await page.fill('#monthlyFee', '50000');
    await page.fill('#openingBalance', '1000000');
    await page.fill('#openingBalanceDate', `${START}-01`);
    await page.fill('#globalBillingStartMonth', START);
    await submitForm(page, 'Simpan pengaturan');
    await expect(page).toHaveURL(/\/admin\/settings\?ok=/);
    await expectFlash(page, 'Pengaturan tersimpan');

    const res = await page.request.get(`${BASE}/api/admin/settings`);
    const body = await res.json();
    expect(body.settings.monthlyFee).toBe(50000);
    expect(body.settings.openingBalance).toBe(1000000);
    expect(body.settings.globalBillingStartMonth).toBe(START);

    // Perbarui lewat endpoint PATCH, lalu baca ulang.
    const patched = await page.request.patch(`${BASE}/api/admin/settings`, { data: { monthlyFee: 60000 } });
    expect(patched.ok()).toBeTruthy();
    const after = await page.request.get(`${BASE}/api/admin/settings`);
    expect((await after.json()).settings.monthlyFee).toBe(60000);

    // Kembalikan ke 50.000 agar angka tes berikutnya bulat.
    const balik = await page.request.patch(`${BASE}/api/admin/settings`, { data: { monthlyFee: 50000 } });
    expect(balik.ok()).toBeTruthy();
  });

  test('03 rumah: buat, baca, perbarui, nonaktifkan', async ({ page, context }) => {
    await loginAdmin(context);
    await page.goto('/admin/houses/new');

    await page.fill('#houseType', 'E2E');
    await page.fill('#block', 'C9/01');
    await page.selectOption('#occupancyStatus', 'berpenghuni');
    await page.fill('#ownerName', 'Pemilik Uji');
    await page.fill('#notes', 'dibuat oleh tes e2e');
    await submitForm(page, 'Simpan rumah');

    await expect(page.getByRole('heading', { name: 'Rumah E2E-C9/01 tersimpan' })).toBeVisible();
    await expect(page.locator('.card.pad')).toContainText('BagarryC9/01');

    // Baca lewat daftar dan endpoint JSON.
    await page.goto('/admin/houses');
    const baris = page.locator('tr', { hasText: 'E2E-C9/01' });
    await expect(baris).toContainText('Pemilik Uji');
    await expect(baris).toContainText('Ya');

    const list = await page.request.get(`${BASE}/api/admin/houses`);
    const rumah = (await list.json()).houses.find((h: { block: string }) => h.block === 'C9/01');
    expect(rumah).toBeTruthy();
    rumahId = rumah.id;

    // Perbarui lewat form.
    await page.goto(`/admin/houses/${rumahId}`);
    await page.fill('#ownerName', 'Pemilik Uji Diubah');
    await page.uncheck('input[name="isActive"]');
    await submitForm(page, 'Simpan perubahan');
    await expectFlash(page, 'Data rumah diperbarui');

    await page.goto(`/admin/houses/${rumahId}`);
    await expect(page.getByRole('heading', { name: 'E2E-C9/01' })).toBeVisible();
    await expect(page.locator('.page-sub')).toContainText('tidak dihitung wajib iuran');
    await expect(page.locator('#ownerName')).toHaveValue('Pemilik Uji Diubah');

    const patched = await page.request.patch(`${BASE}/api/admin/houses/${rumahId}`, {
      data: { occupancyStatus: 'berpenghuni', ownerName: 'Pemilik Uji Lewat API', isActive: true },
    });
    expect(patched.ok()).toBeTruthy();
    const listAfter = await page.request.get(`${BASE}/api/admin/houses`);
    const sesudah = (await listAfter.json()).houses.find((h: { id: number }) => h.id === rumahId);
    expect(sesudah.ownerName).toBe('Pemilik Uji Lewat API');
    expect(sesudah.isActive).toBe(true);
  });

  test('04 rumah: import CSV massal', async ({ page, context }) => {
    await loginAdmin(context);
    await page.goto('/admin/houses/import');

    await page.fill('#csv', 'jenis_rumah,blok,status_huni,aktif,nama_pemilik\nE2E,C9/02,kosong,1,Warga Dua\nE2E,C9/03,tanah_kosong,0,');
    await submitForm(page, 'Periksa data');
    await expect(page).toHaveURL(/\/admin\/houses\/import/);
    await expect(page.getByRole('heading', { name: 'Pratinjau import' })).toBeVisible();
    await expect(page.locator('.page-sub')).toContainText('2 rumah siap dibuat, 0 baris bermasalah');

    await submitForm(page, 'Buat 2 rumah sekarang');
    await expect(page.getByRole('heading', { name: 'Hasil import' })).toBeVisible();
    await expect(page.locator('.page-sub')).toContainText('2 rumah dibuat, 0 gagal');
    await expect(page.locator('table')).toContainText('E2E-C9/02');
    await expect(page.locator('table')).toContainText('E2E-C9/03');

    await page.goto('/admin/houses');
    await expect(page.locator('tr', { hasText: 'E2E-C9/02' })).toContainText('Ya');
    await expect(page.locator('tr', { hasText: 'E2E-C9/03' })).toContainText('Tidak');
  });

  test('05 warga: login, ganti password, unggah bukti dua bulan', async ({ page, context }) => {
    await login(context, WARGA.identifier, WARGA.password);
    await page.goto('/ganti-password');
    await page.fill('#current', WARGA.password);
    await page.fill('#next', WARGA.baru);
    await page.fill('#confirm', WARGA.baru);
    await submitForm(page, 'Simpan password');
    await expect(page).toHaveURL(new RegExp(`/warga\\?ok=`));

    await page.goto('/warga/pembayaran');
    await expect(page.locator('input[name="months"]')).toHaveCount(3);

    // Bulan pertama tercentang otomatis, total mengikuti pilihan.
    await expect(page.locator('input[name="months"]').first()).toBeChecked();
    await expect(page.locator('#total-amount')).toContainText('50.000');
    await page.check(`input[name="months"][value="${M2}"]`);
    await expect(page.locator('#month-count')).toHaveText('2');
    await expect(page.locator('#total-amount')).toContainText('100.000');

    // Format selain JPG/PNG/PDF ditolak dan tidak membuat pengajuan.
    await page.setInputFiles('#proof', BUKTI_TXT);
    await submitForm(page, 'Kirim bukti');
    await expect(page).toHaveURL(/\/warga\/pembayaran\?err=/);
    await expectFlash(page, 'Format file harus JPG, PNG, atau PDF');

    await page.setInputFiles('#proof', BUKTI_PNG);
    await page.fill('#note', 'transfer dari BCA');
    await page.check(`input[name="months"][value="${M2}"]`);
    await submitForm(page, 'Kirim bukti');
    await expect(page).toHaveURL(/\/warga\/riwayat\?id=\d+/);
    await expectFlash(page, 'Bukti terkirim. Menunggu verifikasi bendahara.');
    pengajuanId = Number(new URL(page.url()).searchParams.get('id'));
    expect(pengajuanId).toBeGreaterThan(0);

    const daftar = await page.request.get(`${BASE}/api/warga/payments`);
    const pengajuan = (await daftar.json()).payments.find((p: { id: number }) => p.id === pengajuanId);
    expect(pengajuan.status).toBe('pending');
    expect(pengajuan.months.length).toBe(2);
    expect(pengajuan.amount).toBe(100000);

    // Selama masih pending, saldo kas tidak berubah.
    await page.goto('/');
    expect(await saldoKas(page)).toBe(1000000);
  });

  test('06 bendahara: verifikasi pengajuan menambah saldo', async ({ page, context }) => {
    await loginAdmin(context);
    await page.goto('/admin/payments/pending');

    const baris = page.locator('tr', { hasText: 'C4/06' }).first();
    await expect(baris).toContainText('transfer dari BCA');
    await expect(baris).toContainText('100.000');
    await baris.getByRole('link', { name: 'Periksa' }).click();
    await expect(page.getByRole('heading', { name: `Verifikasi pembayaran #${pengajuanId}` })).toBeVisible();

    // Bukti bisa dibuka bendahara.
    const bukti = page.getByRole('link', { name: /Lihat bukti transfer/ });
    await expect(bukti).toBeVisible();
    const href = (await bukti.getAttribute('href')) ?? '';
    buktiFileId = Number(href.split('/').pop());
    const berkas = await page.request.get(`${BASE}${href}`);
    expect(berkas.status()).toBe(200);
    expect(berkas.headers()['content-type']).toContain('image/png');

    await submitForm(page, 'Sudah bayar');
    await expect(page).toHaveURL(/\/admin\/payments\/pending\?ok=/);
    await expectFlash(page, 'Pembayaran diverifikasi dan saldo kas ditambah');

    const summary = await (await page.request.get(`${BASE}/api/public/summary`)).json();
    expect(summary.balance).toBe(1100000);

    // Status rumah warga ikut berubah setelah verifikasi.
    const rumahList = await (await page.request.get(`${BASE}/api/admin/houses`)).json();
    const rumahWarga = rumahList.houses.find((h: { block: string }) => h.block === 'C4/06');
    expect(rumahWarga.status).toBe('sudah');

    const me = await page.request.get(`${BASE}/api/warga/me`);
    expect(me.status()).not.toBe(200); // bendahara bukan warga
  });

  test('07 warga: pengajuan ditolak, bulan kembali menjadi tunggakan', async ({ page, context }) => {
    await login(context, WARGA.identifier, WARGA.baru);

    const me = await (await page.request.get(`${BASE}/api/warga/me`)).json();
    expect(me.unpaidMonths).toEqual([M3]);
    expect(me.paidUntil).toBe(M2);

    await page.goto('/warga/pembayaran');
    await page.setInputFiles('#proof', BUKTI_PNG);
    await submitForm(page, 'Kirim bukti');
    await expect(page).toHaveURL(/\/warga\/riwayat\?id=\d+/);
    const idTolak = Number(new URL(page.url()).searchParams.get('id'));

    const adminContext = await context.browser()!.newContext({ baseURL: BASE });
    await loginAdmin(adminContext);
    const admin = await adminContext.newPage();
    await admin.goto(`/admin/payments/pending/${idTolak}`);
    await admin.fill('#reason', 'Nominal transfer tidak sesuai');
    await admin.getByRole('button', { name: 'Tolak pengajuan' }).click();
    await expect(admin).toHaveURL(/\/admin\/payments\/pending\?ok=/);
    await expectFlash(admin, 'Pembayaran ditolak');
    await adminContext.close();

    await page.goto(`/warga/riwayat?id=${idTolak}`);
    await expect(page.locator('.card.pad')).toContainText('Ditolak: Nominal transfer tidak sesuai');
    await expect(page.locator('tr', { hasText: 'Ditolak' }).first()).toBeVisible();
    await expect(page.locator('tr', { hasText: 'Ditolak' }).first()).toContainText('50.000');

    const setelah = await (await page.request.get(`${BASE}/api/warga/me`)).json();
    expect(setelah.unpaidMonths).toEqual([M3]);
    // Sudah ada pembayaran terverifikasi, tetapi belum sampai bulan berjalan.
    expect(setelah.status).toBe('sudah');
    expect(setelah.paidUntil).toBe(M2);
  });

  test('08 pengeluaran: buat dan baca', async ({ page, context }) => {
    await loginAdmin(context);
    await page.goto('/admin/expenses');

    await page.fill('#expenseDate', `${M3}-10`);
    await page.fill('#amount', '350000');
    await page.fill('#description', 'E2E perbaikan lampu jalan');
    await page.setInputFiles('#proof', BUKTI_PNG);
    await submitForm(page, 'Simpan pengeluaran');
    await expectFlash(page, 'Pengeluaran tersimpan');

    const baris = page.locator('tr', { hasText: 'E2E perbaikan lampu jalan' });
    await expect(baris).toContainText('350.000');
    await expect(baris).toContainText('Ada');
    await baris.getByRole('link', { name: 'Detail' }).click();
    await expect(page.getByRole('heading', { name: /Detail pengeluaran #\d+/ })).toBeVisible();
    await expect(page.locator('.note')).toContainText('E2E perbaikan lampu jalan');
    pengeluaranId = Number(page.url().split('/').pop());

    const daftar = await page.request.get(`${BASE}/api/admin/expenses`);
    const data = (await daftar.json()).expenses.find((e: { id: number }) => e.id === pengeluaranId);
    expect(data.amount).toBe(350000);

    const detail = await page.request.get(`${BASE}/api/admin/expenses/${pengeluaranId}`);
    expect(detail.ok()).toBeTruthy();

    // Bukti pengeluaran hanya untuk bendahara.
    const buktiId = data.proofFileId ?? data.proof_file_id;
    if (buktiId) {
      const unduh = await page.request.get(`${BASE}/api/files/${buktiId}`);
      expect(unduh.status()).toBe(200);
    }

    await page.goto('/');
    expect(await saldoKas(page)).toBe(750000);
  });

  test('09 laporan bulanan konsisten dengan saldo', async ({ page, context }) => {
    await loginAdmin(context);

    const res = await page.request.get(`${BASE}/api/admin/reports/monthly?month=${M3}`);
    expect(res.ok()).toBeTruthy();
    const laporan = await res.json();
    expect(laporan.income).toBe(100000);
    expect(laporan.expense).toBe(350000);
    expect(laporan.closingBalance).toBe(laporan.openingBalance + laporan.income - laporan.expense);

    await page.goto(`/admin/reports?month=${M3}`);
    const kartu = page.locator('.grid-cards').first();
    await expect(kartu).toContainText('Rp1.000.000');
    await expect(kartu).toContainText('Rp100.000');
    await expect(kartu).toContainText('Rp350.000');
    await expect(kartu).toContainText('Rp750.000');
  });

  test('10 berkas: hak akses antar peran', async ({ page, context }) => {
    expect(buktiFileId).not.toBeNull();

    await loginAdmin(context);
    expect((await page.request.get(`${BASE}/api/files/${buktiFileId}`)).status()).toBe(200);

    const anon = await context.browser()!.newContext({ baseURL: BASE });
    const anonPage = await anon.newPage();
    expect((await anonPage.request.get(`${BASE}/api/files/${buktiFileId}`)).status()).toBe(401);
    await anon.close();

    const lain = await context.browser()!.newContext({ baseURL: BASE });
    await login(lain, WARGA_LAIN.identifier, WARGA_LAIN.password);
    const lainPage = await lain.newPage();
    await lainPage.goto('/ganti-password');
    await lainPage.fill('#current', WARGA_LAIN.password);
    await lainPage.fill('#next', WARGA_LAIN.baru);
    await lainPage.fill('#confirm', WARGA_LAIN.baru);
    await lainPage.getByRole('button', { name: 'Simpan password' }).click();
    await expect(lainPage).toHaveURL(/\/warga\?ok=/);
    expect((await lainPage.request.get(`${BASE}/api/files/${buktiFileId}`)).status()).toBe(403);
    await lain.close();
  });

  test('11 audit log mencatat seluruh aksi', async ({ page, context }) => {
    await loginAdmin(context);
    await page.goto('/admin/audit');

    const isi = page.locator('table');
    for (const aksi of ['Masuk', 'Ganti password', 'Tambah rumah', 'Pengajuan pembayaran', 'Verifikasi pembayaran', 'Tolak pembayaran', 'Catat pengeluaran', 'Ubah pengaturan']) {
      await expect(isi, `audit log harus memuat ${aksi}`).toContainText(aksi);
    }
  });

  test('12 papan publik mencerminkan data terverifikasi', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Papan Pengumuman/);
    await expect(page.locator('.stat-focus')).toContainText('Saldo kas');
    await expect(page.locator('.stat-focus')).toContainText('Rp750.000');
    await expect(page.locator('body')).not.toContainText('Pemilik Uji');
    await expect(page.locator('body')).not.toContainText('undefined');

    const houses = await (await page.request.get(`${BASE}/api/public/houses`)).json();
    const rumahUji = houses.houses.find((h: { block: string }) => h.block === 'C9/01');
    expect(rumahUji).toBeTruthy();
    expect(rumahUji).not.toHaveProperty('owner_name');
  });
});
