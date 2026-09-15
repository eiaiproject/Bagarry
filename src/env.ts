// Tipe environment Worker. Binding sesuai wrangler.jsonc.
export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  APP_NAME?: string;
  PBKDF2_ITERATIONS?: string;
  SESSION_SECRET?: string;
}

export type Role = 'admin' | 'resident';

export interface SessionUser {
  id: number;
  role: Role;
  username: string | null;
  email: string | null;
  houseId: number | null;
  houseCode: string | null;
  block: string | null;
  mustChangePassword: boolean;
}
