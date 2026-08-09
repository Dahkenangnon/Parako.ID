import { describe, expect, it, vi } from 'vitest';

import {
  formatCsvExport,
  formatJsonExport,
  generateCsvTemplate,
  generateJsonTemplate,
} from '../../../../src/services/data-transfer/format-utils.js';
import type { EntityColumnDef } from '../../../../src/services/data-transfer/types.js';

const customFormatter = vi.fn((value: unknown) => `custom:${String(value)}`);

const columns: EntityColumnDef[] = [
  {
    field: 'name',
    header: 'Name',
    required: true,
    group: 'core',
  },
  {
    field: 'createdAt',
    header: 'Created At',
    group: 'core',
  },
  {
    field: 'roles',
    header: 'Roles',
    group: 'core',
  },
  {
    field: 'empty',
    header: 'Empty',
    group: 'core',
  },
  {
    field: 'formatted',
    header: 'Formatted',
    group: 'core',
    formatter: customFormatter,
  },
];

describe('data-transfer format utilities', () => {
  it('formats CSV exports with a UTF-8 BOM, headers, and typed values', async () => {
    const buffer = await formatCsvExport(
      columns.map(column => column.header),
      [
        {
          name: 'Maria, Example',
          createdAt: new Date('2026-08-01T12:00:00.000Z'),
          roles: ['admin', 'user'],
          empty: null,
          formatted: 42,
        },
        {
          name: 7,
          createdAt: undefined,
          roles: [],
          empty: undefined,
          formatted: false,
        },
      ],
      columns
    );

    expect(buffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const csv = buffer.subarray(3).toString('utf8');
    expect(csv).toContain('Name,Created At,Roles,Empty,Formatted');
    expect(csv).toContain('"Maria, Example"');
    expect(csv).toContain('2026-08-01T12:00:00.000Z');
    expect(csv).toContain('admin;user');
    expect(csv).toContain('custom:42');
    expect(csv).toContain('custom:false');
    expect(customFormatter).toHaveBeenCalledTimes(2);
  });

  it('neutralizes spreadsheet formulas from raw and formatter-produced cells', async () => {
    const formulaColumns: EntityColumnDef[] = [
      {
        field: 'raw',
        header: 'Raw',
        group: 'core',
      },
      {
        field: 'formatted',
        header: 'Formatted',
        group: 'core',
        formatter: () => '@SUM(A1:A2)',
      },
    ];

    const buffer = await formatCsvExport(
      formulaColumns.map(column => column.header),
      [{ raw: '=HYPERLINK("https://example.invalid")', formatted: 'ignored' }],
      formulaColumns
    );

    const csv = buffer.subarray(3).toString('utf8');
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'@SUM(A1:A2)");
  });

  it('generates compact and pretty JSON exports', () => {
    const items = [{ id: 1, name: 'Maria' }];
    expect(formatJsonExport(items).toString('utf8')).toBe(
      '[{"id":1,"name":"Maria"}]'
    );
    expect(formatJsonExport(items, { pretty: false }).toString('utf8')).toBe(
      '[{"id":1,"name":"Maria"}]'
    );
    expect(formatJsonExport(items, { pretty: true }).toString('utf8')).toBe(
      JSON.stringify(items, null, 2)
    );
  });

  it('generates a CSV template with BOM, headers, and required markers', async () => {
    const buffer = await generateCsvTemplate(columns.slice(0, 2));
    expect(buffer.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    const csv = buffer.subarray(3).toString('utf8');
    expect(csv).toContain('Name,Created At');
    expect(csv).toContain('<required>');
  });

  it('generates a pretty JSON template keyed by field names', () => {
    expect(
      JSON.parse(generateJsonTemplate(columns.slice(0, 2)).toString('utf8'))
    ).toEqual([{ name: '<required>', createdAt: '' }]);
  });
});
