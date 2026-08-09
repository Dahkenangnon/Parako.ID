import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import type { Provider } from 'oidc-provider';

import { RegistrationTokensController } from '../../../../../src/api/v1/controllers/registration-tokens.controller.js';
import type { RegistrationTokensControllerDeps } from '../../../../../src/api/v1/controllers/registration-tokens.controller.js';
import { ApiError } from '../../../../../src/api/v1/errors.js';

type TokenAdapter = {
  destroy: ReturnType<typeof vi.fn>;
  find: ReturnType<typeof vi.fn>;
  findAll: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
};

type TestDeps = RegistrationTokensControllerDeps & {
  oidcAdapter: {
    adapter: ReturnType<typeof vi.fn>;
  };
};

function createResponse(): Response {
  return {
    end: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    status: vi.fn().mockReturnThis(),
  } as unknown as Response;
}

function createRequest(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    params: {},
    ...overrides,
  } as unknown as Request;
}

function createProvider(jti: string | undefined) {
  const instances: TestInitialAccessToken[] = [];
  const save = vi.fn().mockResolvedValue('raw-registration-token');

  class TestInitialAccessToken {
    jti = jti;
    policies_metadata?: Record<string, unknown>;
    save = save;

    constructor(readonly options: { expiresIn: number; policies: string[] }) {
      instances.push(this);
    }
  }

  return {
    instances,
    provider: {
      InitialAccessToken: TestInitialAccessToken,
    } as unknown as Provider,
    save,
  };
}

function createDeps(providerJti: string | null = 'registration-token-jti'): {
  adapter: TokenAdapter;
  deps: TestDeps;
  providerFixture: ReturnType<typeof createProvider>;
} {
  const providerFixture = createProvider(providerJti ?? undefined);
  const adapter: TokenAdapter = {
    destroy: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockImplementation(async (id: string) => ({
      exp: 1_785_934_800,
      iat: 1_785_931_200,
      jti: id,
      kind: 'InitialAccessToken',
      policies: ['general-policy'],
    })),
    findAll: vi.fn().mockResolvedValue([]),
    upsert: vi.fn().mockResolvedValue(undefined),
  };
  const deps = {
    getTenantId: vi.fn().mockReturnValue('tenant-a'),
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
    oidcAdapter: {
      adapter: vi.fn().mockReturnValue(adapter),
    },
    providerService: {
      getProviderForTenant: vi.fn().mockResolvedValue(providerFixture.provider),
    },
  } as unknown as TestDeps;

  return { adapter, deps, providerFixture };
}

