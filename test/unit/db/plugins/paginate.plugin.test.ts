import type { Schema } from 'mongoose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import paginate from '../../../../src/db/plugins/paginate.plugin.js';
import { tenantContext } from '../../../../src/multi-tenancy/tenant-context.js';

function createPaginate(defaultOptions: Record<string, unknown> = {}) {
  const schema = { statics: {} } as unknown as Schema;
  paginate(schema, defaultOptions);
  return (schema.statics as any).paginate as (
    this: any,
    filter?: Record<string, unknown>,
    options?: Record<string, unknown>
  ) => Promise<any>;
}

function createModel(results: unknown[][], totals: number[]) {
  const countExec = vi.fn();
  totals.forEach(total => countExec.mockResolvedValueOnce(total));
  const docsExec = vi.fn();
  results.forEach(result => docsExec.mockResolvedValueOnce(result));

  const query: Record<string, any> = { exec: docsExec };
  for (const method of [
    'sort',
    'skip',
    'limit',
    'select',
    'populate',
    'lean',
  ]) {
    query[method] = vi.fn(() => query);
  }

  return {
    modelName: 'User',
    countDocuments: vi.fn(() => ({ exec: countExec })),
    find: vi.fn(() => query),
    query,
    countExec,
    docsExec,
  };
}

