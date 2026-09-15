// Utilitas bulan dan waktu. Seluruh sistem memakai zona Asia/Jakarta.
export type Month = string; // format YYYY-MM

const TZ = 'Asia/Jakarta';
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

function jakartaParts(date: Date) {
  const parts = partsFormatter.formatToParts(date);
  const pick = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = pick('hour') === '24' ? '00' : pick('hour');
  return { y: pick('year'), m: pick('month'), d: pick('day'), h: hour, mi: pick('minute'), s: pick('second') };
}

export function jakartaDate(date: Date = new Date()): string {
  const p = jakartaParts(date);
  return `${p.y}-${p.m}-${p.d}`;
}

export function jakartaTimestamp(date: Date = new Date()): string {
  const p = jakartaParts(date);
  return `${p.y}-${p.m}-${p.d} ${p.h}:${p.mi}:${p.s}`;
}

export function currentMonth(date: Date = new Date()): Month {
  return jakartaDate(date).slice(0, 7);
}

export function isMonth(value: unknown): value is Month {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function addMonths(month: Month, delta: number): Month {
  const [yearStr, monthStr] = month.split('-');
  const total = Number(yearStr) * 12 + (Number(monthStr) - 1) + delta;
  const year = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
}

export function monthStart(month: Month): string {
  return `${month}-01`;
}

/** Daftar bulan inklusif dari start sampai end. Kosong bila start melewati end. */
export function monthRange(start: Month, end: Month): Month[] {
  if (start > end) return [];
  const out: Month[] = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 1200) {
    out.push(cursor);
    cursor = addMonths(cursor, 1);
    guard += 1;
  }
  return out;
}

export function isContiguous(months: Month[]): boolean {
  for (let i = 1; i < months.length; i += 1) {
    if (addMonths(months[i - 1]!, 1) !== months[i]) return false;
  }
  return true;
}

export function monthLabel(month: Month): string {
  const [year, m] = month.split('-');
  const name = MONTH_SHORT[Number(m) - 1] ?? m;
  return `${name} ${year}`;
}

/** "Mei – Jul 2026", "Jul 2026", atau "Mei, Agu 2026" bila tidak berurutan. */
export function monthListLabel(months: Month[]): string {
  if (months.length === 0) return '-';
  const sorted = [...months].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  if (sorted.length === 1) return monthLabel(sorted[0]!);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (isContiguous(sorted) && first.slice(0, 4) === last.slice(0, 4)) {
    return `${MONTH_SHORT[Number(first.slice(5)) - 1]} – ${MONTH_SHORT[Number(last.slice(5)) - 1]} ${last.slice(0, 4)}`;
  }
  return sorted.map(monthLabel).join(', ');
}

/** "2026-07-15" -> "15 Jul 2026". */
export function formatDateID(date: string | null | undefined): string {
  if (!date) return '-';
  const [year, month, day] = date.slice(0, 10).split('-');
  if (!year || !month || !day) return '-';
  return `${Number(day)} ${MONTH_SHORT[Number(month) - 1]} ${year}`;
}

/** "2026-07-15 10:20:00" -> "15 Jul 2026, 10:20". */
export function formatDateTimeID(timestamp: string | null | undefined): string {
  if (!timestamp) return '-';
  return `${formatDateID(timestamp)}, ${timestamp.slice(11, 16)}`;
}
