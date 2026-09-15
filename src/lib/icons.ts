// Ikon dari paket resmi Reicon (https://reicon.dev, MIT).
// Dipakai sebagai SVG inline lewat toSvg() karena halaman dirender di Worker,
// bukan di browser. Warna mengikuti currentColor sehingga ikon mengikuti warna teks
// tombol atau tautan yang memuatnya, dan tidak perlu request gambar terpisah.
import { ArrowLeft } from 'reicon/icons/ArrowLeft';
import { BillList } from 'reicon/icons/BillList';
import { ChartBar } from 'reicon/icons/ChartBar';
import { ChartSquare } from 'reicon/icons/ChartSquare';
import { CheckCircle } from 'reicon/icons/CheckCircle';
import { ClipboardCheck } from 'reicon/icons/ClipboardCheck';
import { ClipboardImport } from 'reicon/icons/ClipboardImport';
import { ClipboardList } from 'reicon/icons/ClipboardList';
import { Clock } from 'reicon/icons/Clock';
import { ClockCircle } from 'reicon/icons/ClockCircle';
import { CloseCircle } from 'reicon/icons/CloseCircle';
import { CloudUpload } from 'reicon/icons/CloudUpload';
import { Edit } from 'reicon/icons/Edit';
import { Eye } from 'reicon/icons/Eye';
import { FileSend } from 'reicon/icons/FileSend';
import { Floppy } from 'reicon/icons/Floppy';
import { Gear } from 'reicon/icons/Gear';
import { Home } from 'reicon/icons/Home';
import { House } from 'reicon/icons/House';
import { InfoCircle } from 'reicon/icons/InfoCircle';
import { LockKeyhole } from 'reicon/icons/LockKeyhole';
import { LockKeyholeOpen } from 'reicon/icons/LockKeyholeOpen';
import { Login } from 'reicon/icons/Login';
import { Logout } from 'reicon/icons/Logout';
import { MoneyBills } from 'reicon/icons/MoneyBills';
import { MoneyStack } from 'reicon/icons/MoneyStack';
import { Plus } from 'reicon/icons/Plus';
import { Receipt } from 'reicon/icons/Receipt';
import { Search } from 'reicon/icons/Search';
import { Wallet } from 'reicon/icons/Wallet';
import { Warning } from 'reicon/icons/Warning';

/**
 * Nama semantik, bukan nama vendor, supaya penggantian ikon cukup di satu tempat.
 * Setiap ikon dipilih karena artinya cocok dengan aksinya, bukan sebagai hiasan.
 */
const ICONS = {
  brand: MoneyStack, // kas cluster
  board: Home, // papan pengumuman
  dashboard: ChartSquare, // ringkasan angka
  payDues: Wallet, // bayar iuran dari dompet
  history: BillList, // daftar tagihan lampau
  pending: Clock, // menunggu verifikasi
  houses: House, // data rumah
  payments: MoneyBills, // pembayaran warga
  expenses: Receipt, // nota pengeluaran
  reports: ChartBar, // laporan bulanan
  settings: Gear, // pengaturan
  audit: ClipboardList, // catatan aktivitas
  password: LockKeyhole, // ganti password
  resetPassword: LockKeyholeOpen, // buka kunci akun
  login: Login,
  logout: Logout,
  upload: CloudUpload, // unggah bukti
  send: FileSend, // kirim pengajuan
  approve: CheckCircle, // setujui
  reject: CloseCircle, // tolak
  inspect: ClipboardCheck, // periksa bukti
  view: Eye, // lihat bukti
  add: Plus, // tambah data
  importCsv: ClipboardImport, // impor data rumah
  save: Floppy, // simpan form
  edit: Edit, // kelola data
  search: Search, // tampilkan/filter
  back: ArrowLeft, // kembali ke halaman sebelumnya
  warning: Warning, // peringatan
  info: InfoCircle, // keterangan
  waiting: ClockCircle, // sedang diproses
} as const;

export type IconName = keyof typeof ICONS;

export interface IconOptions {
  /** Ukuran sisi dalam piksel. 16 untuk di dalam tombol, 18 sampai 22 untuk navigasi. */
  size?: number;
  /** Diisi hanya bila ikon berdiri sendiri tanpa label teks. */
  label?: string;
  className?: string;
}

export function icon(name: IconName, options: IconOptions = {}): string {
  const { size = 16, label, className = 'icon' } = options;
  const attributes: Record<string, string> = label
    ? { role: 'img', 'aria-label': label }
    : { 'aria-hidden': 'true', focusable: 'false' };
  return ICONS[name].toSvg({ size, weight: 'Outline', className, attrs: attributes });
}
