import type { EntityConfigDeps } from './index.js';
import type { IActivity } from '../../../types/activity.js';
import type {
  EntityTransferConfig,
  EntityColumnDef,
  ExportContext,
  ExportFilters,
} from '../types.js';

function parseDateFilter(
  value: unknown,
  fieldName: 'dateFrom' | 'dateTo',
  endOfDay = false
): Date {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid ${fieldName} filter: expected YYYY-MM-DD`);
  }

  const time = endOfDay ? '23:59:59.999' : '00:00:00.000';
  const date = new Date(`${normalized}T${time}Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== normalized
  ) {
    throw new Error(`Invalid ${fieldName} filter: expected YYYY-MM-DD`);
  }
  return date;
}

function parseTypeFilter(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new Error('Invalid type filter: expected a string');
  }

  const normalized = value.trim();
  return normalized && normalized !== 'all' ? normalized : undefined;
}

function parseStatusFilter(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') {
    throw new Error(
      'Invalid status filter: expected all, success, failed, warning, or info'
    );
  }

  const normalized = value.trim();
  if (!normalized || normalized === 'all') return undefined;
  if (!['success', 'failed', 'warning', 'info'].includes(normalized)) {
    throw new Error(
      'Invalid status filter: expected all, success, failed, warning, or info'
    );
  }
  return normalized;
}

export function createActivityEntityConfig(
  deps: EntityConfigDeps
): EntityTransferConfig {
  const { activityService } = deps;

  const exportColumns: EntityColumnDef[] = [
    {
      field: 'timestamp',
      header: 'Timestamp',
      group: 'core',
      formatter: (v: unknown) =>
        v instanceof Date ? v.toISOString() : String(v ?? ''),
    },
    { field: 'type', header: 'Type', group: 'core' },
    { field: 'status', header: 'Status', group: 'core' },
    {
      field: 'username',
      header: 'Username',
      group: 'core',
      formatter: (v: unknown) => String(v ?? 'N/A'),
    },
    {
      field: 'description',
      header: 'Description',
      group: 'core',
    },
    {
      field: 'ip_address',
      header: 'IP Address',
      group: 'core',
      formatter: (v: unknown) => String(v ?? 'N/A'),
    },
    {
      field: 'user_agent',
      header: 'User Agent',
      group: 'core',
      formatter: (v: unknown) => String(v ?? 'N/A'),
    },
  ];

  return {
    entityId: 'activities',
    displayName: 'Activity Logs',
    description:
      'Export audit/activity logs for compliance archival (CSV format)',
    // No importConfig — importing audit logs breaks provenance
    exportConfig: {
      format: 'csv',
      columns: exportColumns,
      filenamePrefix: 'activities-export',

      async loadData(
        filters: ExportFilters,
        _ctx: ExportContext
      ): Promise<Record<string, unknown>[]> {
        const filter: Record<string, unknown> = {};

        const type = parseTypeFilter(filters.type);
        if (type) filter.type = type;
        const status = parseStatusFilter(filters.status);
        if (status) filter.status = status;
        const username =
          typeof filters.username === 'string' ? filters.username.trim() : '';
        if (username) {
          filter['actor.username'] = username;
        }
        if (filters.dateFrom || filters.dateTo) {
          const timestamp: Record<string, unknown> = {};
          if (filters.dateFrom) {
            timestamp.$gte = parseDateFilter(filters.dateFrom, 'dateFrom');
          }
          if (filters.dateTo) {
            timestamp.$lte = parseDateFilter(filters.dateTo, 'dateTo', true);
          }
          filter.timestamp = timestamp;
        }

        const activities: IActivity[] = [];
        let page = 1;
        let totalPages = 1;
        do {
          const result = await activityService.queryActivities(filter, {
            page,
            limit: 10000,
          });
          activities.push(...result.results);
          totalPages = result.totalPages;
          page += 1;
        } while (page <= totalPages);

        return activities.map(activity => {
          const record: Record<string, unknown> = {};
          for (const col of exportColumns) {
            record[col.field] = (
              activity as unknown as Record<string, unknown>
            )[col.field];
          }
          // Username is stored on the activity actor, not at the top level.
          if (!record.username) {
            record.username = activity.actor?.username ?? 'N/A';
          }
          return record;
        });
      },
    },
  };
}
