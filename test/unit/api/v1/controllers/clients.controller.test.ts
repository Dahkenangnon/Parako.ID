import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import { ClientsController } from '../../../../../src/api/v1/controllers/clients.controller.js';
import type { ClientsControllerDeps } from '../../../../../src/api/v1/controllers/clients.controller.js';
import { ApiError } from '../../../../../src/api/v1/errors.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(): ClientsControllerDeps {
  return {
    oidcAdapter: {
      client: {
        findAllClients: vi.fn().mockResolvedValue([]),
        findClientById: vi.fn().mockResolvedValue(null),
        createClient: vi.fn().mockResolvedValue({}),
        updateClient: vi.fn().mockResolvedValue(null),
        deleteClient: vi.fn().mockResolvedValue(false),
        activateClient: vi.fn().mockResolvedValue(null),
        deactivateClient: vi.fn().mockResolvedValue(null),
        regenerateClientSecret: vi.fn().mockResolvedValue(null),
        getClientStatistics: vi.fn().mockResolvedValue({}),
        countClients: vi.fn().mockResolvedValue(0),
        searchClients: vi.fn().mockResolvedValue([]),
      },
    },
    logger: {
      error: vi.fn(),
      info: vi.fn(),
    },
  };
}

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    query: {},
    params: {},
    body: {},
    path: '/api/v1/clients',
    ...overrides,
  } as unknown as Request;
}

function createMockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    end: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function createMockNext(): NextFunction {
  return vi.fn() as unknown as NextFunction;
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleClient = {
  _id: '507f1f77bcf86cd799439011',
  client_id: 'test-client-001',
  client_name: 'Test Client',
  client_secret: 'super-secret-value',
  application_type: 'web',
  redirect_uris: ['https://example.com/callback'],
  active: true,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('api/v1/controllers/ClientsController', () => {
  let deps: ClientsControllerDeps;
  let controller: ClientsController;

  beforeEach(() => {
    deps = createMockDeps();
    controller = new ClientsController(deps);
  });

  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------
  describe('list()', () => {
    it('should return a paginated list of clients with secrets stripped', async () => {
      const clients = [
        { ...sampleClient },
        {
          ...sampleClient,
          _id: '507f1f77bcf86cd799439012',
          client_id: 'test-client-002',
        },
      ];
      vi.mocked(deps.oidcAdapter.client.findAllClients).mockResolvedValue(
        clients
      );

      const req = createMockRequest({ query: {} });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(deps.oidcAdapter.client.findAllClients).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toHaveLength(2);

      // Secrets must be stripped
      for (const client of jsonCall.data) {
        expect(client).not.toHaveProperty('client_secret');
      }

      expect(jsonCall.pagination).toBeDefined();
      expect(jsonCall.pagination.has_more).toBe(false);
    });

    it('should include total_count when include_count=true', async () => {
      vi.mocked(deps.oidcAdapter.client.findAllClients).mockResolvedValue([]);
      vi.mocked(deps.oidcAdapter.client.countClients).mockResolvedValue(42);

      const req = createMockRequest({ query: { include_count: 'true' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(deps.oidcAdapter.client.countClients).toHaveBeenCalled();

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.pagination.total_count).toBe(42);
    });

    it('should filter by application_type when provided', async () => {
      vi.mocked(deps.oidcAdapter.client.findAllClients).mockResolvedValue([]);

      const req = createMockRequest({ query: { application_type: 'spa' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.oidcAdapter.client.findAllClients).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('application_type', 'spa');
    });

    it('should filter by active status when provided', async () => {
      vi.mocked(deps.oidcAdapter.client.findAllClients).mockResolvedValue([]);

      const req = createMockRequest({ query: { active: 'true' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      const callArg = vi.mocked(deps.oidcAdapter.client.findAllClients).mock
        .calls[0][0];
      expect(callArg).toHaveProperty('active', true);
    });

    it('should use searchClients when q parameter is provided', async () => {
      const results = [{ ...sampleClient }];
      vi.mocked(deps.oidcAdapter.client.searchClients).mockResolvedValue(
        results
      );

      const req = createMockRequest({ query: { q: 'test' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(deps.oidcAdapter.client.searchClients).toHaveBeenCalledWith(
        'test'
      );
      expect(deps.oidcAdapter.client.findAllClients).not.toHaveBeenCalled();

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      for (const client of jsonCall.data) {
        expect(client).not.toHaveProperty('client_secret');
      }
    });

    it('should call next(error) on failure', async () => {
      const error = new Error('DB connection lost');
      vi.mocked(deps.oidcAdapter.client.findAllClients).mockRejectedValue(
        error
      );

      const req = createMockRequest();
      const res = createMockResponse();
      const next = createMockNext();

      await controller.list(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // -----------------------------------------------------------------------
  // create
  // -----------------------------------------------------------------------
  describe('create()', () => {
    it('should create a client and return 201 WITH the secret', async () => {
      const created = { ...sampleClient };
      vi.mocked(deps.oidcAdapter.client.createClient).mockResolvedValue(
        created
      );

      const req = createMockRequest({
        body: {
          client_name: 'Test Client',
          application_type: 'web',
          redirect_uris: ['https://example.com/callback'],
        },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(deps.oidcAdapter.client.createClient).toHaveBeenCalledWith(
        expect.objectContaining({ client_name: 'Test Client' })
      );
      expect(res.status).toHaveBeenCalledWith(201);

      // Secret IS included on create (shown once)
      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.client_secret).toBe('super-secret-value');
    });

    it('should log client creation', async () => {
      const created = { ...sampleClient };
      vi.mocked(deps.oidcAdapter.client.createClient).mockResolvedValue(
        created
      );

      const req = createMockRequest({
        body: { client_name: 'Test Client' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'OIDC client created',
        expect.objectContaining({ client_id: 'test-client-001' })
      );
    });

    it('should call next(error) on adapter failure', async () => {
      const error = new Error('Adapter failure');
      vi.mocked(deps.oidcAdapter.client.createClient).mockRejectedValue(error);

      const req = createMockRequest({
        body: { client_name: 'Valid Client' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.create(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // -----------------------------------------------------------------------
  // get
  // -----------------------------------------------------------------------
  describe('get()', () => {
    it('should return a client without the secret', async () => {
      vi.mocked(deps.oidcAdapter.client.findClientById).mockResolvedValue({
        ...sampleClient,
      });

      const req = createMockRequest({
        params: { client_id: 'test-client-001' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(deps.oidcAdapter.client.findClientById).toHaveBeenCalledWith(
        'test-client-001'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('client_secret');
      expect(jsonCall.data.client_id).toBe('test-client-001');
    });

    it('should strip secret from Mongoose documents (toJSON)', async () => {
      const mongooseDoc = {
        ...sampleClient,
        toJSON: () => ({ ...sampleClient }),
      };
      vi.mocked(deps.oidcAdapter.client.findClientById).mockResolvedValue(
        mongooseDoc
      );

      const req = createMockRequest({
        params: { client_id: 'test-client-001' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('client_secret');
    });

    it('should call next with 404 ApiError when client is not found', async () => {
      vi.mocked(deps.oidcAdapter.client.findClientById).mockResolvedValue(null);

      const req = createMockRequest({ params: { client_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.get(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(error.detail).toContain('nonexistent');
    });
  });

  // -----------------------------------------------------------------------
  // update
  // -----------------------------------------------------------------------
  describe('update()', () => {
    it('should validate body, update, and return the client without secret', async () => {
      const updated = { ...sampleClient, client_name: 'Updated Client' };
      vi.mocked(deps.oidcAdapter.client.updateClient).mockResolvedValue(
        updated
      );

      const req = createMockRequest({
        params: { client_id: 'test-client-001' },
        body: { client_name: 'Updated Client' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.update(req, res, next);

      expect(deps.oidcAdapter.client.updateClient).toHaveBeenCalledWith(
        'test-client-001',
        expect.objectContaining({ client_name: 'Updated Client' })
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('client_secret');
      expect(jsonCall.data.client_name).toBe('Updated Client');
    });

    it('should call next with 404 when client is not found', async () => {
      vi.mocked(deps.oidcAdapter.client.updateClient).mockResolvedValue(null);

      const req = createMockRequest({
        params: { client_id: 'nonexistent' },
        body: { client_name: 'Updated' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.update(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // patch
  // -----------------------------------------------------------------------
  describe('patch()', () => {
    it('should accept a partial body and return the updated client', async () => {
      const patched = { ...sampleClient, description: 'New description' };
      vi.mocked(deps.oidcAdapter.client.updateClient).mockResolvedValue(
        patched
      );

      const req = createMockRequest({
        params: { client_id: 'test-client-001' },
        body: { description: 'New description' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.patch(req, res, next);

      expect(deps.oidcAdapter.client.updateClient).toHaveBeenCalledWith(
        'test-client-001',
        expect.objectContaining({ description: 'New description' })
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('client_secret');
    });

    it('should accept an empty body (no fields required)', async () => {
      const unchanged = { ...sampleClient };
      vi.mocked(deps.oidcAdapter.client.updateClient).mockResolvedValue(
        unchanged
      );

      const req = createMockRequest({
        params: { client_id: 'test-client-001' },
        body: {},
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.patch(req, res, next);

      // application_type has a Zod default of 'web', so it appears even
      // when the body is empty.  The important assertion is that the call
      // succeeds and returns 200.
      expect(deps.oidcAdapter.client.updateClient).toHaveBeenCalledWith(
        'test-client-001',
        expect.objectContaining({})
      );
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should call next with 404 when client is not found', async () => {
      vi.mocked(deps.oidcAdapter.client.updateClient).mockResolvedValue(null);

      const req = createMockRequest({
        params: { client_id: 'nonexistent' },
        body: { client_name: 'Patched' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.patch(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // destroy
  // -----------------------------------------------------------------------
  describe('destroy()', () => {
    it('should delete the client and return 204', async () => {
      vi.mocked(deps.oidcAdapter.client.deleteClient).mockResolvedValue(true);

      const req = createMockRequest({
        params: { client_id: 'test-client-001' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.destroy(req, res, next);

      expect(deps.oidcAdapter.client.deleteClient).toHaveBeenCalledWith(
        'test-client-001'
      );
      expect(res.status).toHaveBeenCalledWith(204);
      expect(res.end).toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('should log client deletion', async () => {
      vi.mocked(deps.oidcAdapter.client.deleteClient).mockResolvedValue(true);

      const req = createMockRequest({
        params: { client_id: 'test-client-001' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.destroy(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'OIDC client deleted',
        expect.objectContaining({ client_id: 'test-client-001' })
      );
    });

    it('should call next with 404 when client is not found', async () => {
      vi.mocked(deps.oidcAdapter.client.deleteClient).mockResolvedValue(false);

      const req = createMockRequest({ params: { client_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.destroy(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // activate
  // -----------------------------------------------------------------------
  describe('activate()', () => {
    it('should activate the client and return it without secret', async () => {
      const activated = { ...sampleClient, active: true };
      vi.mocked(deps.oidcAdapter.client.activateClient).mockResolvedValue(
        activated
      );

      const req = createMockRequest({
        params: { client_id: 'test-client-001' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.activate(req, res, next);

      expect(deps.oidcAdapter.client.activateClient).toHaveBeenCalledWith(
        'test-client-001'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('client_secret');
      expect(jsonCall.data.active).toBe(true);
    });

    it('should call next with 404 when client is not found', async () => {
      vi.mocked(deps.oidcAdapter.client.activateClient).mockResolvedValue(null);

      const req = createMockRequest({ params: { client_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.activate(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // deactivate
  // -----------------------------------------------------------------------
  describe('deactivate()', () => {
    it('should deactivate the client and return it without secret', async () => {
      const deactivated = { ...sampleClient, active: false };
      vi.mocked(deps.oidcAdapter.client.deactivateClient).mockResolvedValue(
        deactivated
      );

      const req = createMockRequest({
        params: { client_id: 'test-client-001' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.deactivate(req, res, next);

      expect(deps.oidcAdapter.client.deactivateClient).toHaveBeenCalledWith(
        'test-client-001'
      );
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).not.toHaveProperty('client_secret');
      expect(jsonCall.data.active).toBe(false);
    });

    it('should call next with 404 when client is not found', async () => {
      vi.mocked(deps.oidcAdapter.client.deactivateClient).mockResolvedValue(
        null
      );

      const req = createMockRequest({ params: { client_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.deactivate(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // regenerateSecret
  // -----------------------------------------------------------------------
  describe('regenerateSecret()', () => {
    it('should regenerate the secret and return the client WITH the new secret', async () => {
      const regenerated = {
        ...sampleClient,
        client_secret: 'brand-new-secret',
      };
      vi.mocked(
        deps.oidcAdapter.client.regenerateClientSecret
      ).mockResolvedValue(regenerated);

      const req = createMockRequest({
        params: { client_id: 'test-client-001' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.regenerateSecret(req, res, next);

      expect(
        deps.oidcAdapter.client.regenerateClientSecret
      ).toHaveBeenCalledWith('test-client-001');
      expect(res.status).toHaveBeenCalledWith(200);

      // Secret IS included on regeneration (shown once)
      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data.client_secret).toBe('brand-new-secret');
    });

    it('should log secret regeneration', async () => {
      const regenerated = {
        ...sampleClient,
        client_secret: 'brand-new-secret',
      };
      vi.mocked(
        deps.oidcAdapter.client.regenerateClientSecret
      ).mockResolvedValue(regenerated);

      const req = createMockRequest({
        params: { client_id: 'test-client-001' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.regenerateSecret(req, res, next);

      expect(deps.logger.info).toHaveBeenCalledWith(
        'OIDC client secret regenerated',
        expect.objectContaining({ client_id: 'test-client-001' })
      );
    });

    it('should call next with 404 when client is not found', async () => {
      vi.mocked(
        deps.oidcAdapter.client.regenerateClientSecret
      ).mockResolvedValue(null);

      const req = createMockRequest({ params: { client_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.regenerateSecret(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
    });
  });

  // -----------------------------------------------------------------------
  // stats
  // -----------------------------------------------------------------------
  describe('stats()', () => {
    it('should return statistics for the client', async () => {
      vi.mocked(deps.oidcAdapter.client.findClientById).mockResolvedValue({
        ...sampleClient,
      });

      const statistics = {
        total_tokens_issued: 150,
        active_sessions: 12,
        last_used: '2026-03-07T10:00:00Z',
      };
      vi.mocked(deps.oidcAdapter.client.getClientStatistics).mockResolvedValue(
        statistics
      );

      const req = createMockRequest({
        params: { client_id: 'test-client-001' },
      });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.stats(req, res, next);

      expect(deps.oidcAdapter.client.findClientById).toHaveBeenCalledWith(
        'test-client-001'
      );
      expect(deps.oidcAdapter.client.getClientStatistics).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);

      const jsonCall = vi.mocked(res.json).mock.calls[0][0];
      expect(jsonCall.data).toEqual(statistics);
    });

    it('should call next with 404 when client does not exist', async () => {
      vi.mocked(deps.oidcAdapter.client.findClientById).mockResolvedValue(null);

      const req = createMockRequest({ params: { client_id: 'nonexistent' } });
      const res = createMockResponse();
      const next = createMockNext();

      await controller.stats(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ApiError));
      const error = vi.mocked(next).mock.calls[0][0] as unknown as ApiError;
      expect(error.status).toBe(404);
      expect(
        deps.oidcAdapter.client.getClientStatistics
      ).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // DB abstraction
  // -----------------------------------------------------------------------
  describe('DB abstraction', () => {
    describe('stripClientSecret', () => {
      it('should strip client_secret from plain object (no toJSON)', async () => {
        const client = {
          client_id: 'test',
          client_secret: 'secret123',
          client_name: 'Test',
        };
        vi.mocked(deps.oidcAdapter.client.findClientById).mockResolvedValue(
          client
        );
        const req = createMockRequest({ params: { client_id: 'test' } });
        const res = createMockResponse();
        await controller.get(req, res, createMockNext());
        const body = vi.mocked(res.json).mock.calls[0][0];
        expect(body.data.client_secret).toBeUndefined();
      });
    });

    describe('list — cursor field', () => {
      it('should pass "client_id" as cursor field (not "_id")', async () => {
        const clients = [
          { client_id: 'c1', client_name: 'A' },
          { client_id: 'c2', client_name: 'B' },
          { client_id: 'c3', client_name: 'C' },
          { client_id: 'c4', client_name: 'D' },
        ];
        vi.mocked(deps.oidcAdapter.client.findAllClients).mockResolvedValue(
          clients
        );
        const req = createMockRequest({ query: { limit: '3' } });
        const res = createMockResponse();
        await controller.list(req, res, createMockNext());
        const body = vi.mocked(res.json).mock.calls[0][0];
        expect(body.pagination.has_more).toBe(true);
        const decoded = JSON.parse(
          Buffer.from(
            body.pagination.next_cursor.replace(/-/g, '+').replace(/_/g, '/'),
            'base64'
          ).toString()
        );
        expect(decoded.client_id).toBeDefined();
      });
    });
  });
});
