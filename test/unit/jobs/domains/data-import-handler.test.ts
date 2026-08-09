import { beforeEach, describe, expect, it, vi } from 'vitest';

const entityConfig = { id: 'users' };
const entityConfigFactory = vi.fn(() => entityConfig);
const getEntityConfigFactory = vi.fn<() => typeof entityConfigFactory | null>(
  () => entityConfigFactory
);

vi.mock('../../../../src/services/data-transfer/entities/index.js', () => ({
  getEntityConfigFactory,
}));

const executeImport = vi.fn();
const dataTransferService = { executeImport };
const entityConfigDeps = { marker: 'entity-dependencies' };
const logger = { marker: 'logger' };

describe('data import handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getEntityConfigFactory.mockReturnValue(entityConfigFactory);
    executeImport.mockResolvedValue({ imported: 2, failed: 0 });
  });

  it('builds the entity configuration and executes an import for the requested tenant', async () => {
    const { createDataImportHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/data-import.handler.js');
    const reportProgress = vi.fn();
    const rows = [
      { email: 'first@example.com' },
      { email: 'second@example.com' },
    ];
    const adminUser = { username: 'admin', email: 'admin@example.com' };
    const handler = createDataImportHandler(
      dataTransferService as never,
      entityConfigDeps as never,
      logger as never
    );

    await expect(
      handler(
        {
          type: 'process',
          name: 'data-import',
          entityId: 'users',
          rows,
          tenantId: 'tenant-a',
          adminUser,
        },
        reportProgress
      )
    ).resolves.toEqual({ imported: 2, failed: 0 });

    expect(getEntityConfigFactory).toHaveBeenCalledWith('users');
    expect(entityConfigFactory).toHaveBeenCalledWith(entityConfigDeps);
    expect(executeImport).toHaveBeenCalledWith(
      rows,
      entityConfig,
      { logger, adminUser, tenantId: 'tenant-a' },
      reportProgress
    );
  });

  it('uses the default tenant and preserves an admin without an email address', async () => {
    const { createDataImportHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/data-import.handler.js');
    const reportProgress = vi.fn();
    const handler = createDataImportHandler(
      dataTransferService as never,
      entityConfigDeps as never,
      logger as never
    );

    await handler(
      {
        type: 'process',
        name: 'data-import',
        entityId: 'activities',
        rows: [],
        adminUser: { username: 'admin' },
      },
      reportProgress
    );

    expect(executeImport).toHaveBeenCalledWith(
      [],
      entityConfig,
      {
        logger,
        adminUser: { username: 'admin' },
        tenantId: 'default',
      },
      reportProgress
    );
  });

  it('rejects unknown entity identifiers before invoking the import service', async () => {
    getEntityConfigFactory.mockReturnValue(null);
    const { createDataImportHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/data-import.handler.js');
    const handler = createDataImportHandler(
      dataTransferService as never,
      entityConfigDeps as never,
      logger as never
    );

    await expect(
      handler(
        {
          type: 'process',
          name: 'data-import',
          entityId: 'unknown',
          rows: [],
          adminUser: { username: 'admin' },
        },
        vi.fn()
      )
    ).rejects.toThrow('Unknown entity: unknown');

    expect(entityConfigFactory).not.toHaveBeenCalled();
    expect(executeImport).not.toHaveBeenCalled();
  });

  it.each([
    [{ type: 'process', name: 'other' }, 'name'],
    [
      {
        type: 'process',
        name: 'data-import',
        entityId: 'users',
        rows: 'not-an-array',
        adminUser: { username: 'admin' },
      },
      'rows',
    ],
    [
      {
        type: 'process',
        name: 'data-import',
        entityId: 'users',
        rows: [],
        adminUser: {},
      },
      'adminUser',
    ],
  ])(
    'rejects malformed job data %# before using dependencies',
    async (data, issuePath) => {
      const { createDataImportHandler } =
        await import('../../../../src/jobs/domains/background-tasks/handlers/data-import.handler.js');
      const handler = createDataImportHandler(
        dataTransferService as never,
        entityConfigDeps as never,
        logger as never
      );

      await expect(handler(data as never, vi.fn())).rejects.toMatchObject({
        name: 'ZodError',
        issues: expect.arrayContaining([
          expect.objectContaining({
            path: expect.arrayContaining([issuePath]),
          }),
        ]),
      });

      expect(getEntityConfigFactory).not.toHaveBeenCalled();
      expect(executeImport).not.toHaveBeenCalled();
    }
  );

  it('propagates import failures so BullMQ can retry the job', async () => {
    const failure = new Error('database unavailable');
    executeImport.mockRejectedValue(failure);
    const { createDataImportHandler } =
      await import('../../../../src/jobs/domains/background-tasks/handlers/data-import.handler.js');
    const handler = createDataImportHandler(
      dataTransferService as never,
      entityConfigDeps as never,
      logger as never
    );

    await expect(
      handler(
        {
          type: 'process',
          name: 'data-import',
          entityId: 'users',
          rows: [],
          adminUser: { username: 'admin' },
        },
        vi.fn()
      )
    ).rejects.toBe(failure);
  });
});
