import type { Context, Hono } from 'hono';
import type { AppEnv } from '../types';
import {
  checkLoginRate,
  clearLoginFailures,
  expiredSessionCookie,
  issueSessionToken,
  LOGIN_LOCK_MINUTES,
  minutesUntil,
  recordLoginFailure,
  sessionCookie,
} from '../lib/auth';
import { logAudit } from '../lib/audit';
import { formatDateID, jakartaTimestamp, monthLabel } from '../lib/date';
import { badge, esc, rupiah, table } from '../lib/html';
import { icon } from '../lib/icons';
import { publicBoard } from '../lib/ledger';
import { defaultResidentPassword, checkNewPassword, hashPassword, verifyPassword } from '../lib/password';
import { pbkdf2Iterations } from '../lib/config';
import { getSettings } from '../lib/settings';
import { clientIp, page } from './shared';

interface LoginRow {
  id: number;
  role: 'admin' | 'resident';
  password_hash: string;
  must_change_password: number;
  is_active: number;
  block: string | null;
  username: string | null;
  email: string | null;
}

function isSecure(requestUrl: string): boolean {
  return new URL(requestUrl).protocol === 'https:';
}

export function registerPublicRoutes(app: Hono<AppEnv>): void {
  app.get('/', async (c) => {
    const settings = await getSettings(c.env.DB);
    const board = await publicBoard(c.env.DB, settings);

    const hero = `<div class="grid-cards">
      <div class="stat stat-focus"><span>Saldo kas</span><strong>${rupiah(board.balance)}</strong></div>
      <div class="stat"><span>Pemasukan ${monthLabel(board.month)}</span><strong>${rupiah(board.income)}</strong></div>
      <div class="stat"><span>Pengeluaran ${monthLabel(board.month)}</span><strong>${rupiah(board.expense)}</strong></div>
    </div>`;

    const counts = `<div class="grid-cards">
      <div class="stat"><span>Rumah aktif</span><strong>${board.counts.active}</strong></div>
      <div class="stat"><span>Lunas</span><strong>${board.counts.lunas}</strong></div>
      <div class="stat"><span>Menunggu verifikasi</span><strong>${board.counts.menunggu}</strong></div>
      <div class="stat"><span>Sudah bayar</span><strong>${board.counts.sudah}</strong></div>
      <div class="stat"><span>Belum bayar</span><strong>${board.counts.belum}</strong></div>
      ${
        board.counts.nonaktif > 0
          ? `<div class="stat"><span>Tidak aktif</span><strong>${board.counts.nonaktif}</strong></div>`
          : ''
      }
    </div>`;

    const houseTable = table(
      ['Rumah', 'Status', 'Keterangan'],
      board.houses.map((house) => [
        `<strong class="num">${esc(house.block)}</strong>`,
        badge(house.status),
        esc(house.note),
      ]),
      'Belum ada data rumah. Bendahara perlu mengisi data rumah lewat menu Kelola Rumah.',
    );

    const content = `
      <div>
        <h2 class="page-title">Papan Kas Amartha Cluster Bagarry</h2>
        <p class="page-sub">Saldo dan status iuran bulan ${esc(monthLabel(board.month))}. Data per ${esc(
          formatDateID(jakartaTimestamp().slice(0, 10)),
        )} WIB.</p>
      </div>
      ${hero}
      ${counts}
      <div>
        <h3 class="page-title" style="font-size:16px">Status iuran per rumah</h3>
        <p class="page-sub">Nomor rumah ditampilkan tanpa nama pemilik, tanpa bukti transfer, dan tanpa detail pembayaran.</p>
      </div>
      ${houseTable}
      <p class="note">${icon('info')}Saldo bertambah hanya setelah bukti transfer diverifikasi bendahara. Pembayaran yang masih menunggu verifikasi belum masuk saldo kas.</p>
    `;
    return page(c, { title: 'Papan Pengumuman', content, active: '/' });
  });

  app.get('/login', (c) => {
    const user = c.get('user');
    if (user) return c.redirect(user.role === 'admin' ? '/admin' : '/warga');

    const content = `
      <div class="card pad" style="max-width:420px">
        <h2 class="page-title" style="font-size:18px">Masuk</h2>
        <p class="page-sub" style="margin-bottom:16px">Gunakan akun rumah atau akun bendahara.</p>
        <form method="post" action="/login">
          <label class="label" for="identifier">Username atau email</label>
          <input class="input" id="identifier" name="identifier" autocomplete="username" required
                 placeholder="Contoh: Lupine-C4/06">
          <p class="hint" style="margin-bottom:12px">Warga memakai kode rumah, bendahara memakai email.</p>
          <label class="label" for="password">Password</label>
          <input class="input" id="password" name="password" type="password" autocomplete="current-password" required>
          <div style="margin-top:16px">
            <button class="btn btn-primary" type="submit">${icon('login')}<span>Masuk</span></button>
          </div>
        </form>
      </div>
      <p class="note">${icon('info')}Lupa password? Password warga hanya bisa direset bendahara, lalu wajib diganti saat login.</p>
    `;
    return page(c, { title: 'Masuk', content, container: 'narrow' });
  });

  app.post('/login', async (c) => {
    const form = await c.req.formData();
    const identifier = String(form.get('identifier') ?? '').trim();
    const password = String(form.get('password') ?? '');

    if (!identifier || !password) {
      return c.redirect(`/login?err=${encodeURIComponent('Username dan password wajib diisi.')}`);
    }

    const rate = await checkLoginRate(c.env.DB, identifier.toLowerCase());
    if (!rate.allowed) {
      const minutes = rate.lockedUntil ? minutesUntil(rate.lockedUntil) : LOGIN_LOCK_MINUTES;
      return c.redirect(
        `/login?err=${encodeURIComponent(`Terlalu banyak percobaan login. Coba lagi dalam ${minutes} menit.`)}`,
      );
    }

    const row = await c.env.DB.prepare(
      `SELECT u.id, u.role, u.password_hash, u.must_change_password, u.is_active, u.username, u.email, h.block
       FROM users u
       LEFT JOIN houses h ON h.id = u.house_id
       WHERE u.username = ? COLLATE NOCASE OR u.email = ? COLLATE NOCASE
       LIMIT 1`,
    )
      .bind(identifier, identifier)
      .first<LoginRow>();

    const valid = row && row.is_active === 1 ? await verifyPassword(password, row.password_hash) : false;
    if (!row || !valid) {
      await recordLoginFailure(c.env.DB, identifier.toLowerCase());
      await logAudit(c.env.DB, {
        actorId: null,
        action: 'login_failed',
        entityType: 'user',
        newValues: { identifier },
        ip: clientIp(c),
      });
      return c.redirect(`/login?err=${encodeURIComponent('Username atau password salah.')}`);
    }

    await clearLoginFailures(c.env.DB, identifier.toLowerCase());
    await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?')
      .bind(jakartaTimestamp(), row.id)
      .run();
    await logAudit(c.env.DB, { actorId: row.id, action: 'login', entityType: 'user', entityId: row.id, ip: clientIp(c) });

    const token = await issueSessionToken(c.env, row.id);
    const target = row.must_change_password === 1 ? '/ganti-password' : row.role === 'admin' ? '/admin' : '/warga';
    const response = c.redirect(target, 303);
    response.headers.append('Set-Cookie', sessionCookie(token, isSecure(c.req.url)));
    return response;
  });

  app.post('/logout', async (c) => {
    const user = c.get('user');
    if (user) {
      await logAudit(c.env.DB, { actorId: user.id, action: 'logout', entityType: 'user', entityId: user.id, ip: clientIp(c) });
    }
    const response = c.redirect('/', 303);
    response.headers.append('Set-Cookie', expiredSessionCookie());
    return response;
  });

  // Halaman ganti password dipakai untuk ganti wajib (password default) maupun ganti sukarela.
  for (const path of ['/ganti-password', '/warga/password', '/admin/password'] as const) {
    app.get(path, async (c) => {
      const user = c.get('user');
      if (!user) return c.redirect('/login');
      return page(c, {
        title: 'Ganti Password',
        active: path,
        container: 'narrow',
        content: passwordForm(user.mustChangePassword, user.role),
      });
    });
    app.post(path, async (c) => {
      const user = c.get('user');
      if (!user) return c.redirect('/login');
      return changePassword(c, path);
    });
  }
}

