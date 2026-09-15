import type { Context, Hono } from 'hono';
import { z } from 'zod';
import type { SessionUser } from '../env';
import type { AppEnv } from '../types';
import { logAudit } from '../lib/audit';
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
import { parseHouseCsv } from '../lib/csv';
import { currentMonth, isMonth, jakartaTimestamp } from '../lib/date';
import { createExpense, getExpense, listExpenses } from '../lib/expenses';
import { deleteFile, canAccessFile, getFileRow, loadFileObject, storeFile, validateUploadFile } from '../lib/files';
import {
  createHouse,
  getHouse,
  importHouses,
  occupancyLabel,
  resetResidentPassword,
  statusForHouse,
  statusListFor,
  updateHouse,
} from '../lib/houses';
import { cashBalance, monthlyReport, periodTotals, publicBoard } from '../lib/ledger';
import { parseRupiah } from '../lib/money';
import {
  approvePayment,
  createPaymentSubmission,
  getPaymentDetail,
  listPayments,
  rejectPayment,
} from '../lib/payments';
import { defaultResidentPassword, checkNewPassword, hashPassword, verifyPassword } from '../lib/password';
import { pbkdf2Iterations } from '../lib/config';
import { billingStartConfigured, getSettings, saveSettings } from '../lib/settings';
import { listAuditLogs } from '../lib/audit';

function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

function unauthorized(): Response {
  return json({ error: 'Belum masuk atau sesi berakhir.' }, 401);
}

function forbidden(): Response {
  return json({ error: 'Tidak punya hak akses untuk data ini.' }, 403);
}

function guard(c: Context<AppEnv>, role?: 'admin' | 'resident'): SessionUser | Response {
  const user = c.get('user');
  if (!user) return unauthorized();
  if (role && user.role !== role) return forbidden();
  return user;
}

function clientIp(c: Context<AppEnv>): string | null {
  return c.req.header('CF-Connecting-IP') ?? c.req.header('x-forwarded-for') ?? null;
}

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

const houseSchema = z.object({
  houseType: z.string().min(1).max(40),
  block: z.string().min(1).max(20),
  occupancyStatus: z.enum(['berpenghuni', 'kosong', 'tanah_kosong', 'belum_dihuni']).default('berpenghuni'),
  isActive: z.boolean().default(true),
  ownerName: z.string().max(80).optional(),
  notes: z.string().max(200).optional(),
  billingStartMonth: z.string().optional(),
});

const houseUpdateSchema = z.object({
  occupancyStatus: z.enum(['berpenghuni', 'kosong', 'tanah_kosong', 'belum_dihuni']),
  isActive: z.boolean(),
  ownerName: z.string().max(80).optional(),
  notes: z.string().max(200).optional(),
  billingStartMonth: z.string().optional(),
});

