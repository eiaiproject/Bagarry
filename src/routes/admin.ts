import type { Hono } from 'hono';
import type { AppEnv } from '../types';
import { actionLabel, actorLabel, changeSummary, listAuditLogs } from '../lib/audit';
import { parseHouseCsv } from '../lib/csv';
import { currentMonth, formatDateID, formatDateTimeID, isMonth, jakartaDate, monthLabel, monthLabelFull, monthListLabel } from '../lib/date';
import { createExpense, getExpense, listExpenses } from '../lib/expenses';
import { deleteFile, storeFile, validateUploadFile } from '../lib/files';
import { badge, emptyState, esc, rupiah, table } from '../lib/html';
import { icon } from '../lib/icons';
import {
  createHouse,
  getHouse,
  importHouses,
  occupancyLabel,
  OCCUPANCY_OPTIONS,
  resetResidentPassword,
  statusListFor,
  updateHouse,
  type OccupancyStatus,
} from '../lib/houses';
import { cashBalance, monthlyReport, periodTotals } from '../lib/ledger';
import { parseRupiah } from '../lib/money';
import { approvePayment, getPaymentDetail, listPayments, rejectPayment } from '../lib/payments';
import { billingStartConfigured, getSettings, saveSettings } from '../lib/settings';
import { clientIp, errorPage, page } from './shared';

const OCCUPANCY_SELECT_OPTIONS = OCCUPANCY_OPTIONS.map((option) => ({ value: option.value, label: option.label }));

function occupancySelect(selected: string | null, name = 'occupancyStatus'): string {
  return `<select class="input" name="${esc(name)}" id="${esc(name)}">${OCCUPANCY_SELECT_OPTIONS.map(
    (option) =>
      `<option value="${esc(option.value)}"${option.value === selected ? ' selected' : ''}>${esc(option.label)}</option>`,
  ).join('')}</select>`;
}