describe('api/v1/controllers/RegistrationTokensController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-05T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('persists management metadata in the serialized adapter payload and returns the raw value once', async () => {
    const { adapter, deps, providerFixture } = createDeps();
    const controller = new RegistrationTokensController(deps);
    const req = createRequest({
      body: {
        expires_in: 3600,
        max_usage_count: 5,
        note: 'CI registration token',
        policies: ['general-policy'],
      },
    });
    const res = createResponse();
    const next = vi.fn();

    await controller.create(req, res, next as NextFunction);

    expect(providerFixture.instances).toHaveLength(1);
    expect(providerFixture.instances[0]?.options).toEqual({
      expiresIn: 3600,
      policies: ['general-policy'],
    });
    expect(providerFixture.instances[0]?.policies_metadata).toBeUndefined();
    expect(providerFixture.instances[0]?.save).toHaveBeenCalledOnce();
    expect(adapter.find).toHaveBeenCalledWith('registration-token-jti');
    expect(adapter.upsert).toHaveBeenCalledWith(
      'registration-token-jti',
      {
        exp: 1_785_934_800,
        iat: 1_785_931_200,
        jti: 'registration-token-jti',
        kind: 'InitialAccessToken',
        policies: ['general-policy'],
        policies_metadata: {
          current_usage_count: 0,
          max_usage_count: 5,
          note: 'CI registration token',
        },
      },
      3600
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      data: {
        created_at: '2026-08-05T12:00:00.000Z',
        current_usage_count: 0,
        expires_at: '2026-08-05T13:00:00.000Z',
        jti: 'registration-token-jti',
        max_usage_count: 5,
        note: 'CI registration token',
        policies: ['general-policy'],
        token: 'raw-registration-token',
      },
    });
    expect(deps.logger.info).toHaveBeenCalledWith(
      'DCR initial access token created via API',
      expect.objectContaining({ tenantId: 'tenant-a' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('forwards token creation failures without returning a partial secret', async () => {
    const { deps, providerFixture } = createDeps();
    const controller = new RegistrationTokensController(deps);
    const expectedError = new Error('adapter write failed');
    const req = createRequest({
      body: {
        expires_in: 3600,
        max_usage_count: 1,
        policies: ['general-policy'],
      },
    });
    const res = createResponse();
    const next = vi.fn();
    providerFixture.save.mockRejectedValue(expectedError);

    await controller.create(req, res, next as NextFunction);

    expect(next).toHaveBeenCalledWith(expectedError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it('uses the saved token identifier when the provider model omits jti', async () => {
    const { adapter, deps } = createDeps(null);
    const controller = new RegistrationTokensController(deps);
    const res = createResponse();
    adapter.find.mockResolvedValue({
      exp: 1_785_931_260,
      iat: 1_785_931_200,
      jti: 'raw-registration-token',
      kind: 'InitialAccessToken',
      policies: ['general-policy'],
    });

    await controller.create(
      createRequest({
        body: {
          expires_in: 60,
          max_usage_count: 1,
          policies: ['general-policy'],
        },
      }),
      res,
      vi.fn() as NextFunction
    );

    expect(res.json).toHaveBeenCalledWith({
      data: expect.objectContaining({ jti: 'raw-registration-token' }),
    });
    expect(adapter.find).toHaveBeenCalledWith('raw-registration-token');
    expect(adapter.upsert).toHaveBeenCalledWith(
      'raw-registration-token',
      expect.objectContaining({
        policies_metadata: expect.objectContaining({ max_usage_count: 1 }),
      }),
      60
    );
  });

  it('uses the requested lifetime when the stored payload omits expiration', async () => {
    const { adapter, deps } = createDeps();
    const controller = new RegistrationTokensController(deps);
    adapter.find.mockResolvedValue({
      iat: 1_785_931_200,
      jti: 'registration-token-jti',
      kind: 'InitialAccessToken',
      policies: ['general-policy'],
    });

    await controller.create(
      createRequest({
        body: {
          expires_in: 600,
          max_usage_count: 1,
          policies: ['general-policy'],
        },
      }),
      createResponse(),
      vi.fn() as NextFunction
    );

    expect(adapter.upsert).toHaveBeenCalledWith(
      'registration-token-jti',
      expect.any(Object),
      600
    );
  });

  it('fails closed when provider persistence cannot be read back for metadata augmentation', async () => {
    const { adapter, deps } = createDeps();
    const controller = new RegistrationTokensController(deps);
    const res = createResponse();
    const next = vi.fn();
    adapter.find.mockResolvedValue(undefined);

    await controller.create(
      createRequest({
        body: {
          expires_in: 3600,
          max_usage_count: 1,
          policies: ['general-policy'],
        },
      }),
      res,
      next as NextFunction
    );

    expect(adapter.upsert).not.toHaveBeenCalled();
    expect(adapter.destroy).toHaveBeenCalledWith('registration-token-jti');
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Unable to persist registration token metadata',
      })
    );
  });

  it('revokes a newly created token when metadata persistence fails', async () => {
    const { adapter, deps } = createDeps();
    const controller = new RegistrationTokensController(deps);
    const expectedError = new Error('metadata write failed');
    const res = createResponse();
    const next = vi.fn();
    adapter.upsert.mockRejectedValue(expectedError);

    await controller.create(
      createRequest({
        body: {
          expires_in: 3600,
          max_usage_count: 1,
          policies: ['general-policy'],
        },
      }),
      res,
      next as NextFunction
    );

    expect(adapter.destroy).toHaveBeenCalledWith('registration-token-jti');
    expect(res.json).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(expectedError);
  });

  it('reports cleanup failures without hiding the metadata persistence error', async () => {
    const { adapter, deps } = createDeps();
    const controller = new RegistrationTokensController(deps);
    const cleanupError = new Error('token cleanup failed');
    const next = vi.fn();
    adapter.find.mockResolvedValue(undefined);
    adapter.destroy.mockRejectedValue(cleanupError);

    await controller.create(
      createRequest({
        body: {
          expires_in: 3600,
          max_usage_count: 1,
          policies: ['general-policy'],
        },
      }),
      createResponse(),
      next as NextFunction
    );

    expect(deps.logger.error).toHaveBeenCalledWith(cleanupError, {
      context: 'registration_token_metadata_cleanup',
      jti: 'registration-token-jti',
      tenantId: 'tenant-a',
    });
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Unable to persist registration token metadata',
      })
    );
  });

  it('lists active token metadata without exposing raw token fields', async () => {
    const { adapter, deps } = createDeps();
    const controller = new RegistrationTokensController(deps);
    adapter.findAll.mockResolvedValue([
      {
        exp: 1_785_934_800,
        iat: 1_785_931_200,
        jti: 'token-1',
        policies: ['general-policy'],
        policies_metadata: {
          current_usage_count: 2,
          max_usage_count: 5,
          note: 'deployment token',
        },
        token: 'must-not-leak',
      },
    ]);
    const res = createResponse();
    const next = vi.fn();

    await controller.list(createRequest(), res, next as NextFunction);

    expect(deps.oidcAdapter.adapter).toHaveBeenCalledWith('InitialAccessToken');
    expect(adapter.findAll).toHaveBeenCalledOnce();
    const response = vi.mocked(res.json).mock.calls[0]?.[0];
    expect(response).toEqual({
      data: [
        {
          created_at: '2026-08-05T12:00:00.000Z',
          current_usage_count: 2,
          expires_at: '2026-08-05T13:00:00.000Z',
          jti: 'token-1',
          max_usage_count: 5,
          note: 'deployment token',
          policies: ['general-policy'],
        },
      ],
      pagination: { has_more: false, next_cursor: null },
    });
    expect(JSON.stringify(response)).not.toContain('must-not-leak');
    expect(next).not.toHaveBeenCalled();
  });

  it('gets token metadata through the adapter bridge', async () => {
    const { adapter, deps } = createDeps();
    const controller = new RegistrationTokensController(deps);
    adapter.find.mockResolvedValue({
      _id: 'legacy-token-id',
      exp: 1_785_934_800,
      iat: 1_785_931_200,
    });
    const res = createResponse();
    const next = vi.fn();

    await controller.get(
      createRequest({ params: { jti: 'legacy-token-id' } }),
      res,
      next as NextFunction
    );

    expect(adapter.find).toHaveBeenCalledWith('legacy-token-id');
    expect(res.json).toHaveBeenCalledWith({
      data: {
        created_at: '2026-08-05T12:00:00.000Z',
        current_usage_count: 0,
        expires_at: '2026-08-05T13:00:00.000Z',
        jti: 'legacy-token-id',
        max_usage_count: 0,
        note: undefined,
        policies: ['general-policy'],
      },
    });
    expect(deps.providerService.getProviderForTenant).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('returns safe metadata defaults for a minimally stored token', async () => {
    const { adapter, deps } = createDeps();
    const controller = new RegistrationTokensController(deps);
    adapter.find.mockResolvedValue({});
    const res = createResponse();

    await controller.get(
      createRequest({ params: { jti: 'legacy-token' } }),
      res,
      vi.fn() as NextFunction
    );

    expect(res.json).toHaveBeenCalledWith({
      data: {
        created_at: '',
        current_usage_count: 0,
        expires_at: '',
        jti: '',
        max_usage_count: 0,
        note: undefined,
        policies: ['general-policy'],
      },
    });
  });

  it('forwards registration-token listing failures', async () => {
    const { adapter, deps } = createDeps();
    const controller = new RegistrationTokensController(deps);
    const expectedError = new Error('adapter scan failed');
    const next = vi.fn();
    adapter.findAll.mockRejectedValue(expectedError);

    await controller.list(
      createRequest(),
      createResponse(),
      next as NextFunction
    );

    expect(next).toHaveBeenCalledWith(expectedError);
  });

  it('returns 404 when a registration token does not exist', async () => {
    const { adapter, deps } = createDeps();
    const controller = new RegistrationTokensController(deps);
    adapter.find.mockResolvedValue(undefined);
    const next = vi.fn();

    await controller.get(
      createRequest({ params: { jti: 'missing-token' } }),
      createResponse(),
      next as NextFunction
    );

    const error = next.mock.calls[0]?.[0] as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(404);
    expect(error.detail).toContain('missing-token');
  });

  it('revokes an existing token before returning 204', async () => {
    const { adapter, deps } = createDeps();
    const controller = new RegistrationTokensController(deps);
    adapter.find.mockResolvedValue({ jti: 'token-1' });
    const res = createResponse();
    const next = vi.fn();

    await controller.destroy(
      createRequest({ params: { jti: 'token-1' } }),
      res,
      next as NextFunction
    );

    expect(adapter.destroy).toHaveBeenCalledWith('token-1');
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.end).toHaveBeenCalledOnce();
    expect(deps.providerService.getProviderForTenant).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it('does not report success when the token to revoke is missing', async () => {
    const { adapter, deps } = createDeps();
    const controller = new RegistrationTokensController(deps);
    adapter.find.mockResolvedValue(undefined);
    const res = createResponse();
    const next = vi.fn();

    await controller.destroy(
      createRequest({ params: { jti: 'missing-token' } }),
      res,
      next as NextFunction
    );

    expect(adapter.destroy).not.toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(204);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ status: 404 }));
  });
});