export function registerApiRoutes(app: Hono<AppEnv>): void {
  app.post('/api/auth/login', async (c) => {
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Identifier dan password wajib diisi.' }, 400);

    const { identifier, password } = parsed.data;
    const rate = await checkLoginRate(c.env.DB, identifier.toLowerCase());
    if (!rate.allowed) {
      const minutes = rate.lockedUntil ? minutesUntil(rate.lockedUntil) : LOGIN_LOCK_MINUTES;
      return json({ error: `Terlalu banyak percobaan login. Coba lagi dalam ${minutes} menit.` }, 429);
    }

    const row = await c.env.DB.prepare(
      `SELECT u.id, u.role, u.password_hash, u.must_change_password, u.is_active
       FROM users u
       WHERE u.username = ? COLLATE NOCASE OR u.email = ? COLLATE NOCASE
       LIMIT 1`,
    )
      .bind(identifier, identifier)
      .first<{ id: number; role: 'admin' | 'resident'; password_hash: string; must_change_password: number; is_active: number }>();

    const valid = row && row.is_active === 1 ? await verifyPassword(password, row.password_hash) : false;
    if (!row || !valid) {
      await recordLoginFailure(c.env.DB, identifier.toLowerCase());
      return json({ error: 'Username atau password salah.' }, 401);
    }

    await clearLoginFailures(c.env.DB, identifier.toLowerCase());
    await c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(jakartaTimestamp(), row.id).run();
    await logAudit(c.env.DB, { actorId: row.id, action: 'login', entityType: 'user', entityId: row.id, ip: clientIp(c) });

    const token = await issueSessionToken(c.env, row.id);
    const secure = new URL(c.req.url).protocol === 'https:';
    return json(
      { ok: true, role: row.role, mustChangePassword: row.must_change_password === 1 },
      200,
      { 'Set-Cookie': sessionCookie(token, secure) },
    );
  });

  app.post('/api/auth/logout', async (c) => {
    const user = c.get('user');
    if (user) {
      await logAudit(c.env.DB, { actorId: user.id, action: 'logout', entityType: 'user', entityId: user.id, ip: clientIp(c) });
    }
    return json({ ok: true }, 200, { 'Set-Cookie': expiredSessionCookie() });
  });

  app.post('/api/auth/change-password', async (c) => {
    const user = guard(c);
    if (user instanceof Response) return user;

    const body = (await c.req.json().catch(() => null)) as { current?: string; next?: string } | null;
    const current = String(body?.current ?? '');
    const next = String(body?.next ?? '');

    const row = await c.env.DB.prepare('SELECT password_hash FROM users WHERE id = ?')
      .bind(user.id)
      .first<{ password_hash: string }>();
    if (!row || !(await verifyPassword(current, row.password_hash))) {
      return json({ error: 'Password saat ini tidak sesuai.' }, 400);
    }

    const defaultPassword = user.role === 'resident' && user.block ? defaultResidentPassword(user.block) : null;
    const check = checkNewPassword(next, next, defaultPassword);
    if (!check.ok) return json({ error: check.message }, 400);

    const hash = await hashPassword(next, pbkdf2Iterations(c.env));
    await c.env.DB.prepare('UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?')
      .bind(hash, jakartaTimestamp(), user.id)
      .run();
    await logAudit(c.env.DB, { actorId: user.id, action: 'change_password', entityType: 'user', entityId: user.id, ip: clientIp(c) });
    return json({ ok: true });
  });

  app.get('/api/public/summary', async (c) => {
    const settings = await getSettings(c.env.DB);
    const board = await publicBoard(c.env.DB, settings);
    return json({
      month: board.month,
      balance: board.balance,
      income: board.income,
      expense: board.expense,
      counts: board.counts,
    });
  });

  app.get('/api/public/houses', async (c) => {
    const settings = await getSettings(c.env.DB);
    const board = await publicBoard(c.env.DB, settings);
    return json({
      month: board.month,
      houses: board.houses.map((house) => ({
        block: house.block,
        status: house.status,
        note: house.note,
      })),
    });
  });

  app.get('/api/warga/me', async (c) => {
    const user = guard(c, 'resident');
    if (user instanceof Response) return user;
    const house = await getHouse(c.env.DB, user.houseId!);
    if (!house) return json({ error: 'Rumah tidak ditemukan.' }, 404);
    const settings = await getSettings(c.env.DB);
    const info = await statusForHouse(c.env.DB, house, settings);
    return json({
      house: { block: house.block, houseCode: house.house_code, occupancyStatus: occupancyLabel(house.occupancy_status) },
      monthlyFee: settings.monthlyFee,
      status: info.status,
      paidUntil: info.paidUntil,
      unpaidMonths: info.unpaidMonths,
      pendingMonths: info.pendingMonths,
      totalDue: info.totalDue,
    });
  });

  app.get('/api/warga/unpaid-months', async (c) => {
    const user = guard(c, 'resident');
    if (user instanceof Response) return user;
    const house = await getHouse(c.env.DB, user.houseId!);
    if (!house) return json({ error: 'Rumah tidak ditemukan.' }, 404);
    const settings = await getSettings(c.env.DB);
    const info = await statusForHouse(c.env.DB, house, settings);
    return json({
      monthlyFee: settings.monthlyFee,
      unpaidMonths: info.unpaidMonths,
      pendingMonths: info.pendingMonths,
      totalDue: info.totalDue,
    });
  });

  app.post('/api/warga/payments', async (c) => {
    const user = guard(c, 'resident');
    if (user instanceof Response) return user;

    const house = await getHouse(c.env.DB, user.houseId!);
    if (!house) return json({ error: 'Rumah tidak ditemukan.' }, 404);

    const contentType = c.req.header('content-type') ?? '';
    let months: string[] = [];
    let note = '';
    let fileValue: File | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData();
      months = form.getAll('months').map((value) => String(value));
      note = String(form.get('note') ?? '');
      const proof = form.get('proof');
      fileValue = proof instanceof File ? proof : null;
    } else {
      const body = (await c.req.json().catch(() => null)) as { months?: string[]; note?: string } | null;
      months = Array.isArray(body?.months) ? body!.months!.map(String) : [];
      note = String(body?.note ?? '');
    }

    const fileCheck = validateUploadFile(fileValue);
    if (!fileCheck.ok) return json({ error: fileCheck.message }, 400);

    const settings = await getSettings(c.env.DB);
    const info = await statusForHouse(c.env.DB, house, settings);

    const stored = await storeFile(c.env, { file: fileValue as File, fileType: 'payment_proof', userId: user.id });
    const result = await createPaymentSubmission(c.env, {
      houseId: house.id,
      userId: user.id,
      months,
      unpaid: info.unpaidMonths,
      fileId: stored.id,
      note,
      settings,
      ip: clientIp(c),
    });

    if (!result.ok) {
      await deleteFile(c.env, stored.id);
      return json({ error: result.message }, 400);
    }
    return json({ ok: true, paymentId: result.paymentId, status: 'pending' }, 201);
  });

  app.get('/api/warga/payments', async (c) => {
    const user = guard(c, 'resident');
    if (user instanceof Response) return user;
    const payments = await listPayments(c.env.DB, { houseId: user.houseId!, limit: 100 });
    return json({ payments });
  });

  app.get('/api/warga/payments/:id', async (c) => {
    const user = guard(c, 'resident');
    if (user instanceof Response) return user;
    const payment = await getPaymentDetail(c.env.DB, Number(c.req.param('id')));
    if (!payment || payment.house_id !== user.houseId) return json({ error: 'Pembayaran tidak ditemukan.' }, 404);
    return json({ payment });
  });

  app.get('/api/admin/summary', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const settings = await getSettings(c.env.DB);
    const month = currentMonth();
    const [balance, totals, statuses] = await Promise.all([
      cashBalance(c.env.DB, settings),
      periodTotals(c.env.DB, month),
      statusListFor(c.env.DB, settings),
    ]);
    const counts = { lunas: 0, menunggu: 0, sudah: 0, belum: 0, nonaktif: 0 };
    for (const entry of statuses) counts[entry.info.status] += 1;
    return json({ month, balance, income: totals.income, expense: totals.expense, counts });
  });

  app.get('/api/admin/houses', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const settings = await getSettings(c.env.DB);
    const statuses = await statusListFor(c.env.DB, settings);
    return json({
      houses: statuses.map((entry) => ({
        id: entry.house.id,
        houseCode: entry.house.house_code,
        block: entry.house.block,
        occupancyStatus: entry.house.occupancy_status,
        isActive: entry.house.is_active === 1,
        ownerName: entry.house.owner_name,
        paidUntil: entry.info.paidUntil,
        unpaidMonths: entry.info.unpaidMonths,
        status: entry.info.status,
      })),
    });
  });

  app.post('/api/admin/houses', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const parsed = houseSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Data rumah tidak lengkap.', detail: parsed.error.flatten() }, 400);

    const result = await createHouse(c.env, parsed.data, user.id, clientIp(c));
    return json({ ok: true, houseId: result.houseId, houseCode: result.houseCode, defaultPassword: result.defaultPassword }, 201);
  });

  app.patch('/api/admin/houses/:id', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const parsed = houseUpdateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return json({ error: 'Data rumah tidak lengkap.', detail: parsed.error.flatten() }, 400);

    const id = Number(c.req.param('id'));
    const result = await updateHouse(
      c.env,
      id,
      parsed.data,
      user.id,
      clientIp(c),
    );
    if (!result.ok) return json({ error: result.message }, 404);
    return json({ ok: true });
  });

  app.post('/api/admin/houses/import', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const body = (await c.req.json().catch(() => null)) as { csv?: string } | null;
    if (!body?.csv) return json({ error: 'Field csv wajib diisi.' }, 400);

    const parsed = parseHouseCsv(body.csv);
    const report = await importHouses(c.env, parsed.rows, user.id, clientIp(c));
    return json({ ok: true, created: report.created, errors: report.errors });
  });

  app.post('/api/admin/houses/:id/reset-password', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const result = await resetResidentPassword(c.env, Number(c.req.param('id')), user.id, clientIp(c));
    if (!result.ok) return json({ error: result.message }, 404);
    return json({ ok: true, password: result.password });
  });

  app.get('/api/admin/payments', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const statusParam = c.req.query('status');
    const status = statusParam === 'pending' || statusParam === 'verified' || statusParam === 'rejected' ? statusParam : undefined;
    return json({ payments: await listPayments(c.env.DB, { status, limit: 200 }) });
  });

  app.get('/api/admin/payments/pending', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    return json({ payments: await listPayments(c.env.DB, { status: 'pending', limit: 200 }) });
  });

  app.get('/api/admin/payments/:id', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const payment = await getPaymentDetail(c.env.DB, Number(c.req.param('id')));
    if (!payment) return json({ error: 'Pembayaran tidak ditemukan.' }, 404);
    return json({ payment });
  });

  app.post('/api/admin/payments/:id/approve', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const result = await approvePayment(c.env, { paymentId: Number(c.req.param('id')), adminId: user.id, ip: clientIp(c) });
    if (!result.ok) return json({ error: result.message }, 400);
    return json({ ok: true, status: 'verified' });
  });

  app.post('/api/admin/payments/:id/reject', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const body = (await c.req.json().catch(() => null)) as { reason?: string } | null;
    const result = await rejectPayment(c.env, {
      paymentId: Number(c.req.param('id')),
      adminId: user.id,
      reason: String(body?.reason ?? ''),
      ip: clientIp(c),
    });
    if (!result.ok) return json({ error: result.message }, 400);
    return json({ ok: true, status: 'rejected' });
  });

  app.get('/api/admin/expenses', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    return json({ expenses: await listExpenses(c.env.DB) });
  });

  app.post('/api/admin/expenses', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;

    const contentType = c.req.header('content-type') ?? '';
    let expenseDate = '';
    let description = '';
    let amount: number | null = null;
    let fileId: number | null = null;

    if (contentType.includes('multipart/form-data')) {
      const form = await c.req.formData();
      expenseDate = String(form.get('expenseDate') ?? '');
      description = String(form.get('description') ?? '').trim();
      amount = parseRupiah(String(form.get('amount') ?? ''));
      const proof = form.get('proof');
      if (proof instanceof File && proof.size > 0) {
        const check = validateUploadFile(proof);
        if (!check.ok) return json({ error: check.message }, 400);
        const stored = await storeFile(c.env, { file: proof, fileType: 'expense_proof', userId: user.id });
        fileId = stored.id;
      }
    } else {
      const body = (await c.req.json().catch(() => null)) as
        | { expenseDate?: string; description?: string; amount?: number | string }
        | null;
      expenseDate = String(body?.expenseDate ?? '');
      description = String(body?.description ?? '').trim();
      amount = typeof body?.amount === 'number' ? body.amount : parseRupiah(String(body?.amount ?? ''));
    }

    if (!description) return json({ error: 'Keterangan wajib diisi.' }, 400);
    if (amount === null || amount <= 0) return json({ error: 'Nominal pengeluaran tidak valid.' }, 400);
    if (expenseDate && !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)) {
      return json({ error: 'Tanggal pengeluaran tidak valid.' }, 400);
    }

    const created = await createExpense(c.env, {
      expenseDate,
      description,
      amount,
      fileId,
      userId: user.id,
      ip: clientIp(c),
    });
    return json({ ok: true, expenseId: created.id }, 201);
  });

  app.get('/api/admin/expenses/:id', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const expense = await getExpense(c.env.DB, Number(c.req.param('id')));
    if (!expense) return json({ error: 'Pengeluaran tidak ditemukan.' }, 404);
    return json({ expense });
  });

  app.get('/api/admin/reports/monthly', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const settings = await getSettings(c.env.DB);
    const monthParam = c.req.query('month');
    const month = monthParam && isMonth(monthParam) ? monthParam : currentMonth();
    const report = await monthlyReport(c.env.DB, settings, month);
    return json({ ...report, billingStartConfigured: billingStartConfigured(settings) });
  });

  app.get('/api/admin/settings', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const settings = await getSettings(c.env.DB);
    return json({ settings, billingStartConfigured: billingStartConfigured(settings) });
  });

  app.patch('/api/admin/settings', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return json({ error: 'Body JSON wajib diisi.' }, 400);

    const patch: Record<string, string> = {};
    if (body.monthlyFee !== undefined) {
      const fee = parseRupiah(String(body.monthlyFee));
      if (fee === null || fee < 0) return json({ error: 'Nominal iuran tidak valid.' }, 400);
      patch.monthly_fee = String(fee);
    }
    if (body.openingBalance !== undefined) {
      const opening = parseRupiah(String(body.openingBalance));
      if (opening === null || opening < 0) return json({ error: 'Saldo awal tidak valid.' }, 400);
      patch.opening_balance = String(opening);
    }
    if (body.openingBalanceDate !== undefined) {
      patch.opening_balance_date = String(body.openingBalanceDate);
    }
    if (body.globalBillingStartMonth !== undefined) {
      const value = String(body.globalBillingStartMonth);
      if (value && !isMonth(value)) return json({ error: 'Bulan awal tagihan tidak valid.' }, 400);
      patch.global_billing_start_month = value;
    }
    if (Object.keys(patch).length === 0) return json({ error: 'Tidak ada field yang diubah.' }, 400);

    await saveSettings(c.env.DB, patch);
    await logAudit(c.env.DB, {
      actorId: user.id,
      action: 'update_settings',
      entityType: 'settings',
      newValues: patch,
      ip: clientIp(c),
    });
    return json({ ok: true, settings: await getSettings(c.env.DB) });
  });

  app.get('/api/admin/audit', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    return json({ logs: await listAuditLogs(c.env.DB, 200) });
  });

  app.post('/api/admin/files/upload', async (c) => {
    const user = guard(c, 'admin');
    if (user instanceof Response) return user;
    const form = await c.req.formData();
    const file = form.get('file');
    const fileType = String(form.get('file_type') ?? 'expense_proof');

    if (!(file instanceof File)) return json({ error: 'Field file wajib diisi.' }, 400);
    if (fileType !== 'expense_proof' && fileType !== 'payment_proof') {
      return json({ error: 'file_type harus expense_proof atau payment_proof.' }, 400);
    }
    const check = validateUploadFile(file);
    if (!check.ok) return json({ error: check.message }, 400);

    const stored = await storeFile(c.env, { file, fileType, userId: user.id });
    return json({ ok: true, file: stored }, 201);
  });

  app.get('/api/files/:id', async (c) => {
    const user = guard(c);
    if (user instanceof Response) return user;
    const id = Number(c.req.param('id'));
    const row = Number.isInteger(id) ? await getFileRow(c.env.DB, id) : null;
    if (!row) return json({ error: 'File tidak ditemukan.' }, 404);

    const allowed = await canAccessFile(c.env.DB, user, row);
    if (!allowed) return json({ error: 'Tidak punya hak akses untuk file ini.' }, 403);

    const object = await loadFileObject(c.env, row);
    if (!object) return json({ error: 'File tidak ada di penyimpanan.' }, 404);

    return new Response(object.body, {
      headers: {
        'content-type': row.mime_type ?? 'application/octet-stream',
        'content-disposition': `inline; filename="${row.original_name.replace(/"/g, '')}"`,
        'cache-control': 'private, max-age=60',
      },
    });
  });
}
