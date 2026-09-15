#!/usr/bin/env node
// Menghasilkan hash password dengan format yang sama seperti src/lib/password.ts.
// Pakai: node scripts/hash-password.mjs "PasswordBaru"
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const ITERATIONS = Number(process.env.PBKDF2_ITERATIONS ?? 15000);
const PASSWORD = process.argv[2];

if (!PASSWORD) {
  console.error('Pakai: node scripts/hash-password.mjs "PasswordBaru"');
  process.exit(1);
}

const salt = randomBytes(16);
const hash = pbkdf2Sync(PASSWORD, salt, ITERATIONS, 32, 'sha256');
console.log(`pbkdf2$sha256$${ITERATIONS}$${salt.toString('base64')}$${hash.toString('base64')}`);
