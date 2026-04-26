import { writeToBuffer } from '@fast-csv/format';
import type { EntityColumnDef } from './types.js';

/**
 * Generate CSV export buffer with UTF-8 BOM for Excel compatibility.
 */
export async function formatCsvExport(
  headers: string[],
  rows: Record<string, unknown>[],
  columnDefs: EntityColumnDef[]
): Promise<Buffer> {
  const csvRows = rows.map(row => {
    const formatted: Record<string, string> = {};
    for (const col of columnDefs) {
      const value = row[col.field];
      formatted[col.header] = col.formatter
        ? col.formatter(value)
        : formatValue(value);
    }
    return formatted;
  });

  const buffer = await writeToBuffer(csvRows, {
    headers,
    writeHeaders: true,
  });

  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  return Buffer.concat([bom, buffer]);
}

/**
 * Generate JSON export buffer.
 */
export function formatJsonExport(
  items: Record<string, unknown>[],
  options?: { pretty?: boolean }
): Buffer {
  const json = options?.pretty
    ? JSON.stringify(items, null, 2)
    : JSON.stringify(items);
  return Buffer.from(json, 'utf-8');
}

/**
 * Generate CSV import template (header row + 1 example row).
 */
export async function generateCsvTemplate(
  columns: EntityColumnDef[]
): Promise<Buffer> {
  const headers = columns.map(c => c.header);
  const example: Record<string, string> = {};
  for (const col of columns) {
    example[col.header] = col.required ? `<required>` : '';
  }

  const buffer = await writeToBuffer([example], {
    headers,
    writeHeaders: true,
  });

  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  return Buffer.concat([bom, buffer]);
}

/**
 * Generate JSON import template (schema example).
 */
export function generateJsonTemplate(columns: EntityColumnDef[]): Buffer {
  const example: Record<string, string> = {};
  for (const col of columns) {
    example[col.field] = col.required ? `<required>` : '';
  }
  const template = [example];
  return Buffer.from(JSON.stringify(template, null, 2), 'utf-8');
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.join(';');
  return String(value);
}
