import { describe, expect, it } from 'vitest';
import { parseHouseCsv } from '../src/lib/csv';
import { addMonths, formatDateID, monthListLabel, monthRange } from '../src/lib/date';
import { computeHouseStatus, recalcPaidUntil } from '../src/lib/houses';
import { formatRupiah, parseRupiah } from '../src/lib/money';
import { checkNewPassword, defaultResidentPassword, hashPassword, verifyPassword } from '../src/lib/password';
import { validateMonthSelection } from '../src/lib/payments';
import type { Settings } from '../src/lib/settings';

const settings: Settings = {
  monthlyFee: 50000,
  openingBalance: 0,
  openingBalanceDate: '2026-01-01',
  globalBillingStartMonth: '2026-01',
};

// 15 Juli 2026, 10:00 WIB.
const today = new Date('2026-07-15T03:00:00Z');

describe('utilitas bulan', () => {
  it('menambah bulan melewati batas tahun', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(addMonths('2026-07', -7)).toBe('2025-12');
  });

  it('membuat rentang bulan inklusif', () => {
    expect(monthRange('2026-01', '2026-03')).toEqual(['2026-01', '2026-02', '2026-03']);
    expect(monthRange('2026-05', '2026-01')).toEqual([]);
  });

  it('meringkas daftar bulan berurutan', () => {
    expect(monthListLabel(['2026-05', '2026-06', '2026-07'])).toBe('Mei – Jul 2026');
    expect(monthListLabel(['2026-07'])).toBe('Jul 2026');
    expect(monthListLabel(['2026-01', '2026-03'])).toBe('Jan 2026, Mar 2026');
  });

  it('memformat tanggal gaya Indonesia', () => {
    expect(formatDateID('2026-07-05')).toBe('5 Jul 2026');
    expect(formatDateID(null)).toBe('-');
  });
});

describe('nominal rupiah', () => {
  it('memformat dengan pemisah ribuan', () => {
    expect(formatRupiah(5300000)).toBe('Rp5.300.000');
    expect(formatRupiah(0)).toBe('Rp0');
  });

  it('membaca input pengguna', () => {
    expect(parseRupiah('Rp50.000')).toBe(50000);
    expect(parseRupiah(' 350000 ')).toBe(350000);
    expect(parseRupiah('abc')).toBeNull();
  });
});

describe('status pembayaran', () => {
  const house = { is_active: 1, billing_start_month: null };

  it('menandai lunas bila pembayaran mencakup bulan berjalan', () => {
    const info = computeHouseStatus(
      house,
      { paid: new Set(monthRange('2026-01', '2026-07')), pending: new Set() },
      settings,
      today,
    );
    expect(info.status).toBe('lunas');
    expect(info.note).toBe('Lunas sampai Jul 2026');
    expect(info.totalDue).toBe(0);
  });

  it('menandai sudah bayar bila belum sampai bulan berjalan', () => {
    const info = computeHouseStatus(
      house,
      { paid: new Set(monthRange('2026-01', '2026-04')), pending: new Set() },
      settings,
      today,
    );
    expect(info.status).toBe('sudah');
    expect(info.unpaidMonths).toEqual(['2026-05', '2026-06', '2026-07']);
    expect(info.totalDue).toBe(150000);
    expect(info.paidUntil).toBe('2026-04');
  });

  it('memprioritaskan menunggu verifikasi', () => {
    const info = computeHouseStatus(
      house,
      { paid: new Set(monthRange('2026-01', '2026-04')), pending: new Set(['2026-05', '2026-06']) },
      settings,
      today,
    );
    expect(info.status).toBe('menunggu');
    expect(info.unpaidMonths).toEqual(['2026-07']);
  });

  it('menandai belum bayar bila tidak ada pembayaran sama sekali', () => {
    const info = computeHouseStatus(house, { paid: new Set(), pending: new Set() }, settings, today);
    expect(info.status).toBe('belum');
    expect(info.totalDue).toBe(350000);
  });

  it('tidak menghitung rumah nonaktif sebagai tunggakan', () => {
    const info = computeHouseStatus(
      { is_active: 0, billing_start_month: null },
      { paid: new Set(), pending: new Set() },
      settings,
      today,
    );
    expect(info.status).toBe('nonaktif');
    expect(info.unpaidMonths).toEqual([]);
    expect(info.totalDue).toBe(0);
  });

  it('menghitung paid_until hanya sampai bulan berurutan', () => {
    expect(recalcPaidUntil(['2026-01', '2026-02', '2026-04'], '2026-01')).toBe('2026-02');
    expect(recalcPaidUntil(['2026-02'], '2026-01')).toBeNull();
    expect(recalcPaidUntil([], '2026-01')).toBeNull();
  });
});

