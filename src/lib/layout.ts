import type { SessionUser } from '../env';
import { esc } from './html';
import { icon, type IconName } from './icons';

/**
 * Arah desain, dipakai konsisten di seluruh halaman: ENERGY 1 / RHYTHM 1 / MOTION 1.
 * Aplikasi kas lingkungan dibaca sambil berdiri di depan papan pengumuman atau di HP,
 * jadi tampilannya tenang, padat, dan tanpa animasi. Angka rupiah adalah fokus setiap
 * layar, dan warna hanya dipakai untuk menandai status pembayaran.
 */

export interface NavItem {
  href: string;
  label: string;
  iconName: IconName;
  /** Teks kecil di samping label, mis. hitung antrean. Kosong bila tidak ada. */
  badge?: string;
}

const STYLES = `
  :root { --brand:#0f766e; --brand-dark:#115e59; --ink:#1e293b; --line:#e2e8f0; }
  * { box-sizing:border-box; }
  body { margin:0; background:#f1f5f9; color:var(--ink);
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; line-height:1.5; }
  a { color:var(--brand-dark); }
  a:hover { text-decoration:underline; }
  :focus-visible { outline:3px solid #0d9488; outline-offset:2px; }
  .num { font-variant-numeric:tabular-nums; }

  .card { background:#fff; border:1px solid var(--line); border-radius:10px; }
  .pad { padding:16px; }

  .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px;
    min-height:44px; padding:8px 14px; border-radius:8px; border:1px solid transparent;
    font-size:14px; font-weight:600; cursor:pointer; text-decoration:none; }
  .btn:hover { text-decoration:none; }
  .btn-primary { background:var(--brand); color:#fff; }
  .btn-primary:hover { background:var(--brand-dark); }
  .btn-ghost { background:#fff; border-color:#cbd5e1; color:var(--brand-dark); }
  .btn-ghost:hover { background:#f8fafc; }
  .btn-danger { background:#b91c1c; color:#fff; }
  .btn-danger:hover { background:#991b1b; }
  /* Tombol terkunci tidak diredupkan: meredupkan seluruh tombol menurunkan kontras teksnya
     di bawah WCAG AA. Perubahan label dan kursor sudah cukup menandai keadaannya. */
  .btn:disabled { cursor:progress; }
  .btn-sm { min-height:38px; padding:4px 10px; font-size:13px; }
  /* Tombol kecil di dalam tabel tetap ramah jari di layar sempit. */
  @media (max-width:640px){ .btn-sm { min-height:44px; } }

  .label { display:block; font-size:12px; font-weight:600; color:#475569; margin-bottom:4px; }
  .input { width:100%; min-height:44px; padding:8px 10px; border:1px solid #cbd5e1;
    border-radius:8px; background:#fff; font-size:16px; color:var(--ink); font-family:inherit; }
  .input:disabled { background:#f1f5f9; color:#475569; }
  .hint { margin:4px 0 0; font-size:12px; color:#475569; }
  input[type="checkbox"] { width:20px; height:20px; accent-color:var(--brand); flex:none; }
  /* Baris centang adalah kontrol, bukan teks: seluruh baris jadi sasaran sentuh 44 px. */
  .check-row { display:flex; align-items:center; gap:10px; min-height:44px; font-size:14px; }

  .badge { display:inline-block; padding:2px 9px; border-radius:999px; font-size:12px;
    font-weight:600; white-space:nowrap; }
  .badge-lunas { background:#dcfce7; color:#166534; }
  .badge-sudah { background:#dbeafe; color:#1e40af; }
  .badge-menunggu, .badge-pending { background:#fef3c7; color:#92400e; }
  .badge-belum, .badge-rejected { background:#fee2e2; color:#991b1b; }
  .badge-nonaktif { background:#e2e8f0; color:#475569; }
  .badge-verified, .badge-paid { background:#dcfce7; color:#166534; }

  .table-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:10px; background:#fff; }
  .table { width:100%; border-collapse:collapse; font-size:14px; }
  .table th { background:#f8fafc; text-align:left; font-size:12px; color:#475569;
    text-transform:none; padding:10px 12px; border-bottom:1px solid var(--line); white-space:nowrap; }
  .table td { padding:10px 12px; border-bottom:1px solid #f1f5f9; vertical-align:top; }
  .table tr:last-child td { border-bottom:none; }

  .empty { border:1px dashed #cbd5e1; border-radius:10px; padding:20px; text-align:center;
    background:#fff; color:#475569; font-size:14px; }
  .empty p { margin:0 0 12px; }

  .stat { background:#fff; border:1px solid var(--line); border-radius:10px; padding:14px; }
  .stat span { display:block; font-size:12px; color:#475569; }
  .stat strong { display:block; font-size:22px; margin-top:4px; font-variant-numeric:tabular-nums; }
  .stat-focus { background:var(--brand); border-color:var(--brand-dark); }
  .stat-focus span { color:#ccfbf1; }
  .stat-focus strong { color:#fff; }

  .icon { flex:none; vertical-align:-4px; }
  .flash { border-radius:10px; padding:10px 14px; font-size:14px; margin-bottom:16px;
    display:flex; align-items:flex-start; gap:8px; }
  .flash .icon { vertical-align:0; margin-top:2px; }
  .flash-ok { background:#dcfce7; color:#14532d; border:1px solid #86efac; }
  .flash-err { background:#fee2e2; color:#7f1d1d; border:1px solid #fca5a5; }
  .note { background:#f8fafc; border:1px solid var(--line); border-radius:10px;
    padding:10px 12px; font-size:13px; color:#475569; }
  .note .icon, .hint .icon { vertical-align:-3px; margin-right:4px; color:var(--brand-dark); }
`;

