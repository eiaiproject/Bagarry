// Nominal uang selalu integer rupiah. Pengelompokan ribuan dibuat manual
// supaya hasilnya sama di semua runtime tanpa bergantung data locale ICU.
export function formatRupiah(value: number | null | undefined): string {
  const n = Math.trunc(Number(value ?? 0));
  const sign = n < 0 ? '-' : '';
  const digits = String(Math.abs(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `Rp${sign}${digits}`;
}

/** Menerima "150.000", "Rp150000", "150000". Mengembalikan null bila tidak valid. */
export function parseRupiah(input: string): number | null {
  const cleaned = String(input).replace(/rp/gi, '').replace(/[\s._]/g, '').replace(/,/g, '');
  if (!/^-?\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}
