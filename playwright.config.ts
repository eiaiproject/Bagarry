import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// Playwright dipakai tanpa mengunduh peramban baru: kalau Brave, Edge, atau Chrome sudah
// terpasang di mesin, peramban itu yang dipakai lewat executablePath. Set PW_BROWSER_PATH
// untuk menunjuk biner lain, atau jalankan `npx playwright install chromium` lalu hapus
// pilihan ini supaya Playwright memakai peramban bawaannya.
const CANDIDATES = [
  process.env.PW_BROWSER_PATH,
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
].filter((path): path is string => Boolean(path));

const executablePath = CANDIDATES.find((path) => existsSync(path));

const PORT = Number(process.env.E2E_PORT ?? 8787);
const baseURL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './e2e',
  // Satu database lokal dipakai bersama, jadi tes berjalan berurutan, bukan paralel.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL,
    headless: true,
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT}`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
