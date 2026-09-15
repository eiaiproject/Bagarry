import type { Month } from './date';
import { currentMonth } from './date';
import { parseRupiah } from './money';

export interface Settings {
  monthlyFee: number;
  openingBalance: number;
  openingBalanceDate: string;
  /** Kosong berarti belum diatur; sistem memakai bulan berjalan. */
  globalBillingStartMonth: Month | '';
}

export const SETTING_KEYS = {
  monthlyFee: 'monthly_fee',
  openingBalance: 'opening_balance',
  openingBalanceDate: 'opening_balance_date',
  globalBillingStartMonth: 'global_billing_start_month',
} as const;

export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const map = new Map(results.map((row) => [row.key, row.value]));
  const fee = parseRupiah(map.get(SETTING_KEYS.monthlyFee) ?? '');
  const opening = parseRupiah(map.get(SETTING_KEYS.openingBalance) ?? '');
  const globalStart = map.get(SETTING_KEYS.globalBillingStartMonth) ?? '';
  return {
    monthlyFee: fee ?? 50000,
    openingBalance: opening ?? 0,
    openingBalanceDate: map.get(SETTING_KEYS.openingBalanceDate) ?? '',
    globalBillingStartMonth: /^\d{4}-\d{2}$/.test(globalStart) ? globalStart : '',
  };
}

export type SettingKey = (typeof SETTING_KEYS)[keyof typeof SETTING_KEYS];

export async function saveSettings(db: D1Database, values: Partial<Record<SettingKey, string>>): Promise<void> {
  const entries = Object.entries(values);
  if (entries.length === 0) return;
  await db.batch(
    entries.map(([key, value]) =>
      db
        .prepare(
          `INSERT INTO settings (key, value, updated_at)
           VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%S','now','+7 hours'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        )
        .bind(key, value ?? ''),
    ),
  );
}

/** Bulan awal tagihan: override per rumah, lalu pengaturan global, lalu bulan berjalan. */
export function billingStartMonth(
  house: { billing_start_month: string | null },
  settings: Settings,
  today: Date = new Date(),
): Month {
  return house.billing_start_month || settings.globalBillingStartMonth || currentMonth(today);
}

/** true bila bendahara belum mengatur bulan awal tagihan global. */
export function billingStartConfigured(settings: Settings): boolean {
  return settings.globalBillingStartMonth !== '';
}
