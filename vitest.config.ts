import { defineConfig } from 'vitest/config';

// Unit test hanya berisi logika murni di test/. Berkas e2e/*.spec.ts milik Playwright,
// jadi keduanya harus dipisah supaya `npm test` tidak mencoba memuat berkas Playwright.
export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['node_modules/**', '.wrangler/**', 'e2e/**'],
  },
});
