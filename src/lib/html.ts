import { icon, type IconName } from './icons';
import { formatRupiah } from './money';

export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function rupiah(value: number | null | undefined): string {
  return esc(formatRupiah(value));
}

const STATUS_LABEL: Record<string, string> = {
  lunas: 'Lunas',
  sudah: 'Sudah Bayar',
  menunggu: 'Menunggu Verifikasi',
  belum: 'Belum Bayar',
  nonaktif: 'Nonaktif',
  pending: 'Menunggu Verifikasi',
  verified: 'Diverifikasi',
  rejected: 'Ditolak',
  paid: 'Dibayar',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

/** Badge status: warna hanya dipakai sebagai penanda status, bukan dekorasi. */
export function badge(status: string): string {
  return `<span class="badge badge-${esc(status)}">${esc(statusLabel(status))}</span>`;
}

export function emptyState(
  message: string,
  action?: { href: string; label: string; iconName?: IconName },
  heading?: string,
): string {
  return `<div class="empty" role="status">
    ${heading ? `<p><strong>${esc(heading)}</strong></p>` : ''}
    <p>${esc(message)}</p>
    ${
      action
        ? `<a class="btn btn-primary" href="${esc(action.href)}">${action.iconName ? icon(action.iconName) : ''}<span>${esc(
            action.label,
          )}</span></a>`
        : ''
    }
  </div>`;
}

export interface TableOptions {
  /** Dibaca screen reader, menjelaskan isi tabel. */
  caption?: string;
  /** Kelas pembungkus tambahan, mis. "arrears-table" untuk layout kartu di HP. */
  wrapClass?: string;
}
export function table(
  headers: string[],
  rows: string[][],
  emptyMessage: string,
  options: TableOptions = {},
): string {
  if (rows.length === 0) return emptyState(emptyMessage, undefined, options.caption);
  const head = headers.map((header) => `<th scope="col">${esc(header)}</th>`).join('');
  const body = rows
    .map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join('')}</tr>`)
    .join('');
  const caption = options.caption ? `<caption class="sr-only">${esc(options.caption)}</caption>` : '';
  const wrapClass = options.wrapClass ? ` table-wrap ${options.wrapClass}` : 'table-wrap';
  return `<div class="${wrapClass.trim()}"><table class="table">${caption}<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}
