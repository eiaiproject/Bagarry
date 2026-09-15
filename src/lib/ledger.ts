import type { Month } from './date';
import { addMonths, currentMonth, isMonth, monthStart } from './date';
import type { HouseStatus } from './houses';
import { statusListFor } from './houses';
import type { Settings } from './settings';

export interface PeriodTotals {
  income: number;
  expense: number;
}

export interface PublicBoardHouse {
  id: number;
  block: string;
  houseCode: string;
  status: HouseStatus;
  note: string;
  totalDue: number;
}

export interface PublicBoard {
  month: Month;
  balance: number;
  income: number;
  expense: number;
  counts: { active: number; lunas: number; menunggu: number; sudah: number; belum: number; nonaktif: number };
  houses: PublicBoardHouse[];
}

/** Saldo = saldo awal + pemasukan verified - pengeluaran. */
export async function cashBalance(db: D1Database, settings: Settings): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN entry_type = 'income' THEN amount ELSE -amount END), 0) AS total
       FROM ledger_entries`,
    )
    .first<{ total: number }>();
  return settings.openingBalance + (row?.total ?? 0);
}

export async function periodTotals(db: D1Database, month: Month): Promise<PeriodTotals> {
  const start = monthStart(month);
  const end = monthStart(addMonths(month, 1));
  const row = await db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN entry_type = 'income' THEN amount ELSE 0 END), 0) AS income,
         COALESCE(SUM(CASE WHEN entry_type = 'expense' THEN amount ELSE 0 END), 0) AS expense
       FROM ledger_entries
       WHERE entry_date >= ? AND entry_date < ?`,
    )
    .bind(start, end)
    .first<PeriodTotals>();
  return { income: row?.income ?? 0, expense: row?.expense ?? 0 };
}

/** Data papan pengumuman publik: tanpa nama pemilik dan tanpa bukti transfer. */
export async function publicBoard(db: D1Database, settings: Settings, today: Date = new Date()): Promise<PublicBoard> {
  const month = currentMonth(today);
  const [balance, totals, statuses] = await Promise.all([
    cashBalance(db, settings),
    periodTotals(db, month),
    statusListFor(db, settings, today),
  ]);

  const counts = { active: 0, lunas: 0, menunggu: 0, sudah: 0, belum: 0, nonaktif: 0 };
  const houses: PublicBoardHouse[] = statuses.map((entry) => {
    if (entry.info.status === 'nonaktif') {
      counts.nonaktif += 1;
    } else {
      counts.active += 1;
      counts[entry.info.status] += 1;
    }
    return {
      id: entry.house.id,
      block: entry.house.block,
      houseCode: entry.house.house_code,
      status: entry.info.status,
      note: entry.info.note,
      totalDue: entry.info.totalDue,
    };
  });

  return { month, balance, income: totals.income, expense: totals.expense, counts, houses };
}

export interface ReportIncomeRow {
  id: number;
  entry_date: string;
  amount: number;
  block: string | null;
  months: Month[];
}

export interface ReportExpenseRow {
  id: number;
  entry_date: string;
  amount: number;
  description: string;
}

export interface MonthlyReport {
  month: Month;
  openingBalance: number;
  income: number;
  expense: number;
  closingBalance: number;
  incomeRows: ReportIncomeRow[];
  expenseRows: ReportExpenseRow[];
}

export async function monthlyReport(db: D1Database, settings: Settings, month: Month): Promise<MonthlyReport> {
  const start = monthStart(month);
  const end = monthStart(addMonths(month, 1));

  const [beforeRow, incomeRes, expenseRes] = await Promise.all([
    db
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN entry_type = 'income' THEN amount ELSE -amount END), 0) AS total
         FROM ledger_entries WHERE entry_date < ?`,
      )
      .bind(start)
      .first<{ total: number }>(),
    db
      .prepare(
        `SELECT l.id, l.entry_date, l.amount, l.payment_id, h.block
         FROM ledger_entries l
         LEFT JOIN houses h ON h.id = l.house_id
         WHERE l.entry_type = 'income' AND l.entry_date >= ? AND l.entry_date < ?
         ORDER BY l.entry_date DESC, l.id DESC`,
      )
      .bind(start, end)
      .all<{ id: number; entry_date: string; amount: number; payment_id: number | null; block: string | null }>(),
    db
      .prepare(
        `SELECT id, entry_date, amount, description
         FROM ledger_entries
         WHERE entry_type = 'expense' AND entry_date >= ? AND entry_date < ?
         ORDER BY entry_date DESC, id DESC`,
      )
      .bind(start, end)
      .all<ReportExpenseRow>(),
  ]);

  const paymentIds = incomeRes.results.map((row) => row.payment_id).filter((id): id is number => id !== null);
  const monthsByPayment = new Map<number, Month[]>();
  if (paymentIds.length > 0) {
    const { results } = await db
      .prepare(
        `SELECT payment_id, period_month FROM payment_items
         WHERE payment_id IN (${paymentIds.map(() => '?').join(',')}) AND status = 'paid'
         ORDER BY period_month`,
      )
      .bind(...paymentIds)
      .all<{ payment_id: number; period_month: string }>();
    for (const item of results) {
      if (!isMonth(item.period_month)) continue;
      const list = monthsByPayment.get(item.payment_id) ?? [];
      list.push(item.period_month);
      monthsByPayment.set(item.payment_id, list);
    }
  }

  const incomeRows: ReportIncomeRow[] = incomeRes.results.map((row) => ({
    id: row.id,
    entry_date: row.entry_date,
    amount: row.amount,
    block: row.block,
    months: row.payment_id ? monthsByPayment.get(row.payment_id) ?? [] : [],
  }));

  const income = incomeRows.reduce((sum, row) => sum + row.amount, 0);
  const expenseRows = expenseRes.results;
  const expense = expenseRows.reduce((sum, row) => sum + row.amount, 0);
  const openingBalance = settings.openingBalance + (beforeRow?.total ?? 0);

  return {
    month,
    openingBalance,
    income,
    expense,
    closingBalance: openingBalance + income - expense,
    incomeRows,
    expenseRows,
  };
}