const PUBLIC_NAV: NavItem[] = [{ href: '/', label: 'Papan Pengumuman', iconName: 'board' }];
const RESIDENT_NAV: NavItem[] = [
  { href: '/', label: 'Papan Pengumuman', iconName: 'board' },
  { href: '/warga', label: 'Dashboard', iconName: 'dashboard' },
  { href: '/warga/pembayaran', label: 'Bayar Iuran', iconName: 'payDues' },
  { href: '/warga/riwayat', label: 'Riwayat', iconName: 'history' },
  { href: '/warga/password', label: 'Ganti Password', iconName: 'password' },
];
function adminNav(pendingCount: number): NavItem[] {
  return [
    { href: '/admin', label: 'Dashboard', iconName: 'dashboard' },
    {
      href: '/admin/payments/pending',
      label: 'Menunggu Verifikasi',
      iconName: 'pending',
      badge: pendingCount > 0 ? String(pendingCount) : undefined,
    },
    { href: '/admin/houses', label: 'Kelola Rumah', iconName: 'houses' },
    { href: '/admin/payments', label: 'Pembayaran', iconName: 'payments' },
    { href: '/admin/expenses', label: 'Pengeluaran', iconName: 'expenses' },
    { href: '/admin/reports', label: 'Laporan', iconName: 'reports' },
    { href: '/admin/settings', label: 'Pengaturan', iconName: 'settings' },
    { href: '/admin/audit', label: 'Audit Log', iconName: 'audit' },
    { href: '/admin/password', label: 'Ganti Password', iconName: 'password' },
  ];
}

export function navFor(user: SessionUser | null, pendingCount = 0): NavItem[] {
  if (!user) return PUBLIC_NAV;
  if (user.role === 'admin') return adminNav(pendingCount);
  return RESIDENT_NAV;
}

export interface PageOptions {
  title: string;
  appName: string;
  user: SessionUser | null;
  content: string;
  /** Path aktif, dipakai untuk menandai menu. */
  active?: string;
  ok?: string | null;
  err?: string | null;
  /** true bila halaman berada di area dalam (setelah login). */
  container?: 'wide' | 'narrow';
  /** Antrean menunggu verifikasi, ditampilkan sebagai angka di nav bendahara. */
  pendingCount?: number;
}

export function renderPage(options: PageOptions): string {
  const nav = navFor(options.user, options.pendingCount ?? 0)
    .map((item) => {
      const isActive = options.active === item.href;
      const badgeHtml = item.badge ? `<span class="nav-count">${esc(item.badge)}</span>` : '';
      return `<a class="nav-link${isActive ? ' nav-link-active' : ''}" href="${esc(item.href)}"${
        isActive ? ' aria-current="page"' : ''
      }>${icon(item.iconName, { size: 18 })}<span>${esc(item.label)}</span>${badgeHtml}</a>`;
    })
    .join('');

  const who = options.user
    ? `<span class="who">${esc(options.user.role === 'admin' ? 'Bendahara' : options.user.block ?? options.user.username ?? 'Warga')}</span>`
    : `<a class="btn btn-primary btn-sm" href="/login">${icon('login')}<span>Masuk</span></a>`;

  const logout = options.user
    ? `<form method="post" action="/logout" class="inline-form"><button class="btn btn-ghost btn-sm" type="submit">${icon(
        'logout',
      )}<span>Keluar</span></button></form>`
    : '';

  const flash = [
    options.ok ? `<div class="flash flash-ok">${icon('approve')}<span>${esc(options.ok)}</span></div>` : '',
    options.err ? `<div class="flash flash-err">${icon('warning')}<span>${esc(options.err)}</span></div>` : '',
  ]
    .filter(Boolean)
    .join('');

  const maxWidth = options.container === 'narrow' ? 'max-width:520px' : 'max-width:1080px';

  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(options.title)} | ${esc(options.appName)}</title>