function passwordForm(mandatory: boolean, role: 'admin' | 'resident'): string {
  return `
    <div class="card pad">
      <h2 class="page-title" style="font-size:18px">Ganti password</h2>
      ${
        mandatory
          ? `<p class="page-sub" style="margin-bottom:16px">Password default wajib diganti sebelum memakai menu lain.</p>`
          : `<p class="page-sub" style="margin-bottom:16px">Password minimal 8 karakter.</p>`
      }
      <form method="post">
        <label class="label" for="current">Password saat ini</label>
        <input class="input" id="current" name="current" type="password" autocomplete="current-password" required>
        <div style="height:12px"></div>
        <label class="label" for="next">Password baru</label>
        <input class="input" id="next" name="next" type="password" autocomplete="new-password" minlength="8" required>
        <p class="hint">Minimal 8 karakter dan tidak boleh sama dengan password default.</p>
        <div style="height:12px"></div>
        <label class="label" for="confirm">Ulangi password baru</label>
        <input class="input" id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="8" required>
        <div style="margin-top:16px">
          <button class="btn btn-primary" type="submit">${icon('save')}<span>Simpan password</span></button>
          <a class="btn btn-ghost" href="${role === 'admin' ? '/admin' : '/warga'}">${icon('back')}<span>Batal</span></a>
        </div>
      </form>
    </div>
  `;
}

async function changePassword(c: Context<AppEnv>, path: string): Promise<Response> {
  const user = c.get('user');
  if (!user) return c.redirect('/login');

  const form = await c.req.formData();
  const current = String(form.get('current') ?? '');
  const next = String(form.get('next') ?? '');
  const confirm = String(form.get('confirm') ?? '');

  const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
    .bind(user.id)
    .first<{ password_hash: string }>();
  if (!row || !(await verifyPassword(current, row.password_hash))) {
    return c.redirect(`${path}?err=${encodeURIComponent('Password saat ini tidak sesuai.')}`);
  }

  const defaultPassword = user.role === 'resident' && user.block ? defaultResidentPassword(user.block) : null;
  const check = checkNewPassword(next, confirm, defaultPassword);
  if (!check.ok) return c.redirect(`${path}?err=${encodeURIComponent(check.message)}`);

  const hash = await hashPassword(next, pbkdf2Iterations(c.env));
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
    .bind(hash, jakartaTimestamp(), user.id)
    .run();
  await logAudit(c.env.DB, {
    actorId: user.id,
    action: 'change_password',
    entityType: 'user',
    entityId: user.id,
    ip: clientIp(c),
  });

  const target = user.role === 'admin' ? '/admin' : '/warga';
  return c.redirect(`${target}?ok=${encodeURIComponent('Password berhasil diganti.')}`);
}
