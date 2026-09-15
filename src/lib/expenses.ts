import type { Env } from '../env';
import { logAudit } from './audit';
import { jakartaDate, jakartaTimestamp } from './date';

export interface ExpenseRow {
  id: number;
  expense_date: string;
  description: string;
  amount: number;
  proof_file_id: number | null;
  created_by: number | null;
  created_at: string;
}

export async function listExpenses(db: D1Database, limit = 200): Promise<ExpenseRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC LIMIT ?')
    .bind(limit)
    .all<ExpenseRow>();
  return results;
}

export async function getExpense(db: D1Database, id: number): Promise<ExpenseRow | null> {
  return db.prepare('SELECT * FROM expenses WHERE id = ?').bind(id).first<ExpenseRow>();
}

export interface CreateExpenseInput {
  expenseDate: string;
  description: string;
  amount: number;
  fileId?: number | null;
  userId: number;
  ip: string | null;
}

export async function createExpense(env: Env, input: CreateExpenseInput): Promise<{ ok: true; id: number }> {
  const now = jakartaTimestamp();
  const expenseDate = input.expenseDate || jakartaDate();

  const inserted = await env.DB.prepare(
    `INSERT INTO expenses (expense_date, description, amount, proof_file_id, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(expenseDate, input.description, input.amount, input.fileId ?? null, input.userId, now, now)
    .run();

  const expenseId = Number(inserted.meta.last_row_id);

  // Ledger dan audit ditulis setelah id pengeluaran diketahui, bukan lewat
  // last_insert_rowid() yang bisa berubah oleh insert sebelumnya.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO ledger_entries (entry_date, entry_type, amount, description, expense_id, created_by)
       VALUES (?, 'expense', ?, ?, ?, ?)`,
    ).bind(expenseDate, input.amount, input.description, expenseId, input.userId),
    env.DB.prepare(
      `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, new_values, ip_address)
       VALUES (?, 'create_expense', 'expense', ?, ?, ?)`,
    ).bind(
      input.userId,
      expenseId,
      JSON.stringify({ expense_date: expenseDate, description: input.description, amount: input.amount }),
      input.ip,
    ),
  ]);

  if (input.fileId) {
    await logAudit(env.DB, {
      actorId: input.userId,
      action: 'upload_expense_proof',
      entityType: 'file',
      entityId: input.fileId,
      ip: input.ip,
    });
  }

  return { ok: true, id: expenseId };
}