export function registerAdminRoutes(app: Hono<AppEnv>): void {
  app.get('/admin', async (c) => {
    const settings = await getSettings(c.env.DB);
    const month = currentMonth();
    const [balance, totals, statuses, pending] = await Promise.all([
      cashBalance(c.env.DB, settings),
      periodTotals(c.env.DB, month),
      statusListFor(c.env.DB, settings),
      listPayments(c.env.DB, { status: 'pending', limit: 50 }),
    ]);

    const counts = { lunas: 0, menunggu: 0, sudah: 0, belum: 0, nonaktif: 0 };
    for (const entry of statuses) counts[entry.info.status] += 1;
    const configured = billingStartConfigured(settings);
    const unconfiguredHouses = configured ? 0 : statuses.filter((entry) => entry.house.is_active === 1).length;

    // Alert konfigurasi tepat di bawah judul: role=status karena nonmendesak,
    // ikon aria-hidden, CTA link ke Pengaturan, membungkus sampai 320 px.
    const configAlert = configured
      ? ''
      : `<div class="alert" role="status">${icon('warning')}
        <div class="alert-body">
          <p class="alert-title">Pengaturan tagihan belum lengkap</p>
          <p>Bulan awal tagihan belum ditentukan. Untuk sementara, sistem memakai ${esc(
            monthLabelFull(month),
          )} untuk ${unconfiguredHouses} rumah aktif.</p>
          <p class="alert-actions"><a class="btn btn-primary btn-sm" href="/admin/settings">${icon('settings')}<span>Atur sekarang</span></a></p>
        </div>
      </div>`;

    // Aksi cepat: satu primer dinamis, sisanya sekunder. Semua route valid.
    const primaryAction =
      pending.length > 0
        ? `<a class="btn btn-primary" href="/admin/payments/pending">${icon('inspect')}<span>Verifikasi ${pending.length} pembayaran</span></a>`
        : `<a class="btn btn-primary" href="/admin/expenses">${icon('expenses')}<span>Tambah pengeluaran</span></a>`;
    const quickActions = `
      <section aria-labelledby="aksi-cepat">
        <h2 class="section-title" id="aksi-cepat">Aksi cepat</h2>
        <div class="quick">
          ${primaryAction}
          <a class="btn btn-ghost" href="/admin/houses">${icon('houses')}<span>Kelola rumah</span></a>
          <a class="btn btn-ghost" href="/admin/reports">${icon('reports')}<span>Lihat laporan</span></a>
        </div>
      </section>`;

    // Ringkasan saldo: saldo penuh sebaris di mobile. Saldo awal hanya dari
    // pengaturan, tidak direkayasa. Konteks Rp0 dari data aktual periode ini.
    const balanceContext =
      totals.income === 0 && totals.expense === 0
        ? `<span class="stat-hint">Belum ada transaksi tercatat pada periode ini.</span>`
        : `<span class="stat-hint">Saldo awal ${rupiah(settings.openingBalance)} + pemasukan terverifikasi − pengeluaran.</span>`;
    const balanceSection = `
      <section aria-labelledby="ringkasan-saldo">
        <h2 class="section-title" id="ringkasan-saldo">Ringkasan saldo</h2>
        <div class="grid-balance">
          <div class="stat stat-focus"><span>Saldo kas</span><strong class="num">${rupiah(balance)}</strong>${balanceContext}</div>
          <div class="stat"><span>Pemasukan ${esc(monthLabel(month))}</span><strong class="num">${rupiah(totals.income)}</strong></div>
          <div class="stat"><span>Pengeluaran ${esc(monthLabel(month))}</span><strong class="num">${rupiah(totals.expense)}</strong></div>
        </div>
      </section>`;

    // Status: "Sudah bayar" = sebagian bulan sudah dibayar tetapi belum sampai
    // bulan berjalan, "Lunas" = mencakup bulan berjalan. Penjelasan inline,
    // bukan tooltip hover, supaya terbaca keyboard dan sentuh.
    const statusSection = `
      <section aria-labelledby="status-pembayaran">
        <h2 class="section-title" id="status-pembayaran">Status pembayaran</h2>
        <div class="grid-status">
          <a class="stat stat-link" href="/admin/houses"><span>Belum bayar</span><strong>${counts.belum}</strong><span class="stat-more">Lihat rumah</span></a>
          <a class="stat stat-link" href="/admin/payments/pending"><span>Menunggu verifikasi</span><strong>${counts.menunggu}</strong><span class="stat-hint">Bukti dikirim, menunggu bendahara.</span><span class="stat-more">Verifikasi</span></a>
          <a class="stat stat-link" href="/admin/payments?status=verified"><span>Lunas</span><strong>${counts.lunas}</strong><span class="stat-hint">Sudah bayar sampai ${esc(monthLabel(month))}.</span><span class="stat-more">Riwayat</span></a>
          <div class="stat"><span>Tidak aktif</span><strong>${counts.nonaktif}</strong><span class="stat-hint">Tidak dihitung wajib iuran.</span></div>
        </div>
        <p class="hint">Sebagian bulan sudah dibayar tetapi belum sampai bulan berjalan dihitung di daftar tunggakan di bawah.</p>
      </section>`;

    // Prioritas hari ini: data aktual, tanpa warna bahaya untuk hal tertunda.
    const todoItems = [];
    todoItems.push(
      pending.length > 0
        ? `<li>${icon('pending')}<span><strong>${pending.length} pembayaran</strong> perlu diverifikasi. <a href="/admin/payments/pending">Verifikasi sekarang</a></span></li>`
        : `<li>${icon('approve')}<span>Tidak ada pembayaran yang perlu diverifikasi.</span></li>`,
    );
    const arrearsCount = statuses.filter((entry) => entry.info.unpaidMonths.length > 0).length;
    if (arrearsCount > 0) {
      todoItems.push(
        `<li>${icon('houses')}<span><strong>${arrearsCount} rumah</strong> belum membayar. <a href="#daftar-tunggakan">Lihat daftar</a></span></li>`,
      );
    }
    if (!configured) {
      todoItems.push(
        `<li>${icon('warning')}<span>Pengaturan tagihan belum lengkap. <a href="/admin/settings">Atur sekarang</a></span></li>`,
      );
    }
    const todoSection = `
      <section aria-labelledby="prioritas-hari-ini">
        <h2 class="section-title" id="prioritas-hari-ini">Prioritas hari ini</h2>
        <ul class="todo">${todoItems.join('')}</ul>
      </section>`;

    const pendingTable = table(
      ['Rumah', 'Bulan', 'Nominal', 'Diunggah', 'Aksi'],
      pending.slice(0, 5).map((payment) => [
        `<strong>${esc(payment.block)}</strong>`,
        esc(monthListLabel(payment.months)),
        `<span class="num">${rupiah(payment.amount)}</span>`,
        esc(formatDateID(payment.created_at)),
        `<a class="btn btn-primary btn-sm" href="/admin/payments/pending/${payment.id}" aria-label="Periksa pembayaran ${esc(payment.block)} ${esc(monthListLabel(payment.months))}">${icon(
          'inspect',
        )}<span aria-hidden="true">Periksa</span></a>`,
      ]),
      'Tidak ada pembayaran yang perlu diverifikasi saat ini.',
      { caption: 'Pembayaran yang menunggu verifikasi bendahara' },
    );
    const pendingMore =
      pending.length > 5
        ? `<p><a class="btn btn-ghost btn-sm" href="/admin/payments/pending">${icon('payments')}<span>Lihat semua ${pending.length} pembayaran</span></a></p>`
        : '';

    const arrears = statuses.filter((entry) => entry.info.unpaidMonths.length > 0);
    const arrearsTable = table(
      ['Rumah', 'Periode tertunggak', 'Total tunggakan', 'Aksi'],
      arrears.map((entry) => [
        `<strong>${esc(entry.house.block)}</strong>`,
        `<span data-label="Periode tertunggak">${esc(
          `${monthListLabel(entry.info.unpaidMonths)} (${entry.info.unpaidMonths.length} bulan)`,
        )}</span>`,
        `<span class="num" data-label="Total tunggakan">${rupiah(entry.info.totalDue)}</span>`,
        `<span class="cell-action"><a class="btn btn-ghost btn-sm" href="/admin/houses/${entry.house.id}" aria-label="Lihat detail rumah ${esc(entry.house.block)}">${icon('houses')}<span aria-hidden="true">Lihat detail</span></a></span>`,
      ]),
      'Semua rumah aktif sudah membayar sampai bulan berjalan.',
      { caption: 'Rumah dengan tunggakan iuran', wrapClass: 'arrears-table' },
    );

    const content = `
      <div>
        <h1 class="page-title">Dashboard bendahara</h1>
        <p class="page-sub">Periode ${esc(monthLabelFull(month))}.</p>
      </div>
      ${configAlert}
      ${quickActions}
      ${balanceSection}
      ${statusSection}
      ${todoSection}
      <section aria-labelledby="antrean-verifikasi" class="section-gap">
        <h2 class="section-title" id="antrean-verifikasi">Menunggu verifikasi</h2>
        ${pendingTable}
        ${pendingMore}
      </section>
      <section aria-labelledby="daftar-tunggakan" class="section-gap">
        <h2 class="section-title" id="daftar-tunggakan">Rumah dengan tunggakan</h2>
        ${arrearsTable}
      </section>
    `;
    return page(c, { title: 'Dashboard Bendahara', content, active: '/admin' });
  });

  app.get('/admin/payments/pending', async (c) => {
    const pending = await listPayments(c.env.DB, { status: 'pending', limit: 100 });
    const content = `
      <h1 class="page-title">Menunggu verifikasi</h1>
      <p class="page-sub">Periksa bukti transfer dan nominal sebelum menyetujui.</p>
      ${table(
        ['Rumah', 'Bulan', 'Nominal', 'Diunggah', 'Catatan warga', 'Aksi'],
        pending.map((payment) => [
          `<strong>${esc(payment.block)}</strong>`,
          esc(monthListLabel(payment.months)),
          `<span class="num">${rupiah(payment.amount)}</span>`,
          esc(formatDateID(payment.created_at)),
          esc(payment.note ?? '-'),
          `<a class="btn btn-primary btn-sm" href="/admin/payments/pending/${payment.id}" aria-label="Periksa pembayaran ${esc(payment.block)} ${esc(monthListLabel(payment.months))}">${icon(
            'inspect',
          )}<span aria-hidden="true">Periksa</span></a>`,
        ]),
        'Tidak ada pembayaran yang menunggu verifikasi.',
        { caption: 'Pembayaran yang menunggu verifikasi bendahara' },
      )}
    `;
    return page(c, { title: 'Menunggu Verifikasi', content, active: '/admin/payments/pending' });
  });

  app.get('/admin/payments/pending/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const payment = Number.isInteger(id) ? await getPaymentDetail(c.env.DB, id) : null;
    if (!payment) return errorPage(c, 'Pembayaran tidak ditemukan', 'Periksa kembali tautan yang dibuka.', 404);
    if (payment.status !== 'pending') {
      return page(c, {
        title: 'Pembayaran sudah diproses',
        active: '/admin/payments/pending',
        content: `<h1 class="page-title">Pembayaran #${payment.id}</h1>
          <p class="page-sub">Status saat ini ${badge(payment.status)}. Tidak ada aksi yang bisa dilakukan.</p>
          <a class="btn btn-ghost" href="/admin/payments/pending">${icon('back')}<span>Kembali ke daftar</span></a>`,
      });
    }

    const content = `
      <h1 class="page-title">Verifikasi pembayaran #${payment.id}</h1>
      <div class="grid-cards">
        <div class="stat"><span>Rumah</span><strong style="font-size:16px">${esc(payment.block)}</strong></div>
        <div class="stat"><span>Bulan</span><strong style="font-size:16px">${esc(monthListLabel(payment.months))}</strong></div>
        <div class="stat"><span>Nominal</span><strong>${rupiah(payment.amount)}</strong></div>
        <div class="stat"><span>Diunggah</span><strong style="font-size:16px">${esc(formatDateID(payment.created_at))}</strong></div>
      </div>
      <p class="note">Catatan warga: ${esc(payment.note ?? '-')}</p>
      <div>
        ${
          payment.proof
            ? `<a class="btn btn-ghost" href="/api/files/${payment.proof.id}" target="_blank" rel="noopener">${icon(
                'view',
              )}<span>Lihat bukti transfer (${esc(payment.proof.original_name)})</span></a>`
            : '<span class="hint">Pengajuan ini tidak memiliki file bukti.</span>'
        }
      </div>
      <div class="grid-2">
        <div class="card pad">
          <h3 style="margin-top:0;font-size:15px">Setujui</h3>
          <p class="hint">Saldo kas bertambah, bulan terkait ditandai sudah bayar, dan aktivitas tercatat di audit log.</p>
          <form method="post" action="/admin/payments/${payment.id}/approve">
            <button class="btn btn-primary" type="submit">${icon('approve')}<span>Sudah bayar</span></button>
          </form>
        </div>
        <div class="card pad">
          <h3 style="margin-top:0;font-size:15px">Tolak</h3>
          <form method="post" action="/admin/payments/${payment.id}/reject">
            <label class="label" for="reason">Alasan penolakan</label>
            <input class="input" id="reason" name="reason" maxlength="200" required
                   placeholder="Contoh: nominal transfer tidak sesuai">
            <p class="hint">Bulan kembali menjadi belum dibayar dan warga bisa mengunggah ulang.</p>
            <div style="margin-top:12px">
              <button class="btn btn-danger" type="submit">${icon('reject')}<span>Tolak pengajuan</span></button>
            </div>
          </form>
        </div>
      </div>
      <a class="btn btn-ghost" href="/admin/payments/pending">${icon('back')}<span>Kembali ke daftar</span></a>
    `;
    return page(c, { title: `Verifikasi #${payment.id}`, content, active: '/admin/payments/pending' });
  });

  app.post('/admin/payments/:id/approve', async (c) => {
    const user = c.get('user')!;
    const id = Number(c.req.param('id'));
    const result = await approvePayment(c.env, { paymentId: id, adminId: user.id, ip: clientIp(c) });
    if (!result.ok) return c.redirect(`/admin/payments/pending?err=${encodeURIComponent(result.message)}`);
    return c.redirect(`/admin/payments/pending?ok=${encodeURIComponent('Pembayaran diverifikasi dan saldo kas ditambah.')}`);
  });

  app.post('/admin/payments/:id/reject', async (c) => {
    const user = c.get('user')!;
    const id = Number(c.req.param('id'));
    const form = await c.req.formData();
    const result = await rejectPayment(c.env, {
      paymentId: id,
      adminId: user.id,
      reason: String(form.get('reason') ?? ''),
      ip: clientIp(c),
    });
    if (!result.ok) return c.redirect(`/admin/payments/pending?err=${encodeURIComponent(result.message)}`);
    return c.redirect(`/admin/payments/pending?ok=${encodeURIComponent('Pembayaran ditolak dan bulan kembali belum dibayar.')}`);
  });

  app.get('/admin/payments', async (c) => {
    const statusParam = c.req.query('status');
    const status = statusParam === 'pending' || statusParam === 'verified' || statusParam === 'rejected' ? statusParam : undefined;
    const payments = await listPayments(c.env.DB, { status, limit: 200 });
    const filterLink = (value: string, label: string, iconName: 'history' | 'pending' | 'approve' | 'reject', isActive: boolean) =>
      `<a class="btn ${isActive ? 'btn-primary' : 'btn-ghost'} btn-sm" href="/admin/payments${
        value ? `?status=${value}` : ''
      }"${isActive ? ' aria-current="true"' : ''}>${icon(iconName)}<span>${esc(label)}</span></a>`;

    const content = `
      <h1 class="page-title">Pembayaran</h1>
      <p class="page-sub">Seluruh pengajuan pembayaran warga, termasuk yang sudah diverifikasi dan ditolak.</p>
      <div role="group" aria-label="Filter status pembayaran">${filterLink('', 'Semua', 'history', status === undefined)} ${filterLink('pending', 'Menunggu', 'pending', status === 'pending')} ${filterLink(
        'verified',
        'Diverifikasi',
        'approve',
        status === 'verified',
      )} ${filterLink('rejected', 'Ditolak', 'reject', status === 'rejected')}</div>
      ${table(
        ['Rumah', 'Bulan', 'Nominal', 'Diunggah', 'Status', 'Aksi'],
        payments.map((payment) => [
          `<strong>${esc(payment.block)}</strong>`,
          esc(monthListLabel(payment.months)),
          `<span class="num">${rupiah(payment.amount)}</span>`,
          esc(formatDateID(payment.created_at)),
          badge(payment.status),
          payment.status === 'pending'
            ? `<a class="btn btn-ghost btn-sm" href="/admin/payments/pending/${payment.id}" aria-label="Periksa pembayaran ${esc(payment.block)} ${esc(monthListLabel(payment.months))}">${icon(
                'inspect',
              )}<span aria-hidden="true">Periksa</span></a>`
            : `<a class="btn btn-ghost btn-sm" href="/admin/houses/${payment.house_id}" aria-label="Lihat rumah ${esc(payment.block)}">${icon('houses')}<span aria-hidden="true">Lihat rumah</span></a>`,
        ]),
        'Belum ada pengajuan pembayaran.',
        { caption: 'Seluruh pengajuan pembayaran warga' },
      )}
    `;
    return page(c, { title: 'Pembayaran', content, active: '/admin/payments' });
  });

  app.get('/admin/houses', async (c) => {
    const settings = await getSettings(c.env.DB);
    const statuses = await statusListFor(c.env.DB, settings);
    const content = `
      <h1 class="page-title">Kelola rumah</h1>
      <p class="page-sub">${statuses.length} rumah terdaftar.</p>
      <div>
        <a class="btn btn-primary" href="/admin/houses/new">${icon('add')}<span>Tambah rumah</span></a>
        <a class="btn btn-ghost" href="/admin/houses/import">${icon('importCsv')}<span>Import CSV</span></a>
      </div>
      ${table(
        ['Kode rumah', 'Status huni', 'Aktif iuran', 'Status bayar', 'Keterangan', 'Aksi'],
        statuses.map((entry) => [
          `<strong>${esc(entry.house.house_code)}</strong><br><span class="hint">${esc(entry.house.owner_name ?? 'nama pemilik belum diisi')}</span>`,
          esc(occupancyLabel(entry.house.occupancy_status)),
          entry.house.is_active === 1 ? 'Ya' : 'Tidak',
          badge(entry.info.status),
          esc(entry.info.note),
          `<a class="btn btn-ghost btn-sm" href="/admin/houses/${entry.house.id}" aria-label="Kelola rumah ${esc(entry.house.house_code)}">${icon('edit')}<span aria-hidden="true">Kelola</span></a>`,
        ]),
        'Belum ada rumah. Tambahkan satu per satu atau import CSV.',
        { caption: 'Daftar rumah dan status iuran' },
      )}
    `;
    return page(c, { title: 'Kelola Rumah', content, active: '/admin/houses' });
  });

  app.get('/admin/houses/new', (c) => {
    const content = `
      <h1 class="page-title">Tambah rumah</h1>
      <p class="page-sub">Akun warga dibuat otomatis dengan password default dan wajib diganti saat login pertama.</p>
      <form method="post" action="/admin/houses" class="card pad">
        <div class="grid-2">
          <div>
            <label class="label" for="houseType">Jenis rumah</label>
            <input class="input" id="houseType" name="houseType" required maxlength="40" placeholder="Contoh: Lupine">
          </div>
          <div>
            <label class="label" for="block">Blok</label>
            <input class="input" id="block" name="block" required maxlength="20" placeholder="Contoh: C4/06">
          </div>
        </div>
        <div class="grid-2" style="margin-top:12px">
          <div>
            <label class="label" for="occupancyStatus">Status huni</label>
            ${occupancySelect('berpenghuni')}
          </div>
          <div>
            <label class="label" for="ownerName">Nama pemilik (hanya terlihat bendahara)</label>
            <input class="input" id="ownerName" name="ownerName" maxlength="80">
          </div>
        </div>
        <div style="margin-top:12px">
          <label class="label" for="billingStartMonth">Bulan awal tagihan rumah ini (opsional)</label>
          <input class="input" id="billingStartMonth" name="billingStartMonth" type="month">
          <p class="hint">Kosongkan untuk mengikuti pengaturan global.</p>
        </div>
        <div style="margin-top:12px">
          <label class="label" for="notes">Catatan (opsional)</label>
          <input class="input" id="notes" name="notes" maxlength="200">
        </div>
        <div style="margin-top:8px">
          <label class="check-row">
            <input type="checkbox" name="isActive" value="1" checked> Dihitung sebagai wajib iuran
          </label>
        </div>
        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">${icon('save')}<span>Simpan rumah</span></button>
          <a class="btn btn-ghost" href="/admin/houses">${icon('back')}<span>Batal</span></a>
        </div>
      </form>
    `;
    return page(c, { title: 'Tambah Rumah', content, active: '/admin/houses' });
  });

  app.post('/admin/houses', async (c) => {
    const user = c.get('user')!;
    const form = await c.req.formData();
    const houseType = String(form.get('houseType') ?? '').trim();
    const block = String(form.get('block') ?? '').trim();
    if (!houseType || !block) {
      return c.redirect(`/admin/houses/new?err=${encodeURIComponent('Jenis rumah dan blok wajib diisi.')}`);
    }
    if (/\s/.test(houseType) || /\s/.test(block)) {
      return c.redirect(`/admin/houses/new?err=${encodeURIComponent('Jenis rumah dan blok tidak boleh mengandung spasi.')}`);
    }

    const result = await createHouse(
      c.env,
      {
        houseType,
        block,
        occupancyStatus: String(form.get('occupancyStatus') ?? 'berpenghuni') as OccupancyStatus,
        isActive: form.get('isActive') === '1',
        ownerName: String(form.get('ownerName') ?? ''),
        notes: String(form.get('notes') ?? ''),
        billingStartMonth: String(form.get('billingStartMonth') ?? ''),
      },
      user.id,
      clientIp(c),
    );
    const content = `

      <h1 class="page-title">Rumah ${esc(result.houseCode)} tersimpan</h1>
      <p class="page-sub">Sampaikan kredensial awal ini ke penghuni. Password wajib diganti saat login pertama.</p>
      <div class="card pad">
        <p><strong>Username:</strong> ${esc(result.houseCode)}</p>
        <p><strong>Password awal:</strong> <span class="num">${esc(result.defaultPassword)}</span></p>
        <p class="hint">Password awal dibentuk dari kata "Bagarry" ditambah blok rumah.</p>
      </div>
      <div>
        <a class="btn btn-primary" href="/admin/houses/${result.houseId}">${icon('houses')}<span>Buka detail rumah</span></a>
        <a class="btn btn-ghost" href="/admin/houses">${icon('back')}<span>Kembali ke daftar rumah</span></a>
      </div>
    `;
    return page(c, { title: 'Rumah Tersimpan', content, active: '/admin/houses' });
  });

  app.get('/admin/houses/import', (c) => {
    const content = `
      <h1 class="page-title">Import CSV rumah</h1>
      <p class="page-sub">Satu rumah per baris. Akun warga dibuat otomatis untuk setiap rumah baru.</p>
      <form method="post" action="/admin/houses/import" class="card pad">
        <label class="label" for="csv">Isi CSV</label>
        <textarea class="input" id="csv" name="csv" rows="10" required
          style="min-height:200px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace"
          placeholder="jenis_rumah,blok,status_huni,aktif,nama_pemilik&#10;Lupine,C4/06,berpenghuni,1,Budi"></textarea>
        <p class="hint">Kolom: jenis_rumah, blok, status_huni (berpenghuni/kosong/tanah_kosong/belum_dihuni), aktif (1/0, ya/tidak), nama_pemilik (opsional). Baris header opsional.</p>
        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">${icon('search')}<span>Periksa data</span></button>
          <a class="btn btn-ghost" href="/admin/houses">${icon('back')}<span>Batal</span></a>
        </div>
      </form>
    `;
    return page(c, { title: 'Import CSV', content, active: '/admin/houses' });
  });

  app.post('/admin/houses/import', async (c) => {
    const form = await c.req.formData();
    const csv = String(form.get('csv') ?? '');
    const parsed = parseHouseCsv(csv);

    const errorTable = parsed.errors.length
      ? table(
          ['Baris', 'Masalah'],
          parsed.errors.map((error) => [`${error.line}`, esc(error.message)]),
          '',
        )
      : '';

    const content = `
      <h1 class="page-title">Pratinjau import</h1>
      <p class="page-sub">${parsed.rows.length} rumah siap dibuat, ${parsed.errors.length} baris bermasalah.</p>
      ${
        parsed.rows.length
          ? table(
              ['Baris', 'Kode rumah', 'Status huni', 'Aktif iuran', 'Nama pemilik'],
              parsed.rows.map((row) => [
                `${row.line}`,
                `<strong>${esc(`${row.houseType}-${row.block}`)}</strong>`,
                esc(occupancyLabel(row.occupancyStatus)),
                row.isActive ? 'Ya' : 'Tidak',
                esc(row.ownerName ?? '-'),
              ]),
              '',
            )
          : emptyState('Tidak ada baris valid untuk diimport.', {
              href: '/admin/houses/import',
              label: 'Perbaiki CSV',
              iconName: 'edit',
            })
      }
      ${parsed.errors.length ? `<h2 class="section-title">Baris yang dilewati</h2>${errorTable}` : ''}
      ${
        parsed.rows.length
          ? `<form method="post" action="/admin/houses/import/confirm">
              <input type="hidden" name="csv" value="${esc(csv)}">
              <button class="btn btn-primary" type="submit">${icon('add')}<span>Buat ${
                parsed.rows.length
              } rumah sekarang</span></button>
              <a class="btn btn-ghost" href="/admin/houses/import">${icon('edit')}<span>Ubah CSV</span></a>
            </form>`
          : ''
      }
    `;
    return page(c, { title: 'Pratinjau Import', content, active: '/admin/houses' });
  });

  app.post('/admin/houses/import/confirm', async (c) => {
    const user = c.get('user')!;
    const form = await c.req.formData();
    const parsed = parseHouseCsv(String(form.get('csv') ?? ''));
    if (parsed.rows.length === 0) {
      return c.redirect(`/admin/houses/import?err=${encodeURIComponent('Tidak ada baris valid untuk diimport.')}`);
    }
    const report = await importHouses(c.env, parsed.rows, user.id, clientIp(c));

    const content = `
      <h1 class="page-title">Hasil import</h1>
      <p class="page-sub">${report.created.length} rumah dibuat, ${report.errors.length} gagal.</p>
      ${
        report.created.length
          ? table(
              ['Kode rumah dibuat'],
              report.created.map((code) => [`<strong>${esc(code)}</strong>`]),
              '',
            )
          : ''
      }
      ${
        report.errors.length
          ? `<h2 class="section-title">Gagal dibuat</h2>${table(
              ['Baris', 'Masalah'],
              report.errors.map((error) => [`${error.line}`, esc(error.message)]),
              '',
            )}`
          : ''
      }
      <p class="note">Password awal tiap akun adalah "Bagarry" + blok rumah, dan wajib diganti saat login pertama.</p>
      <a class="btn btn-primary" href="/admin/houses">${icon('back')}<span>Kembali ke daftar rumah</span></a>
    `;
    return page(c, { title: 'Hasil Import', content, active: '/admin/houses' });
  });

  app.get('/admin/houses/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const house = Number.isInteger(id) ? await getHouse(c.env.DB, id) : null;
    if (!house) return errorPage(c, 'Rumah tidak ditemukan', 'Periksa kembali tautan yang dibuka.', 404);

    const settings = await getSettings(c.env.DB);
    const statuses = await statusListFor(c.env.DB, settings);
    const entry = statuses.find((item) => item.house.id === house.id);
    const info = entry?.info;
    const payments = await listPayments(c.env.DB, { houseId: house.id, limit: 50 });

    const content = `
      <h1 class="page-title">${esc(house.house_code)}</h1>
      <p class="page-sub">${esc(occupancyLabel(house.occupancy_status))} · ${
        house.is_active === 1 ? 'dihitung wajib iuran' : 'tidak dihitung wajib iuran'
      }</p>
      <div class="grid-cards">
        <div class="stat"><span>Status pembayaran</span><strong style="font-size:16px">${info ? badge(info.status) : '-'}</strong></div>
        <div class="stat"><span>Sudah dibayar sampai</span><strong style="font-size:16px">${esc(
          info?.paidUntil ? monthLabel(info.paidUntil) : '-',
        )}</strong></div>
        <div class="stat"><span>Belum dibayar</span><strong style="font-size:16px">${esc(
          info && info.unpaidMonths.length ? monthListLabel(info.unpaidMonths) : '-',
        )}</strong></div>
        <div class="stat"><span>Total tagihan</span><strong>${rupiah(info?.totalDue ?? 0)}</strong></div>
      </div>
      <form method="post" action="/admin/houses/${house.id}" class="card pad">
        <h3 style="margin-top:0;font-size:15px">Ubah data rumah</h3>
        <p class="hint" style="margin-bottom:12px">Kode rumah (username warga) tidak diubah dari halaman ini: ${esc(
          house.house_code,
        )}</p>
        <div class="grid-2">
          <div>
            <label class="label" for="occupancyStatus">Status huni</label>
            ${occupancySelect(house.occupancy_status)}
          </div>
          <div>
            <label class="label" for="ownerName">Nama pemilik (hanya bendahara)</label>
            <input class="input" id="ownerName" name="ownerName" maxlength="80" value="${esc(house.owner_name ?? '')}">
          </div>
        </div>
        <div class="grid-2" style="margin-top:12px">
          <div>
            <label class="label" for="billingStartMonth">Bulan awal tagihan rumah ini</label>
            <input class="input" id="billingStartMonth" name="billingStartMonth" type="month"
              value="${esc(house.billing_start_month ?? '')}">
          </div>
          <div>
            <label class="label" for="notes">Catatan</label>
            <input class="input" id="notes" name="notes" maxlength="200" value="${esc(house.notes ?? '')}">
          </div>
        </div>
        <div style="margin-top:8px">
          <label class="check-row">
            <input type="checkbox" name="isActive" value="1"${house.is_active === 1 ? ' checked' : ''}> Dihitung sebagai wajib iuran
          </label>
        </div>
        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">${icon('save')}<span>Simpan perubahan</span></button>
          <a class="btn btn-ghost" href="/admin/houses">${icon('back')}<span>Kembali</span></a>
        </div>
      </form>
      <div class="card pad">
        <h3 style="margin-top:0;font-size:15px">Reset password akun rumah</h3>
        <p class="hint">Password kembali ke password default "Bagarry" + blok dan wajib diganti saat login berikutnya.</p>
        <form method="post" action="/admin/houses/${house.id}/reset-password">
          <button class="btn btn-ghost" type="submit">${icon('resetPassword')}<span>Reset ke password default</span></button>
        </form>
      <h2 class="section-title" id="riwayat-rumah">Riwayat pembayaran rumah</h2>
      ${table(
        ['Tanggal', 'Bulan', 'Nominal', 'Status'],
        payments.map((payment) => [
          esc(formatDateID(payment.created_at)),
          esc(monthListLabel(payment.months)),
          `<span class="num">${rupiah(payment.amount)}</span>`,
          badge(payment.status),
        ]),
        'Belum ada pengajuan pembayaran dari rumah ini.',
        { caption: 'Riwayat pembayaran rumah ini' },
      )}
    `;
    return page(c, { title: `Rumah ${house.block}`, content, active: '/admin/houses' });
  });

  app.post('/admin/houses/:id', async (c) => {
    const user = c.get('user')!;
    const id = Number(c.req.param('id'));
    const form = await c.req.formData();
    const result = await updateHouse(
      c.env,
      id,
      {
        occupancyStatus: String(form.get('occupancyStatus') ?? 'berpenghuni') as OccupancyStatus,
        isActive: form.get('isActive') === '1',
        ownerName: String(form.get('ownerName') ?? ''),
        notes: String(form.get('notes') ?? ''),
        billingStartMonth: String(form.get('billingStartMonth') ?? ''),
      },
      user.id,
      clientIp(c),
    );
    if (!result.ok) return c.redirect(`/admin/houses/${id}?err=${encodeURIComponent(result.message)}`);
    return c.redirect(`/admin/houses/${id}?ok=${encodeURIComponent('Data rumah diperbarui.')}`);
  });

  app.post('/admin/houses/:id/reset-password', async (c) => {
    const user = c.get('user')!;
    const id = Number(c.req.param('id'));
    const result = await resetResidentPassword(c.env, id, user.id, clientIp(c));
    if (!result.ok) return c.redirect(`/admin/houses/${id}?err=${encodeURIComponent(result.message)}`);
    return page(c, {
      title: 'Password Direset',
      active: '/admin/houses',
      content: `<h1 class="page-title">Password akun direset</h1>
        <p class="page-sub">Sampaikan password sementara ini ke penghuni. Wajib diganti saat login berikutnya.</p>
        <div class="card pad"><p><strong>Password sementara:</strong> <span class="num">${esc(result.password)}</span></p></div>
        <a class="btn btn-primary" href="/admin/houses/${id}">${icon('back')}<span>Kembali ke detail rumah</span></a>`,
    });
  });

  app.get('/admin/expenses', async (c) => {
    const expenses = await listExpenses(c.env.DB);
    const content = `
      <h1 class="page-title">Pengeluaran kas</h1>
      <p class="page-sub">Setiap pengeluaran otomatis mengurangi saldo kas dan masuk ke laporan bulan berjalan.</p>
      <form method="post" action="/admin/expenses" enctype="multipart/form-data" class="card pad">
        <h3 style="margin-top:0;font-size:15px">Tambah pengeluaran</h3>
        <div class="grid-2">
          <div>
            <label class="label" for="expenseDate">Tanggal</label>
            <input class="input" id="expenseDate" name="expenseDate" type="date" value="${esc(jakartaDate())}" required>
          </div>
          <div>
            <label class="label" for="amount">Nominal (Rupiah)</label>
            <input class="input" id="amount" name="amount" inputmode="numeric" required placeholder="Contoh: 350000">
          </div>
        </div>
        <div style="margin-top:12px">
          <label class="label" for="description">Keterangan</label>
          <input class="input" id="description" name="description" required maxlength="200"
                 placeholder="Contoh: perbaikan lampu jalan blok C">
        </div>
        <div style="margin-top:12px">
          <label class="label" for="proof">Bukti pengeluaran (opsional, JPG/PNG/PDF maksimal 5 MB)</label>
          <input class="input" id="proof" name="proof" type="file" accept="image/jpeg,image/png,application/pdf">
        </div>
        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">${icon('save')}<span>Simpan pengeluaran</span></button>
        </div>
      </form>
      ${table(
        ['Tanggal', 'Keterangan', 'Nominal', 'Bukti', 'Aksi'],
        expenses.map((expense) => [
          esc(formatDateID(expense.expense_date)),
          esc(expense.description),
          `<span class="num">${rupiah(expense.amount)}</span>`,
          expense.proof_file_id ? 'Ada' : '-',
          `<a class="btn btn-ghost btn-sm" href="/admin/expenses/${expense.id}" aria-label="Detail pengeluaran ${esc(formatDateID(expense.expense_date))} ${esc(expense.description)}">${icon('view')}<span aria-hidden="true">Detail</span></a>`,
        ]),
        'Belum ada pengeluaran tercatat.',
        { caption: 'Daftar pengeluaran kas' },
      )}
    `;
    return page(c, { title: 'Pengeluaran', content, active: '/admin/expenses' });
  });

  app.post('/admin/expenses', async (c) => {
    const user = c.get('user')!;
    const form = await c.req.formData();
    const description = String(form.get('description') ?? '').trim();
    const amount = parseRupiah(String(form.get('amount') ?? ''));
    const expenseDate = String(form.get('expenseDate') ?? '') || jakartaDate();
    const fileValue = form.get('proof');

    if (!description) {
      return c.redirect(`/admin/expenses?err=${encodeURIComponent('Keterangan wajib diisi.')}`);
    }
    if (amount === null || amount <= 0) {
      return c.redirect(`/admin/expenses?err=${encodeURIComponent('Nominal pengeluaran tidak valid.')}`);
    }
    if (!isMonth(expenseDate.slice(0, 7)) || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      return c.redirect(`/admin/expenses?err=${encodeURIComponent('Tanggal pengeluaran tidak valid.')}`);
    }

    let fileId: number | null = null;
    const hasFile = fileValue instanceof File && fileValue.size > 0;
    if (hasFile) {
      const check = validateUploadFile(fileValue as File);
      if (!check.ok) return c.redirect(`/admin/expenses?err=${encodeURIComponent(check.message)}`);
      const stored = await storeFile(c.env, { file: fileValue as File, fileType: 'expense_proof', userId: user.id });
      fileId = stored.id;
    }

    try {
      await createExpense(c.env, {
        expenseDate,
        description,
        amount,
        fileId,
        userId: user.id,
        ip: clientIp(c),
      });
    } catch {
      if (fileId) await deleteFile(c.env, fileId);
      return c.redirect(`/admin/expenses?err=${encodeURIComponent('Gagal menyimpan pengeluaran.')}`);
    }

    return c.redirect(`/admin/expenses?ok=${encodeURIComponent('Pengeluaran tersimpan dan saldo kas berkurang.')}`);
  });

  app.get('/admin/expenses/:id', async (c) => {
    const id = Number(c.req.param('id'));
    const expense = Number.isInteger(id) ? await getExpense(c.env.DB, id) : null;
    if (!expense) return errorPage(c, 'Pengeluaran tidak ditemukan', 'Periksa kembali tautan yang dibuka.', 404);

    const creator = expense.created_by
      ? await c.env.DB.prepare(
          `SELECT u.role, h.block FROM users u LEFT JOIN houses h ON h.id = u.house_id WHERE u.id = ?`,
        )
          .bind(expense.created_by)
          .first<{ role: string; block: string | null }>()
      : null;

    const content = `
      <h1 class="page-title">Detail pengeluaran #${expense.id}</h1>
      <div class="grid-cards">
        <div class="stat"><span>Tanggal</span><strong style="font-size:16px">${esc(formatDateID(expense.expense_date))}</strong></div>
        <div class="stat stat-focus"><span>Nominal</span><strong>${rupiah(expense.amount)}</strong></div>
      </div>
      <p class="note">Keterangan: ${esc(expense.description)}</p>
      <p class="hint">Dicatat oleh ${esc(creator?.role === 'admin' ? 'Bendahara' : creator?.block ?? 'tidak diketahui')} pada ${esc(
        formatDateTimeID(expense.created_at),
      )} WIB.</p>
      <div>
        ${
          expense.proof_file_id
            ? `<a class="btn btn-ghost" href="/api/files/${expense.proof_file_id}" target="_blank" rel="noopener">${icon(
                'view',
              )}<span>Lihat bukti pengeluaran</span></a>`
            : '<span class="hint">Tidak ada bukti pengeluaran yang diunggah.</span>'
        }
      </div>
      <a class="btn btn-ghost" href="/admin/expenses">${icon('back')}<span>Kembali ke daftar pengeluaran</span></a>
    `;
    return page(c, { title: `Pengeluaran #${expense.id}`, content, active: '/admin/expenses' });
  });

  app.get('/admin/reports', async (c) => {
    const settings = await getSettings(c.env.DB);
    const monthParam = c.req.query('month');
    const month = monthParam && isMonth(monthParam) ? monthParam : currentMonth();
    const report = await monthlyReport(c.env.DB, settings, month);
    const content = `

      <h1 class="page-title">Laporan kas</h1>
      <p class="page-sub">Rekap pemasukan dan pengeluaran per bulan.</p>
      <form method="get" action="/admin/reports" class="card pad">
        <label class="label" for="month">Bulan laporan</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <input class="input" id="month" name="month" type="month" value="${esc(month)}" style="max-width:220px">
          <button class="btn btn-primary" type="submit">${icon('search')}<span>Tampilkan</span></button>
        </div>
      </form>
      <h2 class="section-title">${esc(monthLabel(month))}</h2>
      <div class="grid-cards">
        <div class="stat"><span>Saldo awal</span><strong>${rupiah(report.openingBalance)}</strong></div>
        <div class="stat"><span>Pemasukan</span><strong>${rupiah(report.income)}</strong></div>
        <div class="stat"><span>Pengeluaran</span><strong>${rupiah(report.expense)}</strong></div>
        <div class="stat stat-focus"><span>Saldo akhir</span><strong>${rupiah(report.closingBalance)}</strong></div>
      </div>
      <h2 class="section-title">Pemasukan terverifikasi</h2>
      ${table(
        ['Tanggal', 'Rumah', 'Bulan dibayar', 'Nominal'],
        report.incomeRows.map((row) => [
          esc(formatDateID(row.entry_date)),
          esc(row.block ?? '-'),
          esc(monthListLabel(row.months)),
          `<span class="num">${rupiah(row.amount)}</span>`,
        ]),
        'Tidak ada pemasukan pada bulan ini.',
        { caption: 'Pemasukan terverifikasi bulan laporan' },
      )}
      <h2 class="section-title">Pengeluaran</h2>
      ${table(
        ['Tanggal', 'Keterangan', 'Nominal'],
        report.expenseRows.map((row) => [
          esc(formatDateID(row.entry_date)),
          esc(row.description),
          `<span class="num">${rupiah(row.amount)}</span>`,
        ]),
        'Tidak ada pengeluaran pada bulan ini.',
        { caption: 'Pengeluaran bulan laporan' },
      )}
      <p class="note">${icon('info')}Saldo awal = saldo awal pengaturan + seluruh arus kas sebelum ${esc(monthLabel(month))}.</p>
    `;
    return page(c, { title: 'Laporan', content, active: '/admin/reports' });
  });

  app.get('/admin/settings', async (c) => {
    const settings = await getSettings(c.env.DB);
    const content = `
      <h1 class="page-title">Pengaturan</h1>
      <p class="page-sub">Perubahan berlaku untuk transaksi berikutnya, transaksi lama tidak berubah.</p>
      ${
        billingStartConfigured(settings)
          ? ''
          : `<p class="flash flash-err">Bulan awal tagihan global belum diatur, sistem untuk sementara memakai bulan berjalan.</p>`
      }
      <form method="post" action="/admin/settings" class="card pad">
        <div class="grid-2">
          <div>
            <label class="label" for="monthlyFee">Nominal iuran bulanan (Rupiah)</label>
            <input class="input" id="monthlyFee" name="monthlyFee" inputmode="numeric" required
                   value="${esc(String(settings.monthlyFee))}">
          </div>
          <div>
            <label class="label" for="openingBalance">Saldo awal kas (Rupiah)</label>
            <input class="input" id="openingBalance" name="openingBalance" inputmode="numeric" required
                   value="${esc(String(settings.openingBalance))}">
          </div>
        </div>
        <div class="grid-2" style="margin-top:12px">
          <div>
            <label class="label" for="openingBalanceDate">Tanggal saldo awal</label>
            <input class="input" id="openingBalanceDate" name="openingBalanceDate" type="date"
                   value="${esc(settings.openingBalanceDate)}">
          </div>
          <div>
            <label class="label" for="globalBillingStartMonth">Bulan awal tagihan global</label>
            <input class="input" id="globalBillingStartMonth" name="globalBillingStartMonth" type="month"
                   value="${esc(settings.globalBillingStartMonth)}">
            <p class="hint">Menentukan sejak kapan semua rumah dihitung wajib iuran. Bisa di-override per rumah.</p>
          </div>
        </div>
        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">${icon('save')}<span>Simpan pengaturan</span></button>
        </div>
      </form>
    `;
    return page(c, { title: 'Pengaturan', content, active: '/admin/settings' });
  });

  app.post('/admin/settings', async (c) => {
    const form = await c.req.formData();
    const fee = parseRupiah(String(form.get('monthlyFee') ?? ''));
    const opening = parseRupiah(String(form.get('openingBalance') ?? ''));
    const openingDate = String(form.get('openingBalanceDate') ?? '');
    const globalStart = String(form.get('globalBillingStartMonth') ?? '');

    if (fee === null || fee < 0) {
      return c.redirect(`/admin/settings?err=${encodeURIComponent('Nominal iuran tidak valid.')}`);
    }
    if (opening === null || opening < 0) {
      return c.redirect(`/admin/settings?err=${encodeURIComponent('Saldo awal tidak valid.')}`);
    }
    if (globalStart && !isMonth(globalStart)) {
      return c.redirect(`/admin/settings?err=${encodeURIComponent('Bulan awal tagihan tidak valid.')}`);
    }
    if (openingDate && !/^\d{4}-\d{2}-\d{2}$/.test(openingDate)) {
      return c.redirect(`/admin/settings?err=${encodeURIComponent('Tanggal saldo awal tidak valid.')}`);
    }

    const before = await getSettings(c.env.DB);
    await saveSettings(c.env.DB, {
      monthly_fee: String(fee),
      opening_balance: String(opening),
      opening_balance_date: openingDate,
      global_billing_start_month: globalStart,
    });
    await c.env.DB.prepare(
      `INSERT INTO audit_logs (actor_id, action, entity_type, old_values, new_values, ip_address)
       VALUES (?, 'update_settings', 'settings', ?, ?, ?)`,
    )
      .bind(
        c.get('user')!.id,
        JSON.stringify(before),
        JSON.stringify({
          monthlyFee: fee,
          openingBalance: opening,
          openingBalanceDate: openingDate,
          globalBillingStartMonth: globalStart,
        }),
        clientIp(c),
      )
      .run();

    return c.redirect(`/admin/settings?ok=${encodeURIComponent('Pengaturan tersimpan.')}`);
  });

  app.get('/admin/audit', async (c) => {
    const logs = await listAuditLogs(c.env.DB, 150);
    const content = `
      <h1 class="page-title">Audit log</h1>
      <p class="page-sub">150 aktivitas terakhir. Log hanya bisa dibaca, tidak bisa diubah dari aplikasi.</p>
      <div class="audit-table">${table(
        ['Waktu', 'Aktor', 'Aksi', 'Entity', 'Perubahan', 'IP'],
        logs.map((log) => [
          esc(formatDateTimeID(log.created_at)),
          esc(actorLabel(log)),
          esc(actionLabel(log.action)),
          log.entity_id ? `${esc(log.entity_type ?? '-')} #${log.entity_id}` : esc(log.entity_type ?? '-'),
          esc(changeSummary(log)),
          esc(log.ip_address ?? '-'),
        ]),
        'Belum ada aktivitas tercatat.',
      )}</div>
    `;
    return page(c, { title: 'Audit Log', content, active: '/admin/audit' });
  });
}
