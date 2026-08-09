import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Schema } from 'mongoose';
import {
  DEFAULT_TENANT_ID,
  tenantPlugin,
} from '../../../../src/db/plugins/tenant.plugin.js';
import { tenantContext } from '../../../../src/multi-tenancy/tenant-context.js';

type Hook = (this: any, ...args: any[]) => unknown;

function makeSchema(hasTenantId = true) {
  const hooks = new Map<string, Hook>();
  const schema = {
    path: vi.fn().mockReturnValue(hasTenantId ? {} : undefined),
    add: vi.fn(),
    pre: vi.fn((name: string, hook: Hook) => {
      hooks.set(name, hook);
    }),
  } as unknown as Schema;

  return { schema, hooks };
}

describe('tenantPlugin', () => {
  afterEach(() => {
    tenantContext.disableStrictMode();
  });

  it('overrides a caller-supplied tenant filter with the active tenant', () => {
    const { schema, hooks } = makeSchema();
    tenantPlugin(schema);
    const where = vi.fn();

    tenantContext.run('tenant-a', () => {
      hooks.get('find')!.call({
        getFilter: () => ({ tenant_id: 'tenant-b', status: 'active' }),
        where,
      });
    });

    expect(where).toHaveBeenCalledWith({ tenant_id: 'tenant-a' });
  });

  it('exports the single-tenant fallback identifier', () => {
    expect(DEFAULT_TENANT_ID).toBe('default');
  });

  it('does not modify a schema that explicitly opts out', () => {
    const { schema } = makeSchema(false);
    (schema as any).tenantScoped = false;

    tenantPlugin(schema);

    expect((schema as any)._tenantPluginApplied).toBeUndefined();
    expect(schema.path).not.toHaveBeenCalled();
    expect(schema.add).not.toHaveBeenCalled();
    expect(schema.pre).not.toHaveBeenCalled();
  });

  it('applies only once when registered locally and globally', () => {
    const { schema } = makeSchema();

    tenantPlugin(schema);
    const registrations = vi.mocked(schema.pre).mock.calls.length;
    tenantPlugin(schema);

    expect((schema as any)._tenantPluginApplied).toBe(true);
    expect(schema.pre).toHaveBeenCalledTimes(registrations);
  });

  it('adds a required indexed tenant field with a context-aware default', () => {
    const { schema } = makeSchema(false);
    tenantPlugin(schema);
    const definition = vi.mocked(schema.add).mock.calls[0][0] as any;

    expect(definition.tenant_id).toEqual(
      expect.objectContaining({
        type: String,
        required: true,
        index: true,
        default: expect.any(Function),
      })
    );
    expect(definition.tenant_id.default()).toBe(DEFAULT_TENANT_ID);
    expect(
      tenantContext.run('tenant-a', () => definition.tenant_id.default())
    ).toBe('tenant-a');
  });

  it('keeps an existing tenant field definition', () => {
    const { schema } = makeSchema(true);

    tenantPlugin(schema);

    expect(schema.path).toHaveBeenCalledWith('tenant_id');
    expect(schema.add).not.toHaveBeenCalled();
  });

  it('forces the active tenant on saves', () => {
    const { schema, hooks } = makeSchema();
    tenantPlugin(schema);
    const document = { tenant_id: 'tenant-b' };

    tenantContext.run('tenant-a', () => {
      hooks.get('save')!.call(document);
    });

    expect(document.tenant_id).toBe('tenant-a');
  });

  it('forces the active tenant on every insertMany document', () => {
    const { schema, hooks } = makeSchema();
    tenantPlugin(schema);
    const documents = [{ tenant_id: 'tenant-b' }, { display_name: 'New' }];

    tenantContext.run('tenant-a', () => {
      hooks.get('insertMany')!.call({}, documents);
    });

    expect(documents).toEqual([
      { tenant_id: 'tenant-a' },
      { tenant_id: 'tenant-a', display_name: 'New' },
    ]);
  });

  it('fails closed without a tenant context in strict mode', () => {
    const { schema, hooks } = makeSchema();
    tenantPlugin(schema);
    tenantContext.enableStrictMode();

    expect(() => hooks.get('find')!.call({ where: vi.fn() })).toThrowError(
      /No active tenant context in strict mode/
    );
  });

  it.each([
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'findOneAndReplace',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'countDocuments',
    'distinct',
    'replaceOne',
  ])('scopes the %s query hook', hookName => {
    const { schema, hooks } = makeSchema();
    tenantPlugin(schema);
    const where = vi.fn();
    const setUpdate = vi.fn();

    tenantContext.run('tenant-a', () => {
      hooks.get(hookName)!.call({
        where,
        getUpdate: () => null,
        setUpdate,
      });
    });

    expect(where).toHaveBeenCalledWith({ tenant_id: 'tenant-a' });
    expect(setUpdate).not.toHaveBeenCalled();
  });

  it('keeps a mandatory-first aggregation stage before the tenant match', () => {
    const { schema, hooks } = makeSchema();
    tenantPlugin(schema);
    const pipeline = [
      { $geoNear: { near: { type: 'Point', coordinates: [0, 0] } } },
      { $project: { name: 1 } },
    ];

    tenantContext.run('tenant-a', () => {
      hooks.get('aggregate')!.call({ pipeline: () => pipeline });
    });

    expect(pipeline).toEqual([
      { $geoNear: { near: { type: 'Point', coordinates: [0, 0] } } },
      { $match: { tenant_id: 'tenant-a' } },
      { $project: { name: 1 } },
    ]);
  });

  it('overrides a tenant_id mutation in an update operator', () => {
    const { schema, hooks } = makeSchema();
    tenantPlugin(schema);
    const where = vi.fn();
    const setUpdate = vi.fn();

    tenantContext.run('tenant-a', () => {
      hooks.get('updateOne')!.call({
        where,
        getUpdate: () => ({
          $set: { tenant_id: 'tenant-b', display_name: 'Updated' },
        }),
        setUpdate,
      });
    });

    expect(setUpdate).toHaveBeenCalledWith({
      $set: { tenant_id: 'tenant-a', display_name: 'Updated' },
    });
  });

  it('removes conflicting tenant mutations from update operators', () => {
    const { schema, hooks } = makeSchema();
    tenantPlugin(schema);
    const setUpdate = vi.fn();

    tenantContext.run('tenant-a', () => {
      hooks.get('updateMany')!.call({
        where: vi.fn(),
        getUpdate: () => ({
          $unset: { tenant_id: 1, obsolete: 1 },
          $rename: {
            tenant_id: 'former_tenant',
            legacy_tenant: 'tenant_id',
            old_name: 'display_name',
          },
          $comment: 'admin update',
          audit: { tenant_id: 'not-an-operator' },
        }),
        setUpdate,
      });
    });

    expect(setUpdate).toHaveBeenCalledWith({
      $unset: { obsolete: 1 },
      $rename: { old_name: 'display_name' },
      $comment: 'admin update',
      audit: { tenant_id: 'not-an-operator' },
      $set: { tenant_id: 'tenant-a' },
    });
  });

  it('appends tenant enforcement to an update pipeline', () => {
    const { schema, hooks } = makeSchema();
    tenantPlugin(schema);
    const setUpdate = vi.fn();

    tenantContext.run('tenant-a', () => {
      hooks.get('updateOne')!.call({
        where: vi.fn(),
        getUpdate: () => [{ $set: { tenant_id: 'tenant-b' } }],
        setUpdate,
      });
    });

    expect(setUpdate).toHaveBeenCalledWith([
      { $set: { tenant_id: 'tenant-b' } },
      { $set: { tenant_id: 'tenant-a' } },
    ]);
  });

  it('leaves an invalid primitive update for Mongoose to reject', () => {
    const { schema, hooks } = makeSchema();
    tenantPlugin(schema);
    const setUpdate = vi.fn();

    tenantContext.run('tenant-a', () => {
      hooks.get('updateOne')!.call({
        where: vi.fn(),
        getUpdate: () => 'invalid update',
        setUpdate,
      });
    });

    expect(setUpdate).toHaveBeenCalledWith('invalid update');
  });

  it.each(['updateOne', 'replaceOne'])(
    'forces tenant ownership on a direct %s payload',
    hookName => {
      const { schema, hooks } = makeSchema();
      tenantPlugin(schema);
      const setUpdate = vi.fn();

      tenantContext.run('tenant-a', () => {
        hooks.get(hookName)!.call({
          where: vi.fn(),
          getUpdate: () => ({ tenant_id: 'tenant-b', display_name: 'New' }),
          setUpdate,
        });
      });

      expect(setUpdate).toHaveBeenCalledWith({
        tenant_id: 'tenant-a',
        display_name: 'New',
      });
    }
  );

  it('places tenant matching first in ordinary and empty pipelines', () => {
    const { schema, hooks } = makeSchema();
    tenantPlugin(schema);
    const ordinary = [{ $project: { name: 1 } }];
    const empty: Record<string, unknown>[] = [];

    tenantContext.run('tenant-a', () => {
      hooks.get('aggregate')!.call({ pipeline: () => ordinary });
      hooks.get('aggregate')!.call({ pipeline: () => empty });
    });

    expect(ordinary[0]).toEqual({ $match: { tenant_id: 'tenant-a' } });
    expect(empty).toEqual([{ $match: { tenant_id: 'tenant-a' } }]);
  });

  it.each([
    '$changeStream',
    '$documents',
    '$search',
    '$searchMeta',
    '$vectorSearch',
  ])('keeps %s as the first aggregation stage', stageName => {
    const { schema, hooks } = makeSchema();
    tenantPlugin(schema);
    const pipeline = [{ [stageName]: {} }];

    tenantContext.run('tenant-a', () => {
      hooks.get('aggregate')!.call({ pipeline: () => pipeline });
    });

    expect(pipeline).toEqual([
      { [stageName]: {} },
      { $match: { tenant_id: 'tenant-a' } },
    ]);
  });
});
