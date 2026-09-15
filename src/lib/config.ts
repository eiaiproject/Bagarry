import type { Env } from '../env';

// Nilai default bila secret belum diset (mis. `wrangler dev` tanpa .dev.vars).
// Di production SESSION_SECRET wajib diset lewat `wrangler secret put`.
const DEV_FALLBACK_SECRET = 'dev-only-secret-jangan-dipakai-di-production';

export function sessionSecret(env: Env): string {
  return env.SESSION_SECRET && env.SESSION_SECRET.length >= 16 ? env.SESSION_SECRET : DEV_FALLBACK_SECRET;
}

export function pbkdf2Iterations(env: Env): number {
  const parsed = Number(env.PBKDF2_ITERATIONS);
  // Workers membatasi PBKDF2 maksimum 100.000 iterasi.
  if (!Number.isFinite(parsed) || parsed < 1000) return 15000;
  return Math.min(Math.trunc(parsed), 100000);
}
