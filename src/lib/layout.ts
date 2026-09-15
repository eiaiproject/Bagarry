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

const STYLES = `
  :root {
    --brand:#0f766e; --brand-dark:#115e59; --ink:#1e293b; --muted:#475569;
    --line:#e2e8f0; --surface:#ffffff; --surface-soft:#f8fafc; --page:#f1f5f9;
    --focus:#0d9488; --ok-bg:#dcfce7; --ok-ink:#14532d; --ok-line:#86efac;
    --warn-bg:#fef3c7; --warn-ink:#92400e; --warn-line:#f59e0b;
    --err-bg:#fee2e2; --err-ink:#7f1d1d; --err-line:#fca5a5;
    --radius-sm:8px; --radius-md:10px; --radius-pill:999px;
    --space-1:4px; --space-2:8px; --space-3:12px; --space-4:16px; --space-5:20px;
    --container:1080px; --tap:44px;
  }
  *, *::before, *::after { box-sizing:border-box; }
  html { -webkit-text-size-adjust:100%; }
  body { margin:0; background:var(--page); color:var(--ink);
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif; line-height:1.5; }
  a { color:var(--brand-dark); }
  a:hover { text-decoration:underline; }
  a:active { text-decoration:underline; }
  :focus-visible { outline:3px solid var(--focus); outline-offset:2px; }
  .num { font-variant-numeric:tabular-nums; }
  @media (prefers-reduced-motion:reduce){
    *, *::before, *::after { animation:none !important; transition:none !important; scroll-behavior:auto !important; }
  }
  .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px;
    overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; border:0; }

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

  .stat { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md); padding:14px; }
  .stat span { display:block; font-size:12px; color:var(--muted); }
  .stat strong { display:block; font-size:22px; margin-top:4px; font-variant-numeric:tabular-nums; }
  .stat-focus { background:var(--brand); border-color:var(--brand-dark); }
  .stat-focus span { color:#ccfbf1; }
  .stat-focus strong { color:#fff; }
  /* Kartu statistik yang bisa diklik: seluruh kartu satu anchor dengan state jelas. */
  a.stat-link { display:block; color:inherit; text-decoration:none; }
  a.stat-link:hover { border-color:var(--brand); text-decoration:none; }
  a.stat-link:hover .stat-more { text-decoration:underline; }
  .stat-more { display:block; margin-top:8px; font-size:13px; font-weight:600; color:var(--brand-dark); }
  .stat-hint { display:block; margin-top:4px; font-size:12px; font-weight:400; color:var(--muted); }

  .icon { flex:none; vertical-align:-4px; }
  .flash { border-radius:var(--radius-md); padding:10px 14px; font-size:14px; margin-bottom:16px;
    display:flex; align-items:flex-start; gap:8px; }
  .flash .icon { vertical-align:0; margin-top:2px; }
  .flash-ok { background:var(--ok-bg); color:var(--ok-ink); border:1px solid var(--ok-line); }
  .flash-err { background:var(--err-bg); color:var(--err-ink); border:1px solid var(--err-line); }
  .note { background:var(--surface-soft); border:1px solid var(--line); border-radius:var(--radius-md);
    padding:10px 12px; font-size:13px; color:var(--muted); }
  .note .icon, .hint .icon { vertical-align:-3px; margin-right:4px; color:var(--brand-dark); }
  /* Alert konfigurasi dashboard: ikon + teks + CTA, membungkus sampai 320 px. */
  .alert { border-radius:var(--radius-md); padding:12px 14px; font-size:14px;
    display:flex; align-items:flex-start; gap:10px; border:1px solid var(--warn-line);
    background:var(--warn-bg); color:var(--warn-ink); }
  .alert .icon { margin-top:2px; }
  .alert-body { flex:1; min-width:0; }
  .alert-title { margin:0 0 2px; font-size:14px; font-weight:700; }
  .alert p { margin:0; }
  .alert-actions { margin-top:8px; display:flex; flex-wrap:wrap; gap:8px; }
  /* Aksi cepat: tombol besar 44 px, primer hanya satu. */
  .quick { display:grid; gap:8px; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); }
  .quick .btn { width:100%; }
  /* Daftar prioritas hari ini: teks + link aksi, tanpa warna bahaya untuk hal tertunda. */
  .todo { list-style:none; margin:0; padding:0; display:grid; gap:8px; }
  .todo li { display:flex; align-items:flex-start; gap:10px; background:var(--surface);
    border:1px solid var(--line); border-radius:var(--radius-md); padding:10px 12px; font-size:14px; }
  .todo .icon { margin-top:2px; width:16px; height:16px; }
  /* Link aksi di daftar prioritas: target 44 px, boleh membungkus di HP. */
  .todo li > span { flex:1; min-width:0; }
  .todo a { font-weight:600; display:inline-flex; align-items:center; min-height:var(--tap); }
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


/** Bottom nav mobile bendahara: 4 tujuan utama, sinkron dengan nav desktop. */
function bottomNavLinks(items: NavItem[], active?: string): string {
  const pick = (href: string): NavItem | undefined => items.find((item) => item.href === href);
  const chosen = [pick('/admin'), pick('/admin/payments/pending'), pick('/admin/payments'), pick('/admin/houses')].filter(
    (item): item is NavItem => Boolean(item),
  );
  return chosen
    .map((item) => {
      const isActive = active === item.href;
      const badgeHtml = item.badge ? `<span class="nav-count" aria-hidden="true">${esc(item.badge)}</span>` : '';
      const label = item.badge ? `${item.label} (${item.badge} menunggu)` : item.label;
      return `<a href="${esc(item.href)}"${isActive ? ' aria-current="page"' : ''} aria-label="${esc(label)}">${icon(
        item.iconName,
        { size: 20 },
      )}<span aria-hidden="true">${esc(item.label)}</span>${badgeHtml}</a>`;
    })
    .join('');
}

export function renderPage(options: PageOptions): string {
  const pending = options.pendingCount ?? 0;
  const items = navFor(options.user, pending);
  const nav = items
    .map((item) => {
      const isActive = options.active === item.href;
      const badgeHtml = item.badge ? `<span class="nav-count" aria-hidden="true">${esc(item.badge)}</span>` : '';
      const label = item.badge ? `${item.label} (${item.badge} menunggu)` : item.label;
      return `<a class="nav-link${isActive ? ' nav-link-active' : ''}" href="${esc(item.href)}"${
        isActive ? ' aria-current="page"' : ''
      } aria-label="${esc(label)}">${icon(item.iconName, { size: 18 })}<span aria-hidden="true">${esc(
        item.label,
      )}</span>${badgeHtml}</a>`;
    })
    .join('');
  const isStaging = options.appName.includes('[STAGING]');
  const brandName = options.appName.replace(' [STAGING]', '');
  const envBadge = isStaging ? `<span class="env-badge">STAGING</span>` : '';

  const who = options.user
    ? `<span class="who">${esc(options.user.role === 'admin' ? 'Bendahara' : options.user.block ?? options.user.username ?? 'Warga')}</span>`
    : `<a class="btn btn-primary btn-sm" href="/login">${icon('login')}<span>Masuk</span></a>`;

  const logout = options.user
    ? `<form method="post" action="/logout" class="inline-form"><button class="btn btn-ghost btn-sm" type="submit" aria-label="Keluar dari akun">${icon(
        'logout',
      )}<span aria-hidden="true">Keluar</span></button></form>`
    : '';

  const flash = [
    options.ok
      ? `<div class="flash flash-ok" role="status">${icon('approve')}<span>${esc(options.ok)}</span></div>`
      : '',
    options.err
      ? `<div class="flash flash-err" role="alert">${icon('warning')}<span>${esc(options.err)}</span></div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  // Bottom nav mobile: 4 tujuan utama + badge antrean, sinkron dengan nav desktop.
  const bottomNav =
    options.user?.role === 'admin'
      ? `<nav class="bottom-nav" aria-label="Navigasi cepat bendahara">${bottomNavLinks(items, options.active)}</nav>`
      : '';

  const maxWidth = options.container === 'narrow' ? 'max-width:520px' : 'max-width:1080px';
  return `<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(options.title)} | ${esc(options.appName)}</title>
<link rel="icon" href="data:,">
<style>${STYLES}
  header.site { background:#0f172a; color:#fff; padding-top:env(safe-area-inset-top); }
  .site-inner { margin:0 auto; max-width:var(--container); padding:10px 16px; display:flex;
    align-items:center; justify-content:space-between; gap:12px; }
  .site-inner .brand { font-size:15px; margin:0; font-weight:650; min-width:0; }
  .site-inner .brand a { color:#fff; text-decoration:none; display:inline-flex; align-items:center; gap:8px; min-width:0; }
  .brand-short { display:none; }
  @media (max-width:640px){
    .brand-full { display:none; }
    .brand-short { display:inline; }
    .who { display:none; }
    .site-inner .brand { font-size:14px; }
    .site-inner { gap:8px; padding:8px 12px; }
  }
  .site-inner .brand .brand-mark { display:inline-flex; color:#5eead4; }
  .who { font-size:13px; color:#cbd5e1; }
  .head-right { display:flex; align-items:center; gap:10px; }
  /* Badge STAGING terpisah dari nama aplikasi: terlihat, tidak mendominasi. */
  .env-badge { display:inline-block; padding:1px 8px; border:1px solid #5eead4; border-radius:var(--radius-pill);
    color:#5eead4; font-size:11px; font-weight:700; letter-spacing:.04em; white-space:nowrap; }
  .inline-form { display:inline; margin:0; }
  /* Skip link: hanya terlihat saat fokus keyboard. */
  .skip-link { position:absolute; left:8px; top:-48px; z-index:50; background:#fff; color:var(--brand-dark);
    padding:10px 14px; border-radius:var(--radius-sm); font-weight:700; transition:top .15s; }
  .skip-link:focus-visible { top:8px; }
  nav.site { background:#fff; border-bottom:1px solid var(--line); }
  .nav-inner { margin:0 auto; max-width:var(--container); padding:0 8px; display:flex; gap:2px;
    overflow-x:auto; scrollbar-width:thin; }
  .nav-link { display:inline-flex; align-items:center; gap:6px; padding:12px 12px; font-size:14px;
    color:#334155; text-decoration:none; white-space:nowrap; border-bottom:2px solid transparent; }
  .nav-link .icon { color:#64748b; }
  .nav-link-active .icon { color:var(--brand-dark); }
  .nav-link:hover { background:#f8fafc; text-decoration:none; }
  .nav-link-active { color:var(--brand-dark); border-bottom-color:var(--brand); font-weight:650; }
  /* Angka antrean di nav: satu-satunya aksen tambahan, hanya muncul bila ada yang menunggu. */
  .nav-count { display:inline-flex; align-items:center; justify-content:center; min-width:20px; height:20px;
    padding:0 6px; border-radius:var(--radius-pill); background:var(--brand); color:#fff; font-size:12px; font-weight:700; }
  /* Daftar tunggakan versi kartu: satu struktur, berubah layout via CSS di HP. */
  @media (max-width:640px){
    .arrears-table.table-wrap { overflow:visible; border:none; background:transparent; padding:0; }
    .arrears-table thead { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
    .arrears-table table, .arrears-table tbody { display:block; width:100%; }
    .arrears-table tbody { display:grid; gap:8px; }
    .arrears-table tr { display:block; width:100%; box-sizing:border-box; background:var(--surface); border:1px solid var(--line); border-radius:var(--radius-md); padding:12px; }
    .arrears-table td { display:block; border:none; padding:2px 0; }
    .arrears-table td [data-label]::before { content:attr(data-label); display:block; font-size:12px; color:var(--muted); }
    .arrears-table td .cell-action .btn, .arrears-table td .btn { width:100%; }
    .arrears-table td:has(> .cell-action) { padding-top:8px; }
  }
  .section-gap { margin-top:var(--space-5); }
  .grid-cards { display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); }
  .grid-2 { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); }
  /* Ringkasan saldo: saldo penuh sebaris di mobile, 3 kolom proporsional di desktop. */
  .grid-balance { display:grid; gap:12px; grid-template-columns:1fr; }
  @media (min-width:640px){ .grid-balance { grid-template-columns:1.4fr 1fr 1fr; } }
  /* Status pembayaran: 2 kolom di HP, 4 kolom di tablet/desktop. */
  .grid-status { display:grid; gap:12px; grid-template-columns:repeat(2,1fr); }
  @media (min-width:768px){ .grid-status { grid-template-columns:repeat(4,1fr); } }
  footer.site { margin:0 auto; max-width:var(--container); padding:0 16px calc(32px + env(safe-area-inset-bottom)); color:var(--muted); font-size:12px; }
  @media (max-width:520px){ .grid-cards { grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); } }
  .bottom-nav { display:none; }
  @media (max-width:768px){
    /* Bottom nav mobile: 4 item + safe-area, konten diberi ruang di bawah. */
    .bottom-nav { display:flex; position:fixed; left:0; right:0; bottom:0; z-index:40;
      background:var(--surface); border-top:1px solid var(--line);
      padding-bottom:env(safe-area-inset-bottom); }
    .bottom-nav a { flex:1; display:flex; flex-direction:column; align-items:center; gap:2px;
      padding:8px 4px calc(8px + env(safe-area-inset-bottom)); font-size:11px; color:var(--muted);
      text-decoration:none; min-height:var(--tap); justify-content:center; position:relative; }
    .bottom-nav a[aria-current="page"] { color:var(--brand-dark); font-weight:700; }
    .bottom-nav .nav-count { position:absolute; top:4px; right:calc(50% - 26px); }
    body.has-bottom-nav main.site { padding-bottom:96px; }
    body.has-bottom-nav footer.site { padding-bottom:calc(96px + env(safe-area-inset-bottom)); }
  }
  @media print {
    header.site, nav.site, .bottom-nav, .quick, .skip-link { display:none !important; }
    body { background:#fff; }
    main.site { max-width:none; padding:0; }
    .card, .table-wrap, .stat { border-color:#999; break-inside:avoid; }
  }
</style>
</head>
<body${options.user?.role === 'admin' ? ' class="has-bottom-nav"' : ''}>
<a class="skip-link" href="#konten-utama">Lewati ke konten utama</a>
<header class="site">
  <div class="site-inner">
    <p class="brand"><a href="/" aria-label="Kas Amartha Cluster Bagarry, ke papan pengumuman"><span class="brand-mark">${icon('brand', { size: 20 })}</span><span class="brand-full">${esc(
      brandName,
    )}</span><span class="brand-short">Bagarry</span>${envBadge}</a></p>
    <div class="head-right">${who}${logout}</div>
  </div>
</header>
<nav class="site" aria-label="Navigasi utama"><div class="nav-inner">${nav}</div></nav>
<main class="site" id="konten-utama" tabindex="-1">
  ${flash}
  ${options.content}
</main>
<footer class="site">
  Zona waktu Asia/Jakarta · Nominal dalam Rupiah · Data diperbarui bendahara
</footer>
${bottomNav}
<script>
  // Navigasi antar halaman memakai muat ulang penuh, jadi tidak ada state "memuat" di klien.
  // Saat form dikirim ke server, tombol submit-nya dikunci supaya tidak terkirim dua kali.
  // Validasi bawaan browser membatalkan submit sebelum event ini: tombol tidak tersentuh.
  document.addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || form.tagName !== 'FORM') return;
    var button = form.querySelector('button[type="submit"]');
    if (!button || button.disabled) return;
    var label = button.querySelector('span');
    var original = label ? label.textContent : null;
    if (label) label.textContent = 'Mengirim...';
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    // Bila submit dibatalkan (mis. validasi gagal), pulihkan tombol.
    window.setTimeout(function () {
      if (form.isConnected && !form.checkValidity()) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        if (label && original) label.textContent = original;
      }
    }, 0);
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