describe('paginate plugin', () => {
  afterEach(() => {
    tenantContext.disableStrictMode();
    vi.restoreAllMocks();
  });

  it('does not reuse a cached page across tenant contexts', async () => {
    const paginateDocuments = createPaginate();
    const model = createModel(
      [[{ tenant_id: 'tenant-a' }], [{ tenant_id: 'tenant-b' }]],
      [1, 1]
    );
    const cacheKey = `tenant-isolation-${Date.now()}`;

    const tenantA = await tenantContext.run('tenant-a', () =>
      paginateDocuments.call(model, {}, { cacheKey })
    );
    const tenantB = await tenantContext.run('tenant-b', () =>
      paginateDocuments.call(model, {}, { cacheKey })
    );

    expect(tenantA.results).toEqual([{ tenant_id: 'tenant-a' }]);
    expect(tenantB.results).toEqual([{ tenant_id: 'tenant-b' }]);
    expect(model.find).toHaveBeenCalledTimes(2);
  });

  it('uses safe defaults and returns complete first-page metadata', async () => {
    const paginateDocuments = createPaginate();
    const documents = [{ id: 'user-1' }, { id: 'user-2' }];
    const model = createModel([documents], [25]);
    const filter = { active: true };

    const result = await paginateDocuments.call(model, filter);

    expect(model.countDocuments).toHaveBeenCalledWith(filter);
    expect(model.find).toHaveBeenCalledWith(filter);
    expect(model.query.sort).toHaveBeenCalledWith('created_at');
    expect(model.query.skip).toHaveBeenCalledWith(0);
    expect(model.query.limit).toHaveBeenCalledWith(10);
    expect(result).toEqual({
      results: documents,
      page: 1,
      limit: 10,
      totalPages: 3,
      totalResults: 25,
      hasNextPage: true,
      hasPrevPage: false,
      prevPage: null,
      nextPage: 2,
    });
  });

  it('combines field search with an existing OR filter without widening it', async () => {
    const paginateDocuments = createPaginate();
    const model = createModel([[]], [0]);
    const filter = {
      $or: [{ status: 'active' }, { invited: true }],
      organization_id: 'org-1',
    };

    await paginateDocuments.call(model, filter, {
      search: 'maria@example.com',
      searchFields: ['email', 'display_name'],
    });

    const expectedFilter = {
      $and: [
        filter,
        {
          $or: [
            {
              email: {
                $regex: 'maria@example.com',
                $options: 'i',
              },
            },
            {
              display_name: {
                $regex: 'maria@example.com',
                $options: 'i',
              },
            },
          ],
        },
      ],
    };
    expect(model.countDocuments).toHaveBeenCalledWith(expectedFilter);
    expect(model.find).toHaveBeenCalledWith(expectedFilter);
  });

  it('uses MongoDB text search when no search fields are configured', async () => {
    const paginateDocuments = createPaginate();
    const model = createModel([[]], [0]);

    await paginateDocuments.call(
      model,
      { active: true },
      { search: 'security key' }
    );

    const expectedFilter = {
      $and: [{ active: true }, { $text: { $search: 'security key' } }],
    };
    expect(model.countDocuments).toHaveBeenCalledWith(expectedFilter);
    expect(model.find).toHaveBeenCalledWith(expectedFilter);
  });

  it('applies string query options and returns middle-page links', async () => {
    const paginateDocuments = createPaginate();
    const documents = [{ id: 'user-6' }];
    const model = createModel([documents], [12]);

    const result = await paginateDocuments.call(
      model,
      {},
      {
        sortBy: 'created_at:desc,email:asc,score',
        limit: 5,
        page: 2,
        select: 'email,display_name',
        populate: 'organization,roles',
        lean: true,
        links: true,
      }
    );

    expect(model.query.sort).toHaveBeenCalledWith('-created_at email score');
    expect(model.query.skip).toHaveBeenCalledWith(5);
    expect(model.query.limit).toHaveBeenCalledWith(5);
    expect(model.query.select).toHaveBeenCalledWith('email display_name');
    expect(model.query.populate).toHaveBeenNthCalledWith(1, 'organization');
    expect(model.query.populate).toHaveBeenNthCalledWith(2, 'roles');
    expect(model.query.lean).toHaveBeenCalledOnce();
    expect(result).toEqual({
      results: documents,
      page: 2,
      limit: 5,
      totalPages: 3,
      totalResults: 12,
      hasNextPage: true,
      hasPrevPage: true,
      prevPage: 1,
      nextPage: 3,
      links: {
        first: '?page=1&limit=5',
        prev: '?page=1&limit=5',
        next: '?page=3&limit=5',
        last: '?page=3&limit=5',
      },
    });
  });

  it('supports object projection and array population without enabling lean', async () => {
    const paginateDocuments = createPaginate();
    const model = createModel([[]], [0]);
    const projection = { email: 1 as const, password_hash: 0 as const };

    await paginateDocuments.call(
      model,
      {},
      {
        select: projection,
        populate: ['organization', 'roles'],
        lean: false,
      }
    );

    expect(model.query.select).toHaveBeenCalledWith(projection);
    expect(model.query.populate).toHaveBeenNthCalledWith(1, 'organization');
    expect(model.query.populate).toHaveBeenNthCalledWith(2, 'roles');
    expect(model.query.lean).not.toHaveBeenCalled();
  });

  it('ignores malformed runtime population input', async () => {
    const paginateDocuments = createPaginate();
    const model = createModel([[]], [0]);

    await paginateDocuments.call(model, {}, { populate: { path: 'roles' } });

    expect(model.query.populate).not.toHaveBeenCalled();
  });

  it('merges plugin defaults with per-call overrides', async () => {
    const paginateDocuments = createPaginate({
      limit: 20,
      page: 2,
      sortBy: 'email:desc',
    });
    const model = createModel([[]], [100]);

    const result = await paginateDocuments.call(model, {}, { page: 3 });

    expect(model.query.sort).toHaveBeenCalledWith('-email');
    expect(model.query.skip).toHaveBeenCalledWith(40);
    expect(model.query.limit).toHaveBeenCalledWith(20);
    expect(result).toEqual(
      expect.objectContaining({
        page: 3,
        limit: 20,
        totalPages: 5,
        prevPage: 2,
        nextPage: 4,
      })
    );
  });

  it('falls back safely for invalid page and limit values', async () => {
    const paginateDocuments = createPaginate();
    const model = createModel([[]], [0]);

    const result = await paginateDocuments.call(
      model,
      {},
      {
        page: 'not-a-page',
        limit: -50,
        links: true,
      }
    );

    expect(model.query.skip).toHaveBeenCalledWith(0);
    expect(model.query.limit).toHaveBeenCalledWith(10);
    expect(result).toEqual({
      results: [],
      page: 1,
      limit: 10,
      totalPages: 0,
      totalResults: 0,
      hasNextPage: false,
      hasPrevPage: false,
      prevPage: null,
      nextPage: null,
      links: {
        first: null,
        prev: null,
        next: null,
        last: null,
      },
    });
  });

  it('reuses an unexpired cached page within the same tenant and model', async () => {
    const paginateDocuments = createPaginate();
    const documents = [{ id: 'user-1' }];
    const model = createModel([documents], [1]);
    const cacheKey = `same-tenant-${Date.now()}`;

    const first = await tenantContext.run('tenant-a', () =>
      paginateDocuments.call(model, {}, { cacheKey })
    );
    const second = await tenantContext.run('tenant-a', () =>
      paginateDocuments.call(model, {}, { cacheKey })
    );

    expect(second).toBe(first);
    expect(model.countDocuments).toHaveBeenCalledOnce();
    expect(model.find).toHaveBeenCalledOnce();
  });

  it('does not reuse a cache entry across different model instances', async () => {
    const paginateDocuments = createPaginate();
    const users = createModel([[{ id: 'user-1' }]], [1]);
    const activities = createModel([[{ id: 'activity-1' }]], [1]);
    const cacheKey = `model-isolation-${Date.now()}`;

    const userPage = await tenantContext.run('tenant-a', () =>
      paginateDocuments.call(users, {}, { cacheKey })
    );
    const activityPage = await tenantContext.run('tenant-a', () =>
      paginateDocuments.call(activities, {}, { cacheKey })
    );

    expect(userPage.results).toEqual([{ id: 'user-1' }]);
    expect(activityPage.results).toEqual([{ id: 'activity-1' }]);
    expect(users.find).toHaveBeenCalledOnce();
    expect(activities.find).toHaveBeenCalledOnce();
  });

  it('refreshes an expired cache entry using the configured lifetime', async () => {
    const paginateDocuments = createPaginate();
    const model = createModel([[{ id: 'stale' }], [{ id: 'fresh' }]], [1, 1]);
    const cacheKey = 'expiring-entry';
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const first = await tenantContext.run('tenant-a', () =>
      paginateDocuments.call(model, {}, { cacheKey, cacheExpireSeconds: 1 })
    );
    now = 2_001;
    const refreshed = await tenantContext.run('tenant-a', () =>
      paginateDocuments.call(model, {}, { cacheKey, cacheExpireSeconds: 1 })
    );

    expect(first.results).toEqual([{ id: 'stale' }]);
    expect(refreshed.results).toEqual([{ id: 'fresh' }]);
    expect(model.find).toHaveBeenCalledTimes(2);
  });

  it('fails closed for cached pagination without a tenant in strict mode', async () => {
    const paginateDocuments = createPaginate();
    const model = createModel([[]], [0]);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    tenantContext.enableStrictMode();

    await expect(
      paginateDocuments.call(model, {}, { cacheKey: 'strict-mode' })
    ).rejects.toThrow(/No active tenant context in strict mode/);
    expect(errorLog).toHaveBeenCalledWith(
      'Pagination error:',
      expect.any(Error)
    );
    expect(model.countDocuments).not.toHaveBeenCalled();
    expect(model.find).not.toHaveBeenCalled();
  });

  it('logs and preserves a database pagination failure', async () => {
    const paginateDocuments = createPaginate();
    const model = createModel([[]], [0]);
    const failure = new Error('database unavailable');
    model.countExec.mockReset().mockRejectedValue(failure);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(paginateDocuments.call(model)).rejects.toBe(failure);
    expect(errorLog).toHaveBeenCalledWith('Pagination error:', failure);
  });
});
