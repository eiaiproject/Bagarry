import { createMiddleware } from 'hono/factory';
import { findUserById, readCookie, readSessionUserId, SESSION_COOKIE } from './lib/auth';
import type { AppEnv } from './types';

/** Memuat user dari cookie session bila ada; halaman tetap bisa diakses publik. */
export const loadUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = readCookie(c.req.header('cookie') ?? null, SESSION_COOKIE);
  const userId = await readSessionUserId(c.env, token);
  const user = userId ? await findUserById(c.env.DB, userId) : null;
  c.set('user', user);
  // Badge nav "Menunggu Verifikasi (n)": satu query hitung, hanya untuk bendahara.
  if (user?.role === 'admin') {
    const row = await c.env.DB.prepare(`SELECT COUNT(*) AS n FROM payments WHERE status = 'pending'`).first<{
      n: number;
    }>();
    c.set('pendingCount', row?.n ?? 0);
  } else {
    c.set('pendingCount', 0);
  }
  await next();
});

/** Cookie session memakai SameSite=Lax; origin diperiksa ulang sebagai lapis kedua. */
export const checkOrigin = createMiddleware<AppEnv>(async (c, next) => {
  const method = c.req.method;
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next();
  const origin = c.req.header('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(c.req.url).host) {
        return c.text('Permintaan ditolak: origin tidak sesuai.', 403);
      }
    } catch {
      return c.text('Permintaan ditolak: origin tidak valid.', 403);
    }
  }
  await next();
});

const PASSWORD_PATHS = ['/ganti-password', '/warga/password', '/admin/password'];

export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return c.redirect(`/login?err=${encodeURIComponent('Silakan masuk terlebih dahulu.')}`);
  }
  // Password default wajib diganti sebelum memakai menu lain.
  if (user.mustChangePassword && !PASSWORD_PATHS.includes(new URL(c.req.url).pathname)) {
    return c.redirect(
      `/ganti-password?err=${encodeURIComponent('Password default wajib diganti sebelum melanjutkan.')}`,
    );
  }
  await next();
});

export const requireResident = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return c.redirect(`/login?err=${encodeURIComponent('Silakan masuk terlebih dahulu.')}`);
  }
  if (user.role !== 'resident' || user.houseId === null) {
    return c.redirect(`/admin?err=${encodeURIComponent('Halaman itu hanya untuk akun warga.')}`);
  }
  if (user.mustChangePassword && !PASSWORD_PATHS.includes(new URL(c.req.url).pathname)) {
    return c.redirect(
      `/ganti-password?err=${encodeURIComponent('Password default wajib diganti sebelum melanjutkan.')}`,
    );
  }
  await next();
});

export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const user = c.get('user');
  if (!user) {
    return c.redirect(`/login?err=${encodeURIComponent('Silakan masuk terlebih dahulu.')}`);
  }
  if (user.role !== 'admin') {
    return c.redirect(`/warga?err=${encodeURIComponent('Halaman itu hanya untuk bendahara.')}`);
  }
  if (user.mustChangePassword && !PASSWORD_PATHS.includes(new URL(c.req.url).pathname)) {
    return c.redirect(
      `/ganti-password?err=${encodeURIComponent('Password default wajib diganti sebelum melanjutkan.')}`,
    );
  }
  await next();
});
