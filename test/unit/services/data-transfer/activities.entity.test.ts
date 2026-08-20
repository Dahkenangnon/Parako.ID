import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { IActivityService } from '../../../../src/di/interfaces/activity-service.interface.js';
import type { ILogger } from '../../../../src/di/interfaces/logger.interface.js';
import type { IOIDCAdapterBridge } from '../../../../src/di/interfaces/oidc-adapter-bridge.interface.js';
import type { IPasswordUtils } from '../../../../src/di/interfaces/password-utils.interface.js';
import type { IUserService } from '../../../../src/di/interfaces/user-service.interface.js';
import { createActivityEntityConfig } from '../../../../src/services/data-transfer/entities/activities.entity.js';
import type { EntityConfigDeps } from '../../../../src/services/data-transfer/entities/types.js';
import type { ExportContext } from '../../../../src/services/data-transfer/types.js';

describe('activity data-transfer entity', () => {
  let logger: ILogger;
  let activityService: IActivityService;
  let deps: EntityConfigDeps;
  let context: ExportContext;

  beforeEach(() => {
    logger = { info: vi.fn() } as unknown as ILogger;
    activityService = {
      queryActivities: vi.fn(async () => ({
        results: [
          {
            timestamp: new Date('2026-08-02T10:00:00.000Z'),
            type: 'login_success',
            status: 'success',
            actor: { username: 'alice', actor_type: 'user' },
            description: 'User logged in',
            ip_address: '192.0.2.1',
            user_agent: 'Demo Browser',
          },
        ],
        totalResults: 1,
        totalPages: 1,
        page: 1,
        limit: 10000,
      })),
    } as unknown as IActivityService;
    deps = {
      logger,
      activityService,
      userService: {} as IUserService,
      passwordUtils: {} as IPasswordUtils,
      oidcAdapterBridge: {} as IOIDCAdapterBridge,
    };
    context = {
      logger,
      adminUser: { username: 'admin' },
      tenantId: 'tenant-a',
    };
  });

  it('publishes an export-only CSV contract for audit provenance', () => {
    const config = createActivityEntityConfig(deps);

    expect(config).toMatchObject({
      entityId: 'activities',
      displayName: 'Activity Logs',
      exportConfig: {
        format: 'csv',
        filenamePrefix: 'activities-export',
      },
    });
    expect(config.importConfig).toBeUndefined();
    expect(config.exportConfig!.columns.map(column => column.field)).toEqual([
      'timestamp',
      'type',
      'status',
      'username',
      'description',
      'ip_address',
      'user_agent',
    ]);
  });

  it('formats activity dates and missing display values for CSV consumers', () => {
    const config = createActivityEntityConfig(deps);
    const column = (field: string) =>
      config.exportConfig!.columns.find(
        candidate => candidate.field === field
      )!;
    const timestamp = new Date('2026-08-02T10:00:00.000Z');

    expect(column('timestamp').formatter!(timestamp)).toBe(
      '2026-08-02T10:00:00.000Z'
    );
    expect(column('timestamp').formatter!('existing')).toBe('existing');
    expect(column('timestamp').formatter!(null)).toBe('');
    for (const field of ['username', 'ip_address', 'user_agent']) {
      expect(column(field).formatter!('value')).toBe('value');
      expect(column(field).formatter!(null)).toBe('N/A');
    }
  });

  it('uses repository-compatible filters and exports the actor username', async () => {
    const config = createActivityEntityConfig(deps);

    const rows = await config.exportConfig!.loadData(
      {
        type: 'login_success',
        status: 'success',
        username: ' alice ',
        dateFrom: '2026-08-01',
        dateTo: '2026-08-02',
      },
      context
    );

    expect(activityService.queryActivities).toHaveBeenCalledWith(
      {
        type: 'login_success',
        status: 'success',
        'actor.username': 'alice',
        timestamp: {
          $gte: new Date('2026-08-01T00:00:00.000Z'),
          $lte: new Date('2026-08-02T23:59:59.999Z'),
        },
      },
      { page: 1, limit: 10000 }
    );
    expect(rows).toEqual([
      {
        timestamp: new Date('2026-08-02T10:00:00.000Z'),
        type: 'login_success',
        status: 'success',
        username: 'alice',
        description: 'User logged in',
        ip_address: '192.0.2.1',
        user_agent: 'Demo Browser',
      },
    ]);
  });

  it('ignores neutral filters and uses N/A when an activity has no actor username', async () => {
    vi.mocked(activityService.queryActivities).mockResolvedValue({
      results: [
        {
          timestamp: new Date('2026-08-02T10:00:00.000Z'),
          type: 'system_event',
          status: 'info',
          description: 'System event',
          ip_address: '127.0.0.1',
        },
      ],
      totalResults: 1,
      totalPages: 1,
      page: 1,
      limit: 10000,
    } as never);
    const config = createActivityEntityConfig(deps);

    const rows = await config.exportConfig!.loadData(
      { type: 'all', status: 'all', username: '   ' },
      context
    );

    expect(activityService.queryActivities).toHaveBeenCalledWith(
      {},
      { page: 1, limit: 10000 }
    );
    expect(rows[0]?.username).toBe('N/A');
  });

  it('supports independent lower and upper activity date bounds', async () => {
    const config = createActivityEntityConfig(deps);

    await config.exportConfig!.loadData({ dateFrom: '2026-08-01' }, context);
    await config.exportConfig!.loadData({ dateTo: '2026-08-02' }, context);

    expect(activityService.queryActivities).toHaveBeenNthCalledWith(
      1,
      { timestamp: { $gte: new Date('2026-08-01T00:00:00.000Z') } },
      { page: 1, limit: 10000 }
    );
    expect(activityService.queryActivities).toHaveBeenNthCalledWith(
      2,
      { timestamp: { $lte: new Date('2026-08-02T23:59:59.999Z') } },
      { page: 1, limit: 10000 }
    );
  });

  it('exports every activity page instead of silently truncating at 10,000 rows', async () => {
    vi.mocked(activityService.queryActivities)
      .mockResolvedValueOnce({
        results: [
          {
            timestamp: new Date('2026-08-02T10:00:00.000Z'),
            type: 'first-page',
            status: 'success',
            actor: { username: 'alice', actor_type: 'user' },
            description: 'First page',
          },
        ],
        totalResults: 2,
        totalPages: 2,
        page: 1,
        limit: 10000,
      } as never)
      .mockResolvedValueOnce({
        results: [
          {
            timestamp: new Date('2026-08-01T10:00:00.000Z'),
            type: 'second-page',
            status: 'success',
            actor: { username: 'bob', actor_type: 'user' },
            description: 'Second page',
          },
        ],
        totalResults: 2,
        totalPages: 2,
        page: 2,
        limit: 10000,
      } as never);
    const config = createActivityEntityConfig(deps);

    const rows = await config.exportConfig!.loadData({}, context);

    expect(activityService.queryActivities).toHaveBeenNthCalledWith(
      1,
      {},
      { page: 1, limit: 10000 }
    );
    expect(activityService.queryActivities).toHaveBeenNthCalledWith(
      2,
      {},
      { page: 2, limit: 10000 }
    );
    expect(rows.map(row => row.type)).toEqual(['first-page', 'second-page']);
  });

  it('preserves a legacy top-level username when exporting old activity rows', async () => {
    vi.mocked(activityService.queryActivities).mockResolvedValue({
      results: [
        {
          timestamp: new Date('2026-08-02T10:00:00.000Z'),
          type: 'legacy_event',
          status: 'info',
          username: 'legacy-user',
          description: 'Legacy event',
          ip_address: '127.0.0.1',
        },
      ],
      totalResults: 1,
      totalPages: 1,
      page: 1,
      limit: 10000,
    } as never);
    const config = createActivityEntityConfig(deps);

    const rows = await config.exportConfig!.loadData({}, context);

    expect(rows[0]?.username).toBe('legacy-user');
  });

  it('normalizes scalar selectors and rejects malformed values before persistence', async () => {
    const config = createActivityEntityConfig(deps);

    await config.exportConfig!.loadData(
      { type: ' login_success ', status: ' success ' },
      context
    );
    expect(activityService.queryActivities).toHaveBeenLastCalledWith(
      { type: 'login_success', status: 'success' },
      { page: 1, limit: 10000 }
    );

    vi.mocked(activityService.queryActivities).mockClear();
    await expect(
      config.exportConfig!.loadData(
        { type: { $ne: '' } as unknown as string },
        context
      )
    ).rejects.toThrow('Invalid type filter: expected a string');
    await expect(
      config.exportConfig!.loadData({ status: 'compromised' }, context)
    ).rejects.toThrow(
      'Invalid status filter: expected all, success, failed, warning, or info'
    );
    await expect(
      config.exportConfig!.loadData(
        { status: { $ne: '' } as unknown as string },
        context
      )
    ).rejects.toThrow(
      'Invalid status filter: expected all, success, failed, warning, or info'
    );
    expect(activityService.queryActivities).not.toHaveBeenCalled();
  });

  it('rejects malformed date filters before querying persistence', async () => {
    const config = createActivityEntityConfig(deps);

    await expect(
      config.exportConfig!.loadData({ dateFrom: 'not-a-date' }, context)
    ).rejects.toThrow('Invalid dateFrom filter: expected YYYY-MM-DD');
    await expect(
      config.exportConfig!.loadData({ dateTo: '2026-02-30' }, context)
    ).rejects.toThrow('Invalid dateTo filter: expected YYYY-MM-DD');
    await expect(
      config.exportConfig!.loadData({ dateFrom: 42 } as never, context)
    ).rejects.toThrow('Invalid dateFrom filter: expected YYYY-MM-DD');
    expect(activityService.queryActivities).not.toHaveBeenCalled();
  });
});