<link rel="icon" href="data:,">
<style>${STYLES}
  header.site { background:#0f172a; color:#fff; }
  .site-inner { margin:0 auto; max-width:1080px; padding:10px 16px; display:flex;
    align-items:center; justify-content:space-between; gap:12px; }
  .site-inner h1 { font-size:15px; margin:0; font-weight:650; }
  .site-inner h1 a { color:#fff; text-decoration:none; display:inline-flex; align-items:center; gap:8px; }
  .site-inner h1 .brand-mark { display:inline-flex; color:#5eead4; }
  .who { font-size:13px; color:#cbd5e1; }
  .head-right { display:flex; align-items:center; gap:10px; }
  .inline-form { display:inline; margin:0; }
  nav.site { background:#fff; border-bottom:1px solid var(--line); }
  .nav-inner { margin:0 auto; max-width:1080px; padding:0 8px; display:flex; gap:2px;
    overflow-x:auto; }
  .nav-link { display:inline-flex; align-items:center; gap:6px; padding:12px 12px; font-size:14px;
    color:#334155; text-decoration:none; white-space:nowrap; border-bottom:2px solid transparent; }
  .nav-link .icon { color:#64748b; }
  .nav-link-active .icon { color:var(--brand-dark); }
  .nav-link-active { color:var(--brand-dark); border-bottom-color:var(--brand); font-weight:650; }
  /* Angka antrean di nav: satu-satunya aksen tambahan, hanya muncul bila ada yang menunggu. */
  .nav-count { display:inline-flex; align-items:center; justify-content:center; min-width:20px; height:20px;
    padding:0 6px; border-radius:999px; background:var(--brand); color:#fff; font-size:12px; font-weight:700; }
  /* Nav admin 9 item tidak muat di 1280px dengan padding 12px: rapatkan di desktop lebar. */
  @media (min-width:1024px){ .nav-link { padding:12px 8px; gap:5px; font-size:13px; } }
  /* Tabel audit 6 kolom tidak muat di HP: kolom IP disembunyikan di layar sempit. */
  @media (max-width:640px){ .audit-table .table th:nth-child(6), .audit-table .table td:nth-child(6) { display:none; } }
  .brand-short { display:none; }
  @media (max-width:480px){
    .brand-full { display:none; }
    .brand-short { display:inline; }
    .who { display:none; }
    .site-inner h1 { font-size:14px; }
  }
  .page-title { font-size:22px; margin:0 0 4px; }
  .page-sub { margin:0; color:#475569; font-size:14px; }
  .grid-cards { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); }
  .grid-2 { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); }
  footer.site { margin:0 auto; max-width:1080px; padding:0 16px 32px; color:#475569; font-size:12px; }
  @media (max-width:520px){ .grid-cards { grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); } }
</style>
</head>
<body>
<header class="site">
  <div class="site-inner">
    <h1><a href="/"><span class="brand-mark">${icon('brand', { size: 20 })}</span><span class="brand-full">${esc(
      options.appName,
    )}</span><span class="brand-short">${esc(options.appName.split(' ').slice(-1)[0] ?? 'Bagarry')}</span></a></h1>
    <div class="head-right">${who}${logout}</div>
  </div>
</header>
<nav class="site"><div class="nav-inner">${nav}</div></nav>
<main class="site">
  ${flash}
  ${options.content}
</main>
<footer class="site">
  Zona waktu Asia/Jakarta · Nominal dalam Rupiah · Data diperbarui bendahara
</footer>
<script>
  // Halaman berpindah lewat muat ulang penuh, jadi tidak ada state "memuat" di klien.
  // Satu-satunya jeda yang tidak terlihat pengguna adalah saat form dikirim ke server,
  // dan di situ tombol dikunci supaya pengajuan tidak terkirim dua kali.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || form.tagName !== 'FORM') return;
    var button = form.querySelector('button[type="submit"]');
    if (!button || button.disabled) return;
    var label = button.querySelector('span');
    if (label) label.textContent = 'Mengirim...';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  });
</script>
</body>
</html>`;
}

/** Query string untuk pesan hasil aksi setelah redirect. */
export function flashQuery(ok?: string | null, err?: string | null): string {
  const params = new URLSearchParams();
  if (ok) params.set('ok', ok);
  if (err) params.set('err', err);
  const query = params.toString();
  return query ? `?${query}` : '';
}
