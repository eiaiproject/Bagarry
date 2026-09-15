export interface AuditInput {
  actorId: number | null;
  action: string;
  entityType?: string | null;
  entityId?: number | null;
  oldValues?: unknown;
  newValues?: unknown;
  ip?: string | null;
}

export async function logAudit(db: D1Database, input: AuditInput): Promise<void> {
  await db
    .prepare(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, old_values, new_values, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.actorId,
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      input.oldValues === undefined ? null : JSON.stringify(input.oldValues),
      input.newValues === undefined ? null : JSON.stringify(input.newValues),
      input.ip ?? null,
    )
    .run();
}

export interface AuditRow {
  id: number;
  actor_id: number | null;
  actor_role: string | null;
  actor_username: string | null;
  actor_block: string | null;
  action: string;
  entity_type: string | null;
  entity_id: number | null;
  old_values: string | null;
  new_values: string | null;
  ip_address: string | null;
  created_at: string;
}

export async function listAuditLogs(db: D1Database, limit = 100): Promise<AuditRow[]> {
  const { results } = await db
    .prepare(
      `SELECT a.id, a.actor_id, u.role AS actor_role, u.username AS actor_username, h.block AS actor_block,
              a.action, a.entity_type, a.entity_id, a.old_values, a.new_values, a.ip_address, a.created_at
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.actor_id
       LEFT JOIN houses h ON h.id = u.house_id
       ORDER BY a.id DESC
       LIMIT ?`,
    )
    .bind(limit)
    .all<AuditRow>();
  return results;
}
export function actorLabel(row: Pick<AuditRow, 'actor_role' | 'actor_username' | 'actor_block'>): string {
  if (row.actor_role === 'admin') return 'Bendahara';
  if (row.actor_role === 'resident') return row.actor_block ?? row.actor_username ?? 'Warga';
  return 'Sistem';
}

const ACTION_LABEL: Record<string, string> = {
  login: 'Masuk',
  login_failed: 'Gagal masuk',
  logout: 'Keluar',
  change_password: 'Ganti password',
  create_house: 'Tambah rumah',
  update_house: 'Ubah rumah',
  reset_password: 'Reset password',
  import_houses: 'Import rumah',
  create_payment: 'Pengajuan pembayaran',
  approve_payment: 'Verifikasi pembayaran',
  reject_payment: 'Tolak pembayaran',
  create_expense: 'Catat pengeluaran',
  upload_expense_proof: 'Unggah bukti pengeluaran',
  update_settings: 'Ubah pengaturan',
};
/** Label Indonesia untuk kode aksi audit. Dipakai di tabel dan ringkasan. */
export function actionLabel(action: string): string {
  return ACTION_LABEL[action] ?? action;
}

/** Ringkasan satu baris untuk kolom Perubahan di tabel audit: tanpa JSON mentah. */
export function changeSummary(row: Pick<AuditRow, 'action' | 'old_values' | 'new_values'>): string {
  const parse = (raw: string | null): Record<string, unknown> | null => {
    if (!raw) return null;
    try {
      const value: unknown = JSON.parse(raw);
      return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  const oldValues = parse(row.old_values);
  const next = parse(row.new_values);
  const pick = (obj: Record<string, unknown> | null, keys: string[]): unknown =>
    obj ? keys.map((key) => obj[key]).find((value) => value !== undefined) : undefined;
  const text = (value: unknown): string => String(value ?? '-');
  switch (row.action) {
    case 'create_house': {
      const code = text(pick(next, ['house_code']));
      return code === '-' ? 'Rumah baru ditambahkan.' : `Rumah ${code} ditambahkan.`;
    }
    case 'update_house': {
      const changed = ['occupancy_status', 'is_active', 'owner_name', 'notes', 'billing_start_month'].filter(
        (key) => JSON.stringify(oldValues?.[key] ?? null) !== JSON.stringify(next?.[key] ?? null),
      );
      return changed.length === 0 ? 'Data rumah disimpan ulang.' : `Rumah diubah: ${changed.join(', ')}.`;
    }
    case 'reset_password':
      return `Password ${text(pick(next, ['house_code']))} direset ke default.`;
    case 'import_houses':
      return `${text(pick(next, ['created']))} rumah dibuat, ${text(pick(next, ['failed']))} gagal.`;
    case 'create_payment': {
      const months = next?.['months'];
      const amount = next?.['amount'];
      const monthText = Array.isArray(months) ? months.join(', ') : text(months);
      return amount === undefined ? `Pengajuan ${monthText}.` : `Pengajuan ${monthText} sebesar Rp${text(amount)}.`;
    }
    case 'approve_payment': {
      const months = next?.['months'];
      const monthText = Array.isArray(months) ? months.join(', ') : text(months);
      return `Diverifikasi ${monthText}, saldo kas bertambah.`;
    }
    case 'reject_payment':
      return `Ditolak: ${text(pick(next, ['reason']))}.`;
    case 'create_expense':
      return `${text(pick(next, ['description']))} sebesar Rp${text(pick(next, ['amount']))}.`;
    case 'update_settings': {
      const keys = next ? Object.keys(next) : [];
      return keys.length === 0 ? 'Pengaturan disimpan.' : `Pengaturan diubah: ${keys.join(', ')}.`;
    }
    case 'login':
      return 'Masuk.';
    case 'login_failed':
      return 'Gagal masuk.';
    case 'logout':
      return 'Keluar.';
    case 'change_password':
      return 'Password diganti.';
    case 'upload_expense_proof':
      return 'Bukti pengeluaran diunggah.';
    default:
      return row.action;
  }
}
