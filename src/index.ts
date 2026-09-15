import { Hono } from 'hono';
import { checkOrigin, loadUser, requireAdmin, requireAuth, requireResident } from './middleware';
import { registerAdminRoutes } from './routes/admin';
import { registerApiRoutes } from './routes/api';
import { registerPublicRoutes } from './routes/public';
import { errorPage } from './routes/shared';
import { registerWargaRoutes } from './routes/warga';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

app.use('*', loadUser);
app.use('*', checkOrigin);

// Menu warga dan bendahara dipisah; halaman ganti password tetap bisa diakses
// saat password default belum diganti.
app.use('/warga', requireResident);
app.use('/warga/*', requireResident);
app.use('/admin', requireAdmin);
app.use('/admin/*', requireAdmin);
app.use('/ganti-password', requireAuth);

registerPublicRoutes(app);
registerWargaRoutes(app);
registerAdminRoutes(app);
registerApiRoutes(app);

app.notFound((c) =>
  c.req.path.startsWith('/api/')
    ? c.json({ error: 'Endpoint tidak ditemukan.' }, 404)
    : errorPage(c, 'Halaman tidak ditemukan', 'Alamat yang dibuka tidak tersedia.', 404),
);

app.onError((error, c) => {
  console.error('Unhandled error', error);
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'Terjadi kesalahan pada server.' }, 500);
  }
  return errorPage(c, 'Terjadi kesalahan', 'Coba muat ulang halaman. Bila masalah berlanjut, hubungi bendahara.', 400);
});

export default app;
