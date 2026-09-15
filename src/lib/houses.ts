import type { Env } from '../env';
import { logAudit } from './audit';
import type { Month } from './date';
import { addMonths, currentMonth, isMonth, monthLabel, monthListLabel, monthRange, jakartaTimestamp } from './date';
import { defaultResidentPassword, hashPassword } from './password';
import { pbkdf2Iterations } from './config';
import { billingStartMonth, type Settings } from './settings';

export type HouseStatus = 'lunas' | 'menunggu' | 'sudah' | 'belum' | 'nonaktif';

export const OCCUPANCY_OPTIONS = [
  { value: 'berpenghuni', label: 'Berpenghuni' },
  { value: 'kosong', label: 'Kosong' },
  { value: 'tanah_kosong', label: 'Tanah kosong' },
  { value: 'belum_dihuni', label: 'Belum dihuni' },
] as const;

export type OccupancyStatus = (typeof OCCUPANCY_OPTIONS)[number]['value'];

export interface HouseRow {
  id: number;
  house_type: string;
  block: string;
  house_code: string;
  occupancy_status: OccupancyStatus;
  is_active: number;
  billing_start_month: string | null;
  paid_until: string | null;
  owner_name: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface HouseStatusInfo {
  status: HouseStatus;
  billingStart: Month;
  requiredMonths: Month[];
  paidMonths: Month[];
  pendingMonths: Month[];
  unpaidMonths: Month[];
  paidUntil: Month | null;
  totalDue: number;
  note: string;
}

export function occupancyLabel(status: string): string {
  return OCCUPANCY_OPTIONS.find((option) => option.value === status)?.label ?? status;
}

/** Bulan terakhir yang dibayar berurutan mulai bulan awal tagihan. */
export function recalcPaidUntil(paidMonths: Month[], billingStart: Month): Month | null {
  const paid = new Set(paidMonths);
  if (!paid.has(billingStart)) return null;
  let cursor: Month = billingStart;
  let guard = 0;
  while (paid.has(addMonths(cursor, 1)) && guard < 1200) {
    cursor = addMonths(cursor, 1);
    guard += 1;
  }
  return cursor;
}

export function computeHouseStatus(
  house: Pick<HouseRow, 'is_active' | 'billing_start_month'>,
  months: { paid: Set<Month>; pending: Set<Month> },
  settings: Settings,
  today: Date = new Date(),
): HouseStatusInfo {
  const billingStart = billingStartMonth(house, settings, today);
  const required = monthRange(billingStart, currentMonth(today));
  const paidMonths = required.filter((month) => months.paid.has(month));
  const pendingMonths = required.filter((month) => months.pending.has(month));
  const unpaidMonths = required.filter((month) => !months.paid.has(month) && !months.pending.has(month));
  const paidUntil = recalcPaidUntil(paidMonths, billingStart);

  let status: HouseStatus;
  let note: string;
  if (house.is_active !== 1) {
    // Rumah nonaktif tidak pernah masuk rekap tunggakan.
    return {
      status: 'nonaktif',
      billingStart,
      requiredMonths: required,
      paidMonths,
      pendingMonths,
      unpaidMonths: [],
      paidUntil,
      totalDue: 0,
      note: 'Rumah nonaktif, tidak dihitung wajib iuran',
    };
  }
  if (required.length === 0) {
    status = 'lunas';
    note = `Belum ada tagihan, mulai ${monthLabel(billingStart)}`;
  } else if (pendingMonths.length > 0) {
    status = 'menunggu';
    note = unpaidMonths.length
      ? `Menunggu verifikasi ${monthListLabel(pendingMonths)} · belum bayar ${monthListLabel(unpaidMonths)}`
      : `Menunggu verifikasi ${monthListLabel(pendingMonths)}`;
  } else if (unpaidMonths.length === 0) {
    status = 'lunas';
    note = `Lunas sampai ${monthLabel(paidUntil ?? billingStart)}`;
  } else if (paidMonths.length > 0) {
    status = 'sudah';
    note = `Sampai ${monthLabel(paidUntil ?? billingStart)} · belum bayar ${monthListLabel(unpaidMonths)}`;
  } else {
    status = 'belum';
    note = monthListLabel(unpaidMonths);
  }

  return {
    status,
    billingStart,
    requiredMonths: required,
    paidMonths,
    pendingMonths,
    unpaidMonths,
    paidUntil,
    totalDue: unpaidMonths.length * settings.monthlyFee,
    note,
  };
}

export async function listHouses(db: D1Database, options: { onlyActive?: boolean } = {}): Promise<HouseRow[]> {
  const where = options.onlyActive ? 'WHERE is_active = 1' : '';
  const { results } = await db
    .prepare(`SELECT * FROM houses ${where} ORDER BY block COLLATE NOCASE`)
    .all<HouseRow>();
  return results;
}

export async function getHouse(db: D1Database, id: number): Promise<HouseRow | null> {
  return db.prepare('SELECT * FROM houses WHERE id = ?').bind(id).first<HouseRow>();
}

export async function getHouseByCode(db: D1Database, houseCode: string): Promise<HouseRow | null> {
  return db.prepare('SELECT * FROM houses WHERE house_code = ? COLLATE NOCASE').bind(houseCode).first<HouseRow>();
}

export type MonthStateMap = Map<number, { paid: Set<Month>; pending: Set<Month> }>;

export async function loadMonthStates(db: D1Database, houseIds?: number[]): Promise<MonthStateMap> {
  const filter = houseIds && houseIds.length > 0 ? `AND house_id IN (${houseIds.map(() => '?').join(',')})` : '';
  const { results } = await db
    .prepare(`SELECT house_id, period_month, status FROM payment_items WHERE status IN ('paid','pending') ${filter}`)
    .bind(...(houseIds ?? []))
    .all<{ house_id: number; period_month: string; status: string }>();
  const map: MonthStateMap = new Map();
  for (const row of results) {
    let entry = map.get(row.house_id);
    if (!entry) {
      entry = { paid: new Set(), pending: new Set() };
      map.set(row.house_id, entry);
    }
    if (!isMonth(row.period_month)) continue;
    (row.status === 'paid' ? entry.paid : entry.pending).add(row.period_month);
  }
  return map;
}

const EMPTY_STATE = { paid: new Set<Month>(), pending: new Set<Month>() };

export interface HouseStatusEntry {
  house: HouseRow;
  info: HouseStatusInfo;
}

/** Semua rumah beserta status pembayarannya, urut blok. */
export async function statusListFor(
  db: D1Database,
  settings: Settings,
  today: Date = new Date(),
): Promise<HouseStatusEntry[]> {
  const [houses, states] = await Promise.all([listHouses(db), loadMonthStates(db)]);
  return houses.map((house) => ({
    house,
    info: computeHouseStatus(house, states.get(house.id) ?? EMPTY_STATE, settings, today),
  }));
}

export async function statusForHouse(
  db: D1Database,
  house: HouseRow,
  settings: Settings,
  today: Date = new Date(),
): Promise<HouseStatusInfo> {
  const states = await loadMonthStates(db, [house.id]);
  return computeHouseStatus(house, states.get(house.id) ?? EMPTY_STATE, settings, today);
}

export interface CreateHouseInput {
  houseType: string;
  block: string;
  occupancyStatus: OccupancyStatus;
  isActive: boolean;
  ownerName?: string;
  notes?: string;
  billingStartMonth?: string;
}

export function buildHouseCode(houseType: string, block: string): string {
  return `${houseType.trim()}-${block.trim()}`;
}

/** Membuat rumah sekaligus akun warga dengan password default. */
export async function createHouse(
  env: Env,
  input: CreateHouseInput,
  actorId: number,
  ip: string | null,
): Promise<{ houseId: number; houseCode: string; defaultPassword: string }> {
  const houseType = input.houseType.trim();
  const block = input.block.trim();
  const houseCode = buildHouseCode(houseType, block);
  const defaultPassword = defaultResidentPassword(block);
  const passwordHash = await hashPassword(defaultPassword, pbkdf2Iterations(env));
  const billingStart = input.billingStartMonth && isMonth(input.billingStartMonth) ? input.billingStartMonth : null;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO houses (house_type, block, house_code, occupancy_status, is_active, owner_name, notes, billing_start_month)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      houseType,
      block,
      houseCode,
      input.occupancyStatus,
      input.isActive ? 1 : 0,
      input.ownerName?.trim() || null,
      input.notes?.trim() || null,
      billingStart,
    ),
    env.DB.prepare(
      `INSERT INTO users (role, house_id, username, password_hash, must_change_password, is_active)
       SELECT 'resident', id, house_code, ?, 1, 1 FROM houses WHERE house_code = ?`,
    ).bind(passwordHash, houseCode),
  ]);

  const house = await getHouseByCode(env.DB, houseCode);
  if (!house) throw new Error('Gagal menyimpan rumah baru.');

  await logAudit(env.DB, {
    actorId,
    action: 'create_house',
    entityType: 'house',
    entityId: house.id,
    newValues: { house_code: houseCode, occupancy_status: input.occupancyStatus, is_active: input.isActive },
    ip,
  });

  return { houseId: house.id, houseCode, defaultPassword };
}

