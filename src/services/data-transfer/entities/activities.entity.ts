import type { EntityConfigDeps } from './index.js';
import type {
  EntityTransferConfig,
  EntityColumnDef,
  ExportContext,
  ExportFilters,
} from '../types.js';

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

        if (filters.type && filters.type !== 'all') {
          filter.type = filters.type;
        }
        if (filters.status && filters.status !== 'all') {
          filter.status = filters.status;
        }
        if (filters.username && filters.username !== '') {
          // Escape regex special chars to prevent ReDoS
          const escaped = String(filters.username).replace(
            /[.*+?^${}()|[\]\\]/g,
            '\\$&'
          );
          filter.username = { $regex: escaped, $options: 'i' };
        }
        if (filters.dateFrom || filters.dateTo) {
          const timestamp: Record<string, unknown> = {};
          if (filters.dateFrom) {
            timestamp.$gte = new Date(filters.dateFrom as string);
          }
          if (filters.dateTo) {
            timestamp.$lte = new Date(`${filters.dateTo}T23:59:59.999Z`);
          }
          filter.timestamp = timestamp;
        }

        const result = await activityService.queryActivities(filter, {
          page: 1,
          limit: 10000,
        });

        return result.results.map(activity => {
          const record: Record<string, unknown> = {};
          for (const col of exportColumns) {
            record[col.field] = (
              activity as unknown as Record<string, unknown>
            )[col.field];
          }
          // Fallback for username from nested user object
          if (!record.username) {
            const user = (activity as unknown as Record<string, unknown>)
              .user as Record<string, unknown> | undefined;
            record.username = user?.username ?? 'N/A';
          }
          return record;
        });
      },
    },
  };
}
