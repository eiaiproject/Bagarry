import type { Env } from '../env';
import { logAudit } from './audit';
import type { Month } from './date';
import { isMonth, jakartaDate, jakartaTimestamp, monthListLabel } from './date';
import { recalcPaidUntil, type HouseRow } from './houses';
import { billingStartMonth, getSettings, type Settings } from './settings';

export type PaymentStatus = 'pending' | 'verified' | 'rejected';

export interface PaymentListRow {
  id: number;
  house_id: number;
  block: string;
  house_code: string;
  amount: number;
  months_count: number;
  status: PaymentStatus;
  period_start: Month;
  period_end: Month;
  note: string | null;
  rejected_reason: string | null;
  proof_file_id: number | null;
  created_at: string;
  verified_at: string | null;
  months: Month[];
}

export interface ProofFile {
  id: number;
  original_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: number | null;
}

export interface PaymentDetail extends PaymentListRow {
  proof: ProofFile | null;
}

interface PaymentRawRow {
  id: number;
  house_id: number;
  block: string;
  house_code: string;
  amount: number;
  months_count: number;
  status: PaymentStatus;
  period_start: string;
  period_end: string;
  note: string | null;
  rejected_reason: string | null;
  proof_file_id: number | null;
  created_at: string;
  verified_at: string | null;
}

const PAYMENT_SELECT = `
  SELECT p.id, p.house_id, h.block, h.house_code, p.amount, p.months_count, p.status,
         p.period_start, p.period_end, p.note, p.rejected_reason, p.proof_file_id,
         p.created_at, p.verified_at
  FROM payments p
  JOIN houses h ON h.id = p.house_id
`;

async function attachMonths(db: D1Database, rows: PaymentRawRow[]): Promise<PaymentListRow[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const { results } = await db
    .prepare(
      `SELECT payment_id, period_month FROM payment_items
       WHERE payment_id IN (${ids.map(() => '?').join(',')})
       ORDER BY period_month`,
    )
    .bind(...ids)
    .all<{ payment_id: number; period_month: string }>();
  const grouped = new Map<number, Month[]>();
  for (const item of results) {
    if (!isMonth(item.period_month)) continue;
    const list = grouped.get(item.payment_id) ?? [];
    list.push(item.period_month);
    grouped.set(item.payment_id, list);
  }
  return rows.map((row) => ({ ...row, months: grouped.get(row.id) ?? [] }));
}

export interface PaymentFilter {
  houseId?: number;
  status?: PaymentStatus;
  limit?: number;
}