export interface UpdateHouseInput {
  occupancyStatus: OccupancyStatus;
  isActive: boolean;
  ownerName?: string;
  notes?: string;
  billingStartMonth?: string;
}

export async function updateHouse(
  env: Env,
  houseId: number,
  input: UpdateHouseInput,
  actorId: number,
  ip: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const existing = await getHouse(env.DB, houseId);
  if (!existing) return { ok: false, message: 'Rumah tidak ditemukan.' };

  await env.DB.prepare(
    `UPDATE houses
     SET occupancy_status = ?, is_active = ?, owner_name = ?, notes = ?, billing_start_month = ?,
         updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      input.occupancyStatus,
      input.isActive ? 1 : 0,
      input.ownerName?.trim() || null,
      input.notes?.trim() || null,
      input.billingStartMonth && isMonth(input.billingStartMonth) ? input.billingStartMonth : null,
      jakartaTimestamp(),
      houseId,
    )
    .run();

  await logAudit(env.DB, {
    actorId,
    action: 'update_house',
    entityType: 'house',
    entityId: houseId,
    oldValues: {
      occupancy_status: existing.occupancy_status,
      is_active: existing.is_active,
      owner_name: existing.owner_name,
      notes: existing.notes,
      billing_start_month: existing.billing_start_month,
    },
    newValues: {
      occupancy_status: input.occupancyStatus,
      is_active: input.isActive,
      owner_name: input.ownerName ?? null,
      notes: input.notes ?? null,
      billing_start_month: input.billingStartMonth ?? null,
    },
    ip,
  });

  return { ok: true };
}

/** Reset password akun rumah ke password default dan wajib diganti saat login. */
export async function resetResidentPassword(
  env: Env,
  houseId: number,
  actorId: number,
  ip: string | null,
): Promise<{ ok: true; password: string } | { ok: false; message: string }> {
  const house = await getHouse(env.DB, houseId);
  if (!house) return { ok: false, message: 'Rumah tidak ditemukan.' };
  const password = defaultResidentPassword(house.block);
  const hash = await hashPassword(password, pbkdf2Iterations(env));

  const result = await env.DB.prepare(
    `UPDATE users SET password_hash = ?, must_change_password = 1, updated_at = ? WHERE house_id = ?`,
  )
    .bind(hash, jakartaTimestamp(), houseId)
    .run();
  if (!result.meta.changes) return { ok: false, message: 'Akun rumah belum ada, buat ulang rumah ini.' };

  await logAudit(env.DB, {
    actorId,
    action: 'reset_password',
    entityType: 'house',
    entityId: houseId,
    newValues: { house_code: house.house_code },
    ip,
  });
  return { ok: true, password };
}

export interface ImportRow {
  houseType: string;
  block: string;
  occupancyStatus: OccupancyStatus;
  isActive: boolean;
  ownerName?: string;
  line: number;
}

export interface ImportReport {
  created: string[];
  errors: { line: number; message: string }[];
}

/** Import massal rumah + pembuatan akun otomatis. */
export async function importHouses(env: Env, rows: ImportRow[], actorId: number, ip: string | null): Promise<ImportReport> {
  const report: ImportReport = { created: [], errors: [] };
  for (const row of rows) {
    const houseCode = buildHouseCode(row.houseType, row.block);
    const existing = await getHouseByCode(env.DB, houseCode);
    if (existing) {
      report.errors.push({ line: row.line, message: `${houseCode} sudah terdaftar.` });
      continue;
    }
    try {
      await createHouse(env, row, actorId, ip);
      report.created.push(houseCode);
    } catch (error) {
      report.errors.push({ line: row.line, message: `${houseCode}: ${(error as Error).message}` });
    }
  }
  await logAudit(env.DB, {
    actorId,
    action: 'import_houses',
    entityType: 'house',
    newValues: { created: report.created.length, failed: report.errors.length },
    ip,
  });
  return report;
}
