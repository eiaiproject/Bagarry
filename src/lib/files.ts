import type { Env, SessionUser } from '../env';
import { jakartaDate } from './date';

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf',
};

export type FileType = 'payment_proof' | 'expense_proof';

export interface FileRow {
  id: number;
  file_type: FileType;
  original_name: string;
  storage_key: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: number | null;
  created_at: string;
}

export function validateUploadFile(file: File | null | undefined): { ok: true } | { ok: false; message: string } {
  if (!file || typeof file === 'string' || file.size === 0) {
    return { ok: false, message: 'File bukti wajib diupload.' };
  }
  if (!ALLOWED_MIME[file.type]) {
    return { ok: false, message: 'Format file harus JPG, PNG, atau PDF.' };
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return { ok: false, message: 'Ukuran file maksimal 5 MB.' };
  }
  return { ok: true };
}

export async function storeFile(
  env: Env,
  input: { file: File; fileType: FileType; userId: number },
): Promise<FileRow> {
  const extension = ALLOWED_MIME[input.file.type] ?? '';
  const today = jakartaDate();
  const key = `${input.fileType}/${today.slice(0, 4)}/${today.slice(5, 7)}/${crypto.randomUUID()}${extension}`;

  await env.BUCKET.put(key, await input.file.arrayBuffer(), {
    httpMetadata: { contentType: input.file.type },
  });

  const inserted = await env.DB.prepare(
    `INSERT INTO files (file_type, original_name, storage_key, mime_type, size_bytes, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(input.fileType, input.file.name, key, input.file.type, input.file.size, input.userId)
    .run();

  const id = Number(inserted.meta.last_row_id);
  const row = await getFileRow(env.DB, id);
  if (!row) throw new Error('Gagal menyimpan metadata file.');
  return row;
}

export async function getFileRow(db: D1Database, id: number): Promise<FileRow | null> {
  return db.prepare('SELECT * FROM files WHERE id = ?').bind(id).first<FileRow>();
}

/**
 * Bukti transfer hanya untuk bendahara dan pemilik akun pengunggah.
 * Bukti pengeluaran hanya untuk bendahara.
 */
export async function canAccessFile(db: D1Database, user: SessionUser, row: FileRow): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (row.file_type === 'expense_proof') return false;
  if (row.uploaded_by === user.id) return true;
  if (user.houseId === null) return false;
  const payment = await db
    .prepare('SELECT house_id FROM payments WHERE proof_file_id = ?')
    .bind(row.id)
    .first<{ house_id: number }>();
  return payment?.house_id === user.houseId;
}

export async function loadFileObject(env: Env, row: FileRow): Promise<R2ObjectBody | null> {
  return env.BUCKET.get(row.storage_key);
}

/** Dipakai untuk membersihkan file bila penyimpanan record utama gagal. */
export async function deleteFile(env: Env, fileId: number): Promise<void> {
  const row = await getFileRow(env.DB, fileId);
  if (!row) return;
  await env.BUCKET.delete(row.storage_key);
  await env.DB.prepare('DELETE FROM files WHERE id = ?').bind(fileId).run();
}
