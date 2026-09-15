// Hash password dengan PBKDF2-SHA256 lewat Web Crypto.
// Format: pbkdf2$sha256$<iterasi>$<salt base64>$<hash base64>
// Jumlah iterasi disimpan di dalam hash sehingga nilai bisa dinaikkan tanpa merusak akun lama.

const KEY_BITS = 256;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string, iterations = 15000): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, iterations);
  return `pbkdf2$sha256$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
  const iterations = Number(parts[2]);
  if (!Number.isFinite(iterations) || iterations <= 0) return false;
  const salt = fromBase64(parts[3]!);
  const expected = fromBase64(parts[4]!);
  const actual = await derive(password, salt, iterations);
  return constantTimeEqual(actual, expected);
}

export type PasswordCheck = { ok: true } | { ok: false; message: string };

/** Aturan password baru: minimal 8 karakter dan tidak sama dengan password default. */
export function checkNewPassword(password: string, confirm: string, defaultValue?: string | null): PasswordCheck {
  if (password.length < 8) return { ok: false, message: 'Password minimal 8 karakter.' };
  if (password !== confirm) return { ok: false, message: 'Ulangi password baru dengan isi yang sama.' };
  if (defaultValue && password === defaultValue) {
    return { ok: false, message: 'Password tidak boleh sama dengan password default.' };
  }
  return { ok: true };
}

export const DEFAULT_PASSWORD_PREFIX = 'Bagarry';

/** Password default warga: "Bagarry" + blok, contoh Blok "C4/06" -> "BagarryC4/06". */
export function defaultResidentPassword(block: string): string {
  return `${DEFAULT_PASSWORD_PREFIX}${block}`;
}
