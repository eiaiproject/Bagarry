import type { Hono } from 'hono';
import type { AppEnv } from '../types';
import { formatDateID, monthLabel, monthListLabel } from '../lib/date';
import { deleteFile, storeFile, validateUploadFile } from '../lib/files';
import { badge, emptyState, esc, rupiah, table } from '../lib/html';
import { icon } from '../lib/icons';
import { getHouse, occupancyLabel, statusForHouse } from '../lib/houses';
import { createPaymentSubmission, getPaymentDetail, listPayments, validateMonthSelection } from '../lib/payments';
import { getSettings } from '../lib/settings';
import { clientIp, errorPage, page } from './shared';

export function registerWargaRoutes(app: Hono<AppEnv>): void {
  app.get('/warga', async (c) => {
    const user = c.get('user')!;
    const house = await getHouse(c.env.DB, user.houseId!);
    if (!house) return errorPage(c, 'Rumah tidak ditemukan', 'Hubungi bendahara untuk memperbaiki data rumah.', 404);

    const settings = await getSettings(c.env.DB);
    const info = await statusForHouse(c.env.DB, house, settings);
    const payments = await listPayments(c.env.DB, { houseId: house.id, limit: 5 });

    const summary = `<div class="grid-cards">
      <div class="stat"><span>Status rumah</span><strong style="font-size:16px">${esc(occupancyLabel(house.occupancy_status))}</strong></div>
      <div class="stat"><span>Status pembayaran</span><strong style="font-size:16px">${badge(info.status)}</strong></div>
      <div class="stat"><span>Sudah bayar sampai</span><strong style="font-size:16px">${esc(
        info.paidUntil ? monthLabel(info.paidUntil) : '-',
      )}</strong></div>
      <div class="stat"><span>Belum dibayar</span><strong style="font-size:16px">${esc(
        info.unpaidMonths.length ? monthListLabel(info.unpaidMonths) : '-',
      )}</strong></div>
    </div>`;

    const due = `<div class="grid-cards">
      <div class="stat stat-focus"><span>Total tagihan saat ini</span><strong>${rupiah(info.totalDue)}</strong></div>
      <div class="stat"><span>Nominal iuran</span><strong>${rupiah(settings.monthlyFee)}</strong><span style="margin-top:6px">per bulan</span></div>
    </div>`;

    const actions = info.unpaidMonths.length
      ? `<a class="btn btn-primary" href="/warga/pembayaran">${icon('upload')}<span>Upload bukti transfer</span></a>
         <a class="btn btn-ghost" href="/warga/riwayat">${icon('history')}<span>Lihat riwayat</span></a>`
      : `<a class="btn btn-ghost" href="/warga/riwayat">${icon('history')}<span>Lihat riwayat</span></a>`;

    const recent = table(
      ['Tanggal', 'Bulan', 'Nominal', 'Status'],
      payments.map((payment) => [
        esc(formatDateID(payment.created_at)),
        esc(monthListLabel(payment.months)),
        `<span class="num">${rupiah(payment.amount)}</span>`,
        badge(payment.status),
      ]),
      'Belum ada pengajuan pembayaran dari rumah ini.',
      { caption: 'Pengajuan pembayaran terakhir rumah ini' },
    );

    const content = `
      <div>
        <h1 class="page-title">Halo, ${esc(house.block)}</h1>
        <p class="page-sub">${esc(house.house_type)} · kode akun ${esc(house.house_code)} · ${esc(info.note)}</p>
      </div>
      ${summary}
      ${due}
      <div>${actions}</div>
      <div>
        <h2 class="section-title">Pengajuan terakhir</h2>
      </div>
      ${recent}
      ${
        info.pendingMonths.length
          ? `<p class="note">${icon('waiting')}Bukti transfer untuk ${esc(
              monthListLabel(info.pendingMonths),
            )} sedang diperiksa bendahara. Saldo kas bertambah setelah diverifikasi.</p>`
          : ''
      }
    `;
    return page(c, { title: `Dashboard ${house.block}`, content, active: '/warga' });
  });

  app.get('/warga/pembayaran', async (c) => {
    const user = c.get('user')!;
    const house = await getHouse(c.env.DB, user.houseId!);
    if (!house) return errorPage(c, 'Rumah tidak ditemukan', 'Hubungi bendahara untuk memperbaiki data rumah.', 404);

    const settings = await getSettings(c.env.DB);
    const info = await statusForHouse(c.env.DB, house, settings);

    if (info.unpaidMonths.length === 0) {
      return page(c, {
        title: 'Bayar Iuran',
        active: '/warga/pembayaran',
        content: `<h1 class="page-title">Bayar iuran</h1>
          ${emptyState('Tidak ada bulan yang perlu dibayar.', {
            href: '/warga/riwayat',
            label: 'Lihat riwayat pembayaran',
            iconName: 'history',
          })}`,

      });
    }

    const checks = info.unpaidMonths
      .map(
        (month, index) => `<label class="month-row">
          <input type="checkbox" name="months" value="${esc(month)}"${index === 0 ? ' checked' : ''}>
          <span>${esc(monthLabel(month))}</span>
        </label>`,
      )
      .join('');

    const content = `
      <div>
        <h1 class="page-title">Upload bukti transfer</h1>
        <p class="page-sub">Bulan harus dipilih berurutan mulai tunggakan terlama. Pembayaran boleh rapel.</p>
      </div>
      <form method="post" action="/warga/pembayaran" enctype="multipart/form-data" class="card pad">
        <fieldset style="border:0;padding:0;margin:0">
          <legend class="label">Bulan yang belum dibayar</legend>
          <div class="month-list">${checks}</div>
        </fieldset>
        <div class="grid-cards" style="margin-top:16px">
          <div class="stat"><span>Nominal per bulan</span><strong>${rupiah(settings.monthlyFee)}</strong></div>
          <div class="stat"><span>Jumlah bulan</span><strong id="month-count">1</strong></div>
          <div class="stat stat-focus"><span>Total pembayaran</span><strong id="total-amount">${rupiah(
            settings.monthlyFee,
          )}</strong></div>
        </div>
        <div style="margin-top:16px">
          <label class="label" for="proof">Bukti transfer (JPG, PNG, atau PDF, maksimal 5 MB)</label>
          <input class="input" id="proof" name="proof" type="file" accept="image/jpeg,image/png,application/pdf" required>
        </div>
        <div style="margin-top:12px">
          <label class="label" for="note">Catatan (opsional)</label>
          <input class="input" id="note" name="note" maxlength="200" placeholder="Contoh: transfer dari BCA">
        </div>
        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">${icon('send')}<span>Kirim bukti</span></button>
          <a class="btn btn-ghost" href="/warga">${icon('back')}<span>Batal</span></a>
        </div>
        <p class="hint">Setelah dikirim, pengajuan berstatus Menunggu Verifikasi dan tidak bisa diubah warga.</p>
      </form>
      <script>
        (function () {
          var fee = ${settings.monthlyFee};
          var boxes = Array.prototype.slice.call(document.querySelectorAll('input[name="months"]'));
          var countEl = document.getElementById('month-count');
          var totalEl = document.getElementById('total-amount');
          function rupiah(n) {
            return 'Rp' + String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g, '.');
          }
          function render() {
            boxes.forEach(function (box, index) {
              var prevChecked = index === 0 || boxes[index - 1].checked;
              if (!prevChecked && !box.checked) box.disabled = true;
              else box.disabled = false;
              if (!prevChecked && box.checked) box.checked = false;
            });
            var selected = boxes.filter(function (box) { return box.checked; }).length;
            countEl.textContent = String(selected);
            totalEl.textContent = rupiah(selected * fee);
          }
          boxes.forEach(function (box) { box.addEventListener('change', render); });
          render();
        })();
      </script>
      <style>
        .month-list { display:grid; gap:6px; grid-template-columns:repeat(auto-fit,minmax(160px,1fr)); }
        .month-row { display:flex; align-items:center; gap:8px; min-height:44px; padding:6px 10px;
          border:1px solid var(--line); border-radius:8px; background:#fff; font-size:14px; }
        .month-row input { width:18px; height:18px; }
      </style>
    `;
    return page(c, { title: 'Upload Bukti Transfer', content, active: '/warga/pembayaran' });
  });

  app.post('/warga/pembayaran', async (c) => {
    const user = c.get('user')!;
    const house = await getHouse(c.env.DB, user.houseId!);
    if (!house) return errorPage(c, 'Rumah tidak ditemukan', 'Hubungi bendahara untuk memperbaiki data rumah.', 404);

    const form = await c.req.formData();
    const selected = form.getAll('months').map((value) => String(value));
    const note = String(form.get('note') ?? '');
    const fileValue = form.get('proof');

    const fileCheck = validateUploadFile(fileValue instanceof File ? fileValue : null);
    if (!fileCheck.ok) {
      return c.redirect(`/warga/pembayaran?err=${encodeURIComponent(fileCheck.message)}`);
    }

    const settings = await getSettings(c.env.DB);
    const info = await statusForHouse(c.env.DB, house, settings);
    const selection = validateMonthSelection(selected, info.unpaidMonths);
    if (!selection.ok) {
      return c.redirect(`/warga/pembayaran?err=${encodeURIComponent(selection.message)}`);
    }

    const stored = await storeFile(c.env, {
      file: fileValue as File,
      fileType: 'payment_proof',
      userId: user.id,
    });

    const result = await createPaymentSubmission(c.env, {
      houseId: house.id,
      userId: user.id,
      months: selection.months,
      unpaid: info.unpaidMonths,
      fileId: stored.id,
      note,
      settings,
      ip: clientIp(c),
    });

    if (!result.ok) {
      await deleteFile(c.env, stored.id);
      return c.redirect(`/warga/pembayaran?err=${encodeURIComponent(result.message)}`);
    }

    return c.redirect(
      `/warga/riwayat?id=${result.paymentId}&ok=${encodeURIComponent('Bukti terkirim. Menunggu verifikasi bendahara.')}`,
    );
  });

  app.get('/warga/riwayat', async (c) => {
    const user = c.get('user')!;
    const house = await getHouse(c.env.DB, user.houseId!);
    if (!house) return errorPage(c, 'Rumah tidak ditemukan', 'Hubungi bendahara untuk memperbaiki data rumah.', 404);

    const payments = await listPayments(c.env.DB, { houseId: house.id, limit: 100 });
    const detailId = Number(c.req.query('id'));
    let detail = null;
    if (Number.isInteger(detailId) && detailId > 0) {
      const found = await getPaymentDetail(c.env.DB, detailId);
      if (!found || found.house_id !== house.id) {
        return errorPage(c, 'Pengajuan tidak ditemukan', 'Pengajuan ini bukan milik rumah Anda.', 404);
      }
      detail = found;
    }

    const detailBox = detail
      ? `<div class="card pad">
          <h2 class="section-title">Detail pengajuan</h2>
          <p class="page-sub">Bulan ${esc(monthListLabel(detail.months))} · ${rupiah(detail.amount)} · diunggah ${esc(
            formatDateID(detail.created_at),
          )}</p>
          <p style="margin:8px 0">Status ${badge(detail.status)}</p>
          ${
            detail.rejected_reason
              ? `<p class="flash flash-err" style="margin:8px 0">Ditolak: ${esc(detail.rejected_reason)}</p>`
              : ''
          }
          ${
            detail.note ? `<p class="note">Catatan warga: ${esc(detail.note)}</p>` : ''
          }
          <div style="margin-top:12px">
            ${
              detail.proof
                ? `<a class="btn btn-ghost btn-sm" href="/api/files/${detail.proof.id}" target="_blank" rel="noopener">${icon(
                    'view',
                  )}<span>Lihat bukti ${esc(detail.proof.original_name)}</span></a>`
                : '<span class="hint">Bukti tidak tersedia.</span>'
            }
          </div>
        </div>`
      : '';

    const content = `
      <div>
        <h1 class="page-title">Riwayat pembayaran ${esc(house.block)}</h1>
        <p class="page-sub">Bukti transfer hanya bisa dilihat oleh rumah ini dan bendahara.</p>
      </div>
      ${detailBox}
      ${table(
        ['Tanggal', 'Bulan', 'Nominal', 'Status', ''],
        payments.map((payment) => [
          esc(formatDateID(payment.created_at)),
          esc(monthListLabel(payment.months)),
          `<span class="num">${rupiah(payment.amount)}</span>`,
          badge(payment.status),
          `<a class="btn btn-ghost btn-sm" href="/warga/riwayat?id=${payment.id}" aria-label="Detail pengajuan ${esc(monthListLabel(payment.months))}">${icon('view')}<span aria-hidden="true">Detail</span></a>`,
        ]),
        'Belum ada pengajuan pembayaran.',
        { caption: 'Riwayat pembayaran rumah ini' },
      )}
      <a class="btn btn-ghost" href="/warga">${icon('back')}<span>Kembali ke dashboard</span></a>
    `;
    return page(c, { title: 'Riwayat Pembayaran', content, active: '/warga/riwayat' });
  });
}
