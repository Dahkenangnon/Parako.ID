/**
 * Cross-Controller DB Abstraction Verification Tests (C12).
 *
 * Verifies that all API v1 controllers produce DB-agnostic output by testing
 * each controller with both MongoDB-shaped data (_id, no id field) and
 * Prisma-shaped data (id, plain objects). Ensures cursor pagination, filter
 * objects, and tenant ID resolution work correctly regardless of the
 * underlying database adapter.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { decodeCursor } from '../../../../src/api/v1/pagination.js';

// Import controllers and their deps types
import {
  UsersController,
  type UsersControllerDeps,
} from '../../../../src/api/v1/controllers/users.controller.js';
import {
  ClientsController,
  type ClientsControllerDeps,
} from '../../../../src/api/v1/controllers/clients.controller.js';
import {
  AuditController,
  type AuditControllerDeps,
} from '../../../../src/api/v1/controllers/audit.controller.js';
import {
  SessionsController,
  type SessionsControllerDeps,
} from '../../../../src/api/v1/controllers/sessions.controller.js';
import {
  TenantsController,
  type TenantsControllerDeps,
} from '../../../../src/api/v1/controllers/tenants.controller.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    query: {},
    params: {},
    body: {},
    path: '/api/v1/test',
    apiAuth: {
      client_id: 'test-client',
      scope:
        'parako:users:read parako:users:write parako:clients:read parako:clients:write parako:audit:read parako:sessions:read parako:sessions:write parako:tenants:read parako:tenants:write',
    },
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
// Test fixtures
// ---------------------------------------------------------------------------

// MongoDB-shaped fixtures (have _id, may have toJSON)
const mongoUsers = [
  { _id: '507f1f77bcf86cd799439011', email: 'a@test.com', username: 'a' },
  { _id: '507f1f77bcf86cd799439012', email: 'b@test.com', username: 'b' },
  { _id: '507f1f77bcf86cd799439013', email: 'c@test.com', username: 'c' },
  { _id: '507f1f77bcf86cd799439014', email: 'd@test.com', username: 'd' },
];

// Prisma-shaped fixtures (have id, plain objects)
const prismaUsers = [
  { id: 'clx0001', email: 'a@test.com', username: 'a' },
  { id: 'clx0002', email: 'b@test.com', username: 'b' },
  { id: 'clx0003', email: 'c@test.com', username: 'c' },
  { id: 'clx0004', email: 'd@test.com', username: 'd' },
];

const mongoClients = [
  { _id: 'm1', client_id: 'client-1', client_name: 'A' },
  { _id: 'm2', client_id: 'client-2', client_name: 'B' },
  { _id: 'm3', client_id: 'client-3', client_name: 'C' },
  { _id: 'm4', client_id: 'client-4', client_name: 'D' },
];

const prismaClients = [
  { id: 'p1', client_id: 'client-1', client_name: 'A' },
  { id: 'p2', client_id: 'client-2', client_name: 'B' },
  { id: 'p3', client_id: 'client-3', client_name: 'C' },
  { id: 'p4', client_id: 'client-4', client_name: 'D' },
];

const mongoActivities = [
  { _id: 'act1', type: 'login', timestamp: new Date('2026-01-01') },
  { _id: 'act2', type: 'logout', timestamp: new Date('2026-01-02') },
  { _id: 'act3', type: 'login', timestamp: new Date('2026-01-03') },
  { _id: 'act4', type: 'login', timestamp: new Date('2026-01-04') },
];

const prismaActivities = [
  { id: 'pact1', type: 'login', timestamp: new Date('2026-01-01') },
  { id: 'pact2', type: 'logout', timestamp: new Date('2026-01-02') },
  { id: 'pact3', type: 'login', timestamp: new Date('2026-01-03') },
  { id: 'pact4', type: 'login', timestamp: new Date('2026-01-04') },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('API v1 — DB abstraction contract', () => {
  // Helper to decode cursor from response.
  // apiList writes { data: [...], pagination: { ... } } at the top level.
  function getCursorFromResponse(res: Response): Record<string, string> | null {
    const body = vi.mocked(res.json).mock.calls[0]?.[0];
    const cursor = body?.pagination?.next_cursor;
    if (!cursor) return null;
    return decodeCursor(cursor);
  }

  // -------------------------------------------------------------------------
  // MongoDB-shaped data
  // -------------------------------------------------------------------------

  describe('with MongoDB-shaped data (_id, no id field)', () => {
    it('users: list cursor uses "id" key even with _id-only data', async () => {
      const deps: UsersControllerDeps = {
        userService: {
          findById: vi.fn(),
          updateById: vi.fn(),
          deactivate: vi.fn(),
          activate: vi.fn(),
          disableMfa: vi.fn(),
          anonymize: vi.fn(),
          findWithPagination: vi.fn().mockResolvedValue(mongoUsers),
        },
        authService: {
          registerUser: vi.fn(),
          adminChangeUserPassword: vi.fn(),
        },
        activityService: { getUserActivities: vi.fn() },
        oidcAdapter: { session: {} },
        logger: { error: vi.fn(), info: vi.fn() },
      };
      const controller = new UsersController(deps);
      const req = createMockRequest({ query: { limit: '3' } });
      const res = createMockResponse();

      await controller.list(req, res, createMockNext());

      const decoded = getCursorFromResponse(res);
      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBeDefined();
    });

    it('clients: list cursor uses "client_id" key', async () => {
      const deps: ClientsControllerDeps = {
        oidcAdapter: {
          client: {
            findAllClients: vi.fn().mockResolvedValue(mongoClients),
            findClientById: vi.fn(),
            createClient: vi.fn(),
            updateClient: vi.fn(),
            deleteClient: vi.fn(),
            activateClient: vi.fn(),
            deactivateClient: vi.fn(),
            regenerateClientSecret: vi.fn(),
            getClientStatistics: vi.fn(),
            countClients: vi.fn().mockResolvedValue(4),
            searchClients: vi.fn(),
          },
        },
        logger: { error: vi.fn(), info: vi.fn() },
      };
      const controller = new ClientsController(deps);
      const req = createMockRequest({ query: { limit: '3' } });
      const res = createMockResponse();

      await controller.list(req, res, createMockNext());

      const decoded = getCursorFromResponse(res);
      expect(decoded).not.toBeNull();
      expect(decoded!.client_id).toBeDefined();
    });

    it('audit: list cursor uses "id" key', async () => {
      const deps: AuditControllerDeps = {
        activityService: {
          queryActivities: vi.fn().mockResolvedValue({
            results: mongoActivities,
            totalResults: 4,
            totalPages: 1,
            page: 1,
            limit: 3,
          }),
          findOne: vi.fn(),
          getActivityTypes: vi.fn(),
          getActivityStats: vi.fn(),
        },
        logger: { error: vi.fn() },
      };
      const controller = new AuditController(deps);
      const req = createMockRequest({ query: { limit: '3' } });
      const res = createMockResponse();

      await controller.list(req, res, createMockNext());

      const decoded = getCursorFromResponse(res);
      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBeDefined();
    });

    it('tenants: getConfig resolves tenant ID from _id fallback', async () => {
      const tenant = { _id: 'mongo-tenant-id', slug: 'test-tenant' };
      const mockOverrideService = {
        loadOverrides: vi.fn().mockResolvedValue({}),
        saveOverrides: vi.fn(),
      };
      const deps: TenantsControllerDeps = {
        platformAdminService: {
          listTenants: vi.fn(),
          createTenant: vi.fn(),
          getTenantBySlug: vi.fn().mockResolvedValue(tenant),
        },
        tenantSettingsOverrideService: mockOverrideService,
        logger: { error: vi.fn(), info: vi.fn() },
      };
      const controller = new TenantsController(deps);
      const req = createMockRequest({ params: { slug: 'test-tenant' } });
      const res = createMockResponse();

      await controller.getConfig(req, res, createMockNext());

      expect(mockOverrideService.loadOverrides).toHaveBeenCalledWith(
        'mongo-tenant-id'
      );
    });
  });

  // -------------------------------------------------------------------------
  // Prisma-shaped data
  // -------------------------------------------------------------------------

  describe('with Prisma-shaped data (id, plain objects)', () => {
    it('users: list cursor uses "id" key with Prisma data', async () => {
      const deps: UsersControllerDeps = {
        userService: {
          findById: vi.fn(),
          updateById: vi.fn(),
          deactivate: vi.fn(),
          activate: vi.fn(),
          disableMfa: vi.fn(),
          anonymize: vi.fn(),
          findWithPagination: vi.fn().mockResolvedValue(prismaUsers),
        },
        authService: {
          registerUser: vi.fn(),
          adminChangeUserPassword: vi.fn(),
        },
        activityService: { getUserActivities: vi.fn() },
        oidcAdapter: { session: {} },
        logger: { error: vi.fn(), info: vi.fn() },
      };
      const controller = new UsersController(deps);
      const req = createMockRequest({ query: { limit: '3' } });
      const res = createMockResponse();

      await controller.list(req, res, createMockNext());

      const decoded = getCursorFromResponse(res);
      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBeDefined();
      expect(decoded!.id).toBe('clx0003');
    });

    it('clients: list cursor uses "client_id" key with Prisma data', async () => {
      const deps: ClientsControllerDeps = {
        oidcAdapter: {
          client: {
            findAllClients: vi.fn().mockResolvedValue(prismaClients),
            findClientById: vi.fn(),
            createClient: vi.fn(),
            updateClient: vi.fn(),
            deleteClient: vi.fn(),
            activateClient: vi.fn(),
            deactivateClient: vi.fn(),
            regenerateClientSecret: vi.fn(),
            getClientStatistics: vi.fn(),
            countClients: vi.fn().mockResolvedValue(4),
            searchClients: vi.fn(),
          },
        },
        logger: { error: vi.fn(), info: vi.fn() },
      };
      const controller = new ClientsController(deps);
      const req = createMockRequest({ query: { limit: '3' } });
      const res = createMockResponse();

      await controller.list(req, res, createMockNext());

      const decoded = getCursorFromResponse(res);
      expect(decoded).not.toBeNull();
      expect(decoded!.client_id).toBeDefined();
    });

    it('audit: list cursor uses "id" key with Prisma data', async () => {
      const deps: AuditControllerDeps = {
        activityService: {
          queryActivities: vi.fn().mockResolvedValue({
            results: prismaActivities,
            totalResults: 4,
            totalPages: 1,
            page: 1,
            limit: 3,
          }),
          findOne: vi.fn(),
          getActivityTypes: vi.fn(),
          getActivityStats: vi.fn(),
        },
        logger: { error: vi.fn() },
      };
      const controller = new AuditController(deps);
      const req = createMockRequest({ query: { limit: '3' } });
      const res = createMockResponse();

      await controller.list(req, res, createMockNext());

      const decoded = getCursorFromResponse(res);
      expect(decoded).not.toBeNull();
      expect(decoded!.id).toBe('pact3');
    });

    it('tenants: getConfig prefers id over _id', async () => {
      const tenant = {
        id: 'prisma-tenant-id',
        _id: 'mongo-tenant-id',
        slug: 'test-tenant',
      };
      const mockOverrideService = {
        loadOverrides: vi.fn().mockResolvedValue({}),
        saveOverrides: vi.fn(),
      };
      const deps: TenantsControllerDeps = {
        platformAdminService: {
          listTenants: vi.fn(),
          createTenant: vi.fn(),
          getTenantBySlug: vi.fn().mockResolvedValue(tenant),
        },
        tenantSettingsOverrideService: mockOverrideService,
        logger: { error: vi.fn(), info: vi.fn() },
      };
      const controller = new TenantsController(deps);
      const req = createMockRequest({ params: { slug: 'test-tenant' } });
      const res = createMockResponse();

      await controller.getConfig(req, res, createMockNext());

      expect(mockOverrideService.loadOverrides).toHaveBeenCalledWith(
        'prisma-tenant-id'
      );
    });
  });

  // -------------------------------------------------------------------------
  // Filter objects are DB-agnostic
  // -------------------------------------------------------------------------

  describe('filter objects passed to services are DB-agnostic', () => {
    it('audit: date range uses timestampRange, not $gte/$lte', async () => {
      const deps: AuditControllerDeps = {
        activityService: {
          queryActivities: vi.fn().mockResolvedValue({
            results: [],
            totalResults: 0,
            totalPages: 0,
            page: 1,
            limit: 25,
          }),
          findOne: vi.fn(),
          getActivityTypes: vi.fn(),
          getActivityStats: vi.fn(),
        },
        logger: { error: vi.fn() },
      };
      const controller = new AuditController(deps);
      const req = createMockRequest({
        query: {
          from: '2026-01-01T00:00:00Z',
          to: '2026-06-30T00:00:00Z',
        },
      });
      const res = createMockResponse();

      await controller.list(req, res, createMockNext());

      const filter = vi.mocked(deps.activityService.queryActivities).mock
        .calls[0][0];

      // Must use DB-agnostic timestampRange
      expect(filter.timestampRange).toBeDefined();
      const range = filter.timestampRange as { from: Date; to: Date };
      expect(range.from).toBeInstanceOf(Date);
      expect(range.to).toBeInstanceOf(Date);

      // Must NOT use MongoDB operators
      expect(filter.timestamp).toBeUndefined();
      expect(JSON.stringify(filter)).not.toContain('$gte');
      expect(JSON.stringify(filter)).not.toContain('$lte');
      expect(JSON.stringify(filter)).not.toContain('$gt');
      expect(JSON.stringify(filter)).not.toContain('$lt');
    });

    it('users: no MongoDB operators in filter', async () => {
      const deps: UsersControllerDeps = {
        userService: {
          findById: vi.fn(),
          updateById: vi.fn(),
          deactivate: vi.fn(),
          activate: vi.fn(),
          disableMfa: vi.fn(),
          anonymize: vi.fn(),
          findWithPagination: vi.fn().mockResolvedValue([]),
        },
        authService: {
          registerUser: vi.fn(),
          adminChangeUserPassword: vi.fn(),
        },
        activityService: { getUserActivities: vi.fn() },
        oidcAdapter: { session: {} },
        logger: { error: vi.fn(), info: vi.fn() },
      };
      const controller = new UsersController(deps);
      const req = createMockRequest({
        query: {
          account_enabled: 'true',
          role: 'admin',
          q: 'search term',
        },
      });
      const res = createMockResponse();

      await controller.list(req, res, createMockNext());

      const filter = vi.mocked(deps.userService.findWithPagination).mock
        .calls[0][0];
      const filterStr = JSON.stringify(filter);
      expect(filterStr).not.toContain('$regex');
      expect(filterStr).not.toContain('$gte');
      expect(filterStr).not.toContain('$lte');
    });

    it('sessions: no MongoDB operators in filter', async () => {
      const deps: SessionsControllerDeps = {
        oidcAdapter: {
          session: {
            find: vi.fn(),
            destroy: vi.fn(),
            findAll: vi.fn().mockResolvedValue([]),
          },
        },
        logger: { error: vi.fn(), info: vi.fn() },
      };
      const controller = new SessionsController(deps);
      const req = createMockRequest({ query: { username: 'testuser' } });
      const res = createMockResponse();

      await controller.list(req, res, createMockNext());

      const filter = vi.mocked(deps.oidcAdapter.session.findAll!).mock
        .calls[0][0];
      const filterStr = JSON.stringify(filter);
      expect(filterStr).not.toContain('$');
    });
  });
});
