import type { Context } from 'hono';
import type { AppEnv } from '../types';
import { renderPage } from '../lib/layout';

export const DEFAULT_APP_NAME = 'Kas Amartha Cluster Bagarry';

export function appName(c: Context<AppEnv>): string {
  return c.env.APP_NAME ?? DEFAULT_APP_NAME;
}

export function page(
  c: Context<AppEnv>,
  options: { title: string; content: string; active?: string; container?: 'wide' | 'narrow' },
): Response {
  return c.html(
    renderPage({
      title: options.title,
      appName: appName(c),
      user: c.get('user'),
      content: options.content,
      active: options.active,
      ok: c.req.query('ok') ?? null,
      err: c.req.query('err') ?? null,
      container: options.container,
      pendingCount: c.get('pendingCount'),
    }),
  );
}

/** Halaman galat sederhana agar pesan tetap terbaca pengguna. */
export function errorPage(c: Context<AppEnv>, title: string, message: string, status: 400 | 403 | 404): Response {
  return c.html(
    renderPage({
      title,
      appName: appName(c),
      user: c.get('user'),
      ok: null,
      err: message,
      content: `<h2 class="page-title">${title}</h2><p class="page-sub">Silakan kembali ke halaman sebelumnya.</p>`,
      pendingCount: c.get('pendingCount'),
    }),
    status,
  );
}

export function clientIp(c: Context<AppEnv>): string | null {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? null;
}
