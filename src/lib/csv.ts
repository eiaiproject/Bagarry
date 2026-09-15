import { OCCUPANCY_OPTIONS, type ImportRow, type OccupancyStatus } from './houses';

const OCCUPANCY_VALUES = OCCUPANCY_OPTIONS.map((option) => option.value as string);

export interface CsvParseResult {
  rows: ImportRow[];
  errors: { line: number; message: string }[];
}

function parseActive(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (['1', 'ya', 'true', 'y', 'aktif'].includes(normalized)) return true;
  if (['0', 'tidak', 'false', 'n', 'nonaktif'].includes(normalized)) return false;
  if (normalized === '') return true;
  return null;
}

/**
 * Format CSV: jenis_rumah,blok,status_huni,aktif,nama_pemilik
 * Baris header opsional. Baris kosong dan baris diawali # dilewati.
 */
export function parseHouseCsv(text: string): CsvParseResult {
  const rows: ImportRow[] = [];
  const errors: { line: number; message: string }[] = [];

  text
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const lineNumber = index + 1;
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return;

      const cells = line.split(',').map((cell) => cell.trim());
      const [houseType = '', block = '', occupancyRaw = '', activeRaw = '', ownerName = ''] = cells;

      if (/^(jenis|house_type|tipe)/i.test(houseType)) return; // baris header

      if (!houseType || !block) {
        errors.push({ line: lineNumber, message: 'Kolom jenis rumah dan blok wajib diisi.' });
        return;
      }
      if (/\s/.test(houseType) || /\s/.test(block)) {
        errors.push({ line: lineNumber, message: 'Jenis rumah dan blok tidak boleh mengandung spasi.' });
        return;
      }

      const occupancy = (occupancyRaw || 'berpenghuni').toLowerCase();
      if (!OCCUPANCY_VALUES.includes(occupancy)) {
        errors.push({
          line: lineNumber,
          message: `Status huni "${occupancyRaw}" tidak dikenal. Pilihan: ${OCCUPANCY_VALUES.join(', ')}.`,
        });
        return;
      }

      const isActive = parseActive(activeRaw);
      if (isActive === null) {
        errors.push({ line: lineNumber, message: `Kolom aktif "${activeRaw}" harus 1/0, ya/tidak, atau kosong.` });
        return;
      }

      rows.push({
        houseType,
        block,
        occupancyStatus: occupancy as OccupancyStatus,
        isActive,
        ownerName: ownerName || undefined,
        line: lineNumber,
      });
    });

  return { rows, errors };
}
