import type { Env, Role, SessionUser } from '../env';
import { sessionSecret } from './config';
import { jakartaTimestamp } from './date';

export const SESSION_COOKIE = 'bagarry_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
export const LOGIN_MAX_ATTEMPTS = 5;
export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_LOCK_MINUTES = 15;

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmac(env: Env, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(sessionSecret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toBase64Url(new Uint8Array(signature));
}

export async function issueSessionToken(env: Env, userId: number): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${userId}.${exp}`;
  return `${toBase64Url(encoder.encode(payload))}.${await hmac(env, payload)}`;
}

export async function readSessionUserId(env: Env, token: string | undefined): Promise<number | null> {
  if (!token) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  let payload: string;
  try {
    payload = new TextDecoder().decode(fromBase64Url(encoded));
  } catch {
    return null;
  }
  if ((await hmac(env, payload)) !== signature) return null;
  const [userId, exp] = payload.split('.');
  if (!userId || !exp) return null;
  if (Number(exp) * 1000 < Date.now()) return null;
  const id = Number(userId);
  return Number.isInteger(id) ? id : null;
}

export function sessionCookie(token: string, secure: boolean): string {
  const attrs = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

export function expiredSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}

interface UserRow {
  id: number;
  role: Role;
  username: string | null;
  email: string | null;
  house_id: number | null;
  house_code: string | null;
  block: string | null;
  must_change_password: number;
  is_active: number;
}

export async function findUserById(db: D1Database, id: number): Promise<SessionUser | null> {
  const row = await db
    .prepare(
      `SELECT u.id, u.role, u.username, u.email, u.house_id, u.must_change_password, u.is_active,
              h.house_code, h.block
       FROM users u
       LEFT JOIN houses h ON h.id = u.house_id
       WHERE u.id = ?`,
    )
    .bind(id)
    .first<UserRow>();
  if (!row || row.is_active !== 1) return null;
  return {
    id: row.id,
    role: row.role,
    username: row.username,
    email: row.email,
    houseId: row.house_id,
    houseCode: row.house_code,
    block: row.block,
    mustChangePassword: row.must_change_password === 1,
  };
}

export interface LoginRateState {
  allowed: boolean;
  lockedUntil: string | null;
}

export async function checkLoginRate(db: D1Database, identifier: string): Promise<LoginRateState> {
  const row = await db
    .prepare('SELECT attempts, window_start, locked_until FROM login_attempts WHERE identifier = ?')
    .bind(identifier)
    .first<{ attempts: number; window_start: string; locked_until: string | null }>();
  if (!row) return { allowed: true, lockedUntil: null };
  const now = jakartaTimestamp();
  if (row.locked_until && row.locked_until > now) return { allowed: false, lockedUntil: row.locked_until };
  return { allowed: true, lockedUntil: null };
}

export async function recordLoginFailure(db: D1Database, identifier: string): Promise<void> {
  const now = jakartaTimestamp();
  const windowStart = jakartaTimestamp(new Date(Date.now() - LOGIN_WINDOW_MINUTES * 60_000));
  const lockUntil = jakartaTimestamp(new Date(Date.now() + LOGIN_LOCK_MINUTES * 60_000));
  const row = await db
    .prepare('SELECT attempts, window_start FROM login_attempts WHERE identifier = ?')
    .bind(identifier)
    .first<{ attempts: number; window_start: string }>();

  const withinWindow = row && row.window_start >= windowStart;
  const attempts = withinWindow ? row.attempts + 1 : 1;
  const window = withinWindow ? row.window_start : now;
  const lockedUntil = attempts >= LOGIN_MAX_ATTEMPTS ? lockUntil : null;

  await db
    .prepare(
      `INSERT INTO login_attempts (identifier, attempts, window_start, locked_until)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(identifier) DO UPDATE SET attempts = excluded.attempts,
         window_start = excluded.window_start, locked_until = excluded.locked_until`,
    )
    .bind(identifier, attempts, window, lockedUntil)
    .run();
}

export async function clearLoginFailures(db: D1Database, identifier: string): Promise<void> {
  await db.prepare('DELETE FROM login_attempts WHERE identifier = ?').bind(identifier).run();
}

export function minutesUntil(timestamp: string): number {
  const target = Date.parse(timestamp.replace(' ', 'T') + '+07:00');
  if (Number.isNaN(target)) return LOGIN_LOCK_MINUTES;
  return Math.max(1, Math.ceil((target - Date.now()) / 60_000));
}