describe('pemilihan bulan pembayaran', () => {
  const unpaid = ['2026-05', '2026-06', '2026-07'];

  it('menerima pilihan berurutan dari tunggakan terlama', () => {
    expect(validateMonthSelection(['2026-05', '2026-06'], unpaid)).toEqual({
      ok: true,
      months: ['2026-05', '2026-06'],
    });
  });

  it('menolak pilihan yang melompat', () => {
    expect(validateMonthSelection(['2026-06'], unpaid).ok).toBe(false);
    expect(validateMonthSelection(['2026-05', '2026-07'], unpaid).ok).toBe(false);
  });

  it('menolak pilihan kosong', () => {
    expect(validateMonthSelection([], unpaid).ok).toBe(false);
  });
});

describe('password', () => {
  it('membuat dan memverifikasi hash PBKDF2', async () => {
    const hash = await hashPassword('WargaC4-20baru', 10000);
    expect(hash.startsWith('pbkdf2$sha256$10000$')).toBe(true);
    expect(await verifyPassword('WargaC4-20baru', hash)).toBe(true);
    expect(await verifyPassword('salah', hash)).toBe(false);
  });

  it('menolak hash dengan format tidak dikenal', async () => {
    expect(await verifyPassword('apa saja', 'plain-text')).toBe(false);
  });

  it('menegakkan aturan password baru', () => {
    expect(checkNewPassword('pendek', 'pendek', null)).toEqual({ ok: false, message: 'Password minimal 8 karakter.' });
    expect(checkNewPassword('cukuppanjang', 'beda', null).ok).toBe(false);
    expect(checkNewPassword('BagarryC4/06', 'BagarryC4/06', 'BagarryC4/06').ok).toBe(false);
    expect(checkNewPassword('WargaC4-20baru', 'WargaC4-20baru', 'BagarryC4/20')).toEqual({ ok: true });
  });

  it('menyusun password default dari blok rumah', () => {
    expect(defaultResidentPassword('C4/06')).toBe('BagarryC4/06');
  });
});

describe('import CSV rumah', () => {
  it('membaca baris valid dan melewati header', () => {
    const result = parseHouseCsv('jenis_rumah,blok,status_huni,aktif\nLupine,C4/06,berpenghuni,1');
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      houseType: 'Lupine',
      block: 'C4/06',
      occupancyStatus: 'berpenghuni',
      isActive: true,
      line: 2,
    });
  });

  it('melaporkan baris bermasalah tanpa menggagalkan lainnya', () => {
    const result = parseHouseCsv(['', '# komentar', 'Lupine C4,C4/07', 'Lupine,C4/08,rumah', 'Lupine,C4/09,kosong,tidak'].join('\n'));
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ block: 'C4/09', isActive: false });
    expect(result.errors).toHaveLength(2);
  });

  it('memakai nilai default untuk kolom opsional', () => {
    const result = parseHouseCsv('Lupine,C4/10');
    expect(result.rows[0]).toMatchObject({ occupancyStatus: 'berpenghuni', isActive: true });
  });
});