export async function listPayments(db: D1Database, filter: PaymentFilter = {}): Promise<PaymentListRow[]> {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filter.houseId !== undefined) {
    clauses.push('p.house_id = ?');
    params.push(filter.houseId);
  }
  if (filter.status) {
    clauses.push('p.status = ?');
    params.push(filter.status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filter.limit ?? 200;
  const { results } = await db
    .prepare(`${PAYMENT_SELECT} ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
    .bind(...params, limit)
    .all<PaymentRawRow>();
  return attachMonths(db, results);
}

export async function getPaymentDetail(db: D1Database, paymentId: number): Promise<PaymentDetail | null> {
  const row = await db.prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).bind(paymentId).first<PaymentRawRow>();
  if (!row) return null;
  const [withMonths] = await attachMonths(db, [row]);
  if (!withMonths) return null;
  const proof = row.proof_file_id
    ? await db
        .prepare('SELECT id, original_name, mime_type, size_bytes, uploaded_by FROM files WHERE id = ?')
        .bind(row.proof_file_id)
        .first<ProofFile>()
    : null;
  return { ...withMonths, proof: proof ?? null };
}

export interface UnpaidInfo {
  billingStart: Month;
  required: Month[];
  paid: Month[];
  pending: Month[];
  unpaid: Month[];
  /** Pilihan wajib berurutan mulai tunggakan terlama. */
  selectable: Month[];
}

/** Dipakai form warga: bulan yang boleh dipilih adalah tunggakan berurutan dari yang terlama. */
export function validateMonthSelection(
  selected: Month[],
  unpaid: Month[],
): { ok: true; months: Month[] } | { ok: false; message: string } {
  const months = [...new Set(selected)].sort();
  if (months.length === 0) return { ok: false, message: 'Pilih minimal satu bulan pembayaran.' };
  for (const month of months) {
    if (!isMonth(month)) return { ok: false, message: 'Format bulan tidak valid.' };
  }
  if (unpaid.length === 0) return { ok: false, message: 'Tidak ada bulan yang perlu dibayar.' };
  if (months.length > unpaid.length) return { ok: false, message: 'Jumlah bulan melebihi tunggakan.' };
  for (let i = 0; i < months.length; i += 1) {
    if (months[i] !== unpaid[i]) {
      return { ok: false, message: 'Bulan harus dipilih berurutan mulai tunggakan terlama.' };
    }
  }
  return { ok: true, months };
}

export interface CreatePaymentInput {
  houseId: number;
  userId: number;
  months: Month[];
  unpaid: Month[];
  fileId: number;
  note?: string;
  settings: Settings;
  ip: string | null;
}

export async function createPaymentSubmission(
  env: Env,
  input: CreatePaymentInput,
): Promise<{ ok: true; paymentId: number } | { ok: false; message: string }> {
  const validated = validateMonthSelection(input.months, input.unpaid);
  if (!validated.ok) return { ok: false, message: validated.message };

  const months = validated.months;
  const amount = input.settings.monthlyFee * months.length;
  const periodStart = months[0]!;
  const periodEnd = months[months.length - 1]!;
  const now = jakartaTimestamp();

  const inserted = await env.DB.prepare(
    `INSERT INTO payments (house_id, created_by, period_start, period_end, months_count, amount, status, proof_file_id, note, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`,
  )
    .bind(
      input.houseId,
      input.userId,
      periodStart,
      periodEnd,
      months.length,
      amount,
      input.fileId,
      input.note?.trim() || null,
      now,
      now,
    )
    .run();

  const paymentId = Number(inserted.meta.last_row_id);

  try {
    // Satu batch = satu transaksi, jadi bila salah satu bulan sudah pernah diajukan
    // (unique index uniq_house_active_month) tidak ada item yang tersimpan.
    await env.DB.batch(
      months.map((month) =>
        env.DB.prepare(
          `INSERT INTO payment_items (payment_id, house_id, period_month, status) VALUES (?, ?, ?, 'pending')`,
        ).bind(paymentId, input.houseId, month),
      ),
    );
  } catch (error) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM payment_items WHERE payment_id = ?').bind(paymentId),
      env.DB.prepare('DELETE FROM payments WHERE id = ?').bind(paymentId),
    ]);
    const message = (error as Error).message ?? '';
    if (message.includes('UNIQUE')) {
      return { ok: false, message: 'Salah satu bulan yang dipilih sudah diajukan sebelumnya.' };
    }
    return { ok: false, message: 'Gagal menyimpan pengajuan pembayaran.' };
  }

  await logAudit(env.DB, {
    actorId: input.userId,
    action: 'create_payment',
    entityType: 'payment',
    entityId: paymentId,
    newValues: { house_id: input.houseId, months, amount },
    ip: input.ip,
  });

  return { ok: true, paymentId };
}

async function paidMonthsForHouse(db: D1Database, houseId: number, extra: Month[] = []): Promise<Month[]> {
  const { results } = await db
    .prepare(`SELECT period_month FROM payment_items WHERE house_id = ? AND status = 'paid'`)
    .bind(houseId)
    .all<{ period_month: string }>();
  const months = new Set<Month>(extra);
  for (const row of results) if (isMonth(row.period_month)) months.add(row.period_month);
  return [...months];
}

export async function approvePayment(
  env: Env,
  input: { paymentId: number; adminId: number; ip: string | null },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const payment = await getPaymentDetail(env.DB, input.paymentId);
  if (!payment) return { ok: false, message: 'Pembayaran tidak ditemukan.' };
  if (payment.status !== 'pending') return { ok: false, message: 'Pembayaran ini sudah diproses sebelumnya.' };
  if (payment.months.length === 0) return { ok: false, message: 'Pengajuan ini tidak memiliki data bulan.' };

  const house = await env.DB.prepare('SELECT * FROM houses WHERE id = ?').bind(payment.house_id).first<HouseRow>();
  if (!house) return { ok: false, message: 'Rumah tidak ditemukan.' };

  // Bulan awal tagihan mengikuti override rumah, lalu pengaturan global.
  const settings = await getSettings(env.DB);
  const billingStart = (billingStartMonth(house, settings) || payment.months[0]!) as Month;
  const paidUntil = recalcPaidUntil(await paidMonthsForHouse(env.DB, house.id, payment.months), billingStart);

  const now = jakartaTimestamp();
  const description = `Iuran ${monthListLabel(payment.months)} - ${house.block}`;

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE payments SET status = 'verified', verified_by = ?, verified_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
    ).bind(input.adminId, now, now, payment.id),
    env.DB.prepare(
      `UPDATE payment_items SET status = 'paid', updated_at = ? WHERE payment_id = ?`,
    ).bind(now, payment.id),
    env.DB.prepare(`UPDATE houses SET paid_until = ?, updated_at = ? WHERE id = ?`).bind(paidUntil, now, house.id),
    env.DB.prepare(
      `INSERT INTO ledger_entries (entry_date, entry_type, amount, description, house_id, payment_id, created_by)
       VALUES (?, 'income', ?, ?, ?, ?, ?)`,
    ).bind(jakartaDate(), payment.amount, description, house.id, payment.id, input.adminId),
    env.DB.prepare(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values, ip_address)
       VALUES (?, 'approve_payment', 'payment', ?, ?, ?, ?)`,
    ).bind(
      input.adminId,
      payment.id,
      JSON.stringify({ status: 'pending' }),
      JSON.stringify({ status: 'verified', months: payment.months, amount: payment.amount, paid_until: paidUntil }),
      input.ip,
    ),
  ]);

  return { ok: true };
}

export async function rejectPayment(
  env: Env,
  input: { paymentId: number; adminId: number; reason: string; ip: string | null },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, message: 'Alasan penolakan wajib diisi.' };

  const payment = await getPaymentDetail(env.DB, input.paymentId);
  if (!payment) return { ok: false, message: 'Pembayaran tidak ditemukan.' };
  if (payment.status !== 'pending') return { ok: false, message: 'Pembayaran ini sudah diproses sebelumnya.' };

  const now = jakartaTimestamp();
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE payments SET status = 'rejected', rejected_reason = ?, verified_by = ?, verified_at = ?, updated_at = ?
       WHERE id = ? AND status = 'pending'`,
    ).bind(reason, input.adminId, now, now, payment.id),
    // Bulan kembali menjadi belum dibayar sehingga warga bisa mengajukan ulang.
    env.DB.prepare(`UPDATE payment_items SET status = 'rejected', updated_at = ? WHERE payment_id = ?`).bind(
      now,
      payment.id,
    ),
    env.DB.prepare(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values, ip_address)
       VALUES (?, 'reject_payment', 'payment', ?, ?, ?, ?)`,
    ).bind(
      input.adminId,
      payment.id,
      JSON.stringify({ status: 'pending' }),
      JSON.stringify({ status: 'rejected', reason, months: payment.months }),
      input.ip,
    ),
  ]);

  return { ok: true };
}
