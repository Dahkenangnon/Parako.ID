/**
 * TDD — AdminUserGrantsController
 *
 * Covers the public admin grant listing and revocation behavior with portable
 * adapter filters, safe query handling, enriched client data, and audit logs.
 */
import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminUserGrantsController } from '../../../../src/controllers/admin/grant.controller.js';

function makeMocks() {
  const flash = {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  };
  const grant = {
    countGrants: vi.fn().mockResolvedValue(0),
    findGrantsWithPagination: vi.fn().mockResolvedValue([]),
    getDistinctValues: vi.fn().mockResolvedValue([]),
    findGrantById: vi.fn(),
    find: vi.fn(),
    destroy: vi.fn(),
    findGrantsByAccountId: vi.fn(),
    findGrantsByClientId: vi.fn(),
    getGrantStatistics: vi.fn(),
  };
  return {
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    oidcAdapter: {
      grant,
      client: { find: vi.fn() },
    },
    activity: {
      success: vi.fn(),
      failed: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    },
    sessionManager: {
      getActiveUser: vi.fn<
        () => { id: string; username: string; email: string } | undefined
      >(() => ({
        id: 'admin-1',
        username: 'admin',
        email: 'admin@example.com',
      })),
      flash: vi.fn((_request: unknown) => flash),
    },
    clientDeviceInfoManager: {
      getClientInfoFromRequest: vi.fn(() => ({
        ip: '127.0.0.1',
        user_agent: 'vitest',
      })),
    },
  };
}

function makeController(mocks = makeMocks()) {
  return {
    controller: new AdminUserGrantsController(
      mocks.logger as any,
      mocks.oidcAdapter as any,
      mocks.activity as any,
      mocks.sessionManager as any,
      mocks.clientDeviceInfoManager as any
    ),
    ...mocks,
  };
}

function makeReq(overrides: Record<string, unknown> = {}) {
  return {
    query: {},
    params: {},
    body: {},
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    ...overrides,
  } as any;
}

function makeRes() {
  const res = {
    redirect: vi.fn(),
    render: vi.fn(),
    status: vi.fn(),
    json: vi.fn(),
  } as any;
  res.status.mockReturnValue(res);
  return res;
}

describe('AdminUserGrantsController', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('list()', () => {
    it('builds portable filters and renders enriched, paginated grants', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
      const mocks = makeMocks();
      const issuedAt = Date.parse('2026-08-01T12:00:00.000Z') / 1000;
      const expiresAt = Date.parse('2026-08-02T11:00:00.000Z') / 1000;
      mocks.oidcAdapter.grant.countGrants.mockResolvedValue(5);
      mocks.oidcAdapter.grant.findGrantsWithPagination.mockResolvedValue([
        {
          _id: 'row-1',
          payload: {
            jti: 'grant-1',
            accountId: 'alice',
            clientId: 'client-1',
            iat: issuedAt,
            exp: expiresAt,
            openid: { scope: 'openid profile  ' },
            resources: {
              api: 'read write',
              duplicate: 'profile',
              empty: '',
              ignored: 42,
            },
          },
        },
      ]);
      mocks.oidcAdapter.grant.getDistinctValues
        .mockResolvedValueOnce(['client-1'])
        .mockResolvedValueOnce(['alice']);
      mocks.oidcAdapter.client.find.mockResolvedValue({
        clientId: 'client-1',
        clientName: 'Demo RP',
        clientUri: 'https://rp.example.com/app',
        logoUri: '/images/rp.svg',
      });
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.list(
        makeReq({
          query: {
            page: '2',
            limit: '2',
            search: ' a+b ',
            sortBy: 'payload.iat',
            sortOrder: 'asc',
            clientId: ['client-1', 'ignored'],
            username: 'alice',
          },
        }),
        res
      );

      const filters = {
        $or: [
          {
            'payload.accountId': { $regex: 'a\\+b', $options: 'i' },
          },
          {
            'payload.clientId': { $regex: 'a\\+b', $options: 'i' },
          },
        ],
        'payload.clientId': 'client-1',
        'payload.accountId': 'alice',
      };
      expect(mocks.oidcAdapter.grant.countGrants).toHaveBeenCalledWith(filters);
      expect(
        mocks.oidcAdapter.grant.findGrantsWithPagination
      ).toHaveBeenCalledWith(filters, 'payload.iat', 1, 2, 2);
      expect(res.render).toHaveBeenCalledWith('admin/user-grants/index', {
        title: 'User Grants Management',
        grants: [
          expect.objectContaining({
            id: 'row-1',
            grantId: 'grant-1',
            username: 'alice',
            client: {
              id: 'client-1',
              name: 'Demo RP',
              developer: 'rp.example.com',
              logo: '/images/rp.svg',
            },
            scopes: ['openid', 'profile', 'read', 'write'],
            grantedAt: new Date(issuedAt * 1000),
            lastUsed: '1 day ago',
            expiresAt: new Date(expiresAt * 1000),
            expiresIn: '1 hour ago',
            isExpired: true,
          }),
        ],
        pagination: {
          page: 2,
          limit: 2,
          totalPages: 3,
          totalGrants: 5,
          hasNext: true,
          hasPrev: true,
          startIndex: 3,
          endIndex: 4,
        },
        filters: {
          search: 'a+b',
          clientId: 'client-1',
          username: 'alice',
          sortBy: 'payload.iat',
          sortOrder: 'asc',
        },
        uniqueClients: [{ id: 'client-1', name: 'Demo RP' }],
        uniqueUsernames: [{ id: 'alice', name: 'alice' }],
      });
    });

    it('renders standard OIDC client metadata without requesting a fallback asset', async () => {
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantsWithPagination.mockResolvedValue([
        {
          _id: 'row-1',
          payload: {
            accountId: 'alice',
            clientId: 'client-1',
          },
        },
      ]);
      mocks.oidcAdapter.grant.getDistinctValues
        .mockResolvedValueOnce(['client-1'])
        .mockResolvedValueOnce(['alice']);
      mocks.oidcAdapter.client.find.mockResolvedValue({
        client_id: 'client-1',
        client_name: 'Standards-based RP',
        client_uri: 'https://rp.example.test/application',
        logo_uri: '',
      });
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.list(makeReq(), res);

      expect(res.render.mock.calls[0][1]).toEqual(
        expect.objectContaining({
          grants: [
            expect.objectContaining({
              client: {
                id: 'client-1',
                name: 'Standards-based RP',
                developer: 'rp.example.test',
                logo: null,
              },
            }),
          ],
          uniqueClients: [{ id: 'client-1', name: 'Standards-based RP' }],
        })
      );
    });

    it.each([
      [{ malicious: true }, { nested: true }],
      [42, 84],
      [[], []],
    ])(
      'ignores non-string client and username filters %#',
      async (clientId, username) => {
        const { controller, oidcAdapter } = makeController();
        const res = makeRes();

        await controller.list(makeReq({ query: { clientId, username } }), res);

        expect(oidcAdapter.grant.countGrants).toHaveBeenCalledWith({});
        expect(res.render).toHaveBeenCalledWith(
          'admin/user-grants/index',
          expect.objectContaining({
            filters: expect.objectContaining({ clientId: '', username: '' }),
          })
        );
      }
    );

    it('uses safe client fallbacks when enrichment fails or data is absent', async () => {
      const failure = new Error('client store unavailable');
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantsWithPagination.mockResolvedValue([
        {
          _id: 'without-client',
          payload: { resources: { whitespace: '   ' } },
        },
        {
          _id: 'missing-client',
          payload: { clientId: 'missing', accountId: '', iat: null, exp: null },
        },
        {
          _id: 'failed-client',
          payload: { clientId: 'failed', accountId: 'bob' },
        },
        {
          _id: 'fallback-fields',
          payload: { clientId: 'fallback', accountId: 'carol' },
        },
        {
          _id: 'empty-client-fields',
          payload: { clientId: 'empty-client', accountId: 'dan' },
        },
      ]);
      mocks.oidcAdapter.grant.getDistinctValues
        .mockResolvedValueOnce(['missing', 'failed', 'fallback'])
        .mockResolvedValueOnce([]);
      mocks.oidcAdapter.client.find.mockImplementation(async id => {
        if (id === 'failed') throw failure;
        if (id === 'fallback') {
          return {
            clientId: 'fallback-id',
            clientName: '',
            clientUri: 42,
            logoUri: '',
          };
        }
        if (id === 'empty-client') {
          return {
            clientId: '',
            clientName: '',
          };
        }
        return null;
      });
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.list(makeReq(), res);

      const rendered = res.render.mock.calls[0][1];
      expect(rendered.grants).toEqual([
        expect.objectContaining({
          username: 'Unknown',
          client: expect.objectContaining({ id: 'Unknown' }),
          grantedAt: 'Unknown',
          lastUsed: 'Unknown',
          expiresAt: null,
          expiresIn: 'Unknown',
          isExpired: false,
        }),
        expect.objectContaining({
          client: expect.objectContaining({ id: 'missing' }),
        }),
        expect.objectContaining({
          client: expect.objectContaining({ id: 'failed' }),
        }),
        expect.objectContaining({
          client: {
            id: 'fallback',
            name: 'fallback-id',
            developer: 'Unknown Developer',
            logo: null,
          },
        }),
        expect.objectContaining({
          client: {
            id: 'empty-client',
            name: 'Unknown Application',
            developer: 'Unknown Developer',
            logo: null,
          },
        }),
      ]);
      expect(rendered.uniqueClients).toEqual([
        { id: 'missing', name: 'missing' },
        { id: 'failed', name: 'failed' },
        { id: 'fallback', name: 'fallback-id' },
      ]);
      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'client_info_load_failed',
      });
      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'client_info_load_failed',
        clientId: 'failed',
      });
    });

    it('formats relative-time boundaries without changing grant order', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
      const nowSeconds = Date.now() / 1000;
      const mocks = makeMocks();
      const offsets = [
        [2 * 24 * 60 * 60, '2 days ago'],
        [2 * 60 * 60, '2 hours ago'],
        [60, '1 minute ago'],
        [2 * 60, '2 minutes ago'],
        [0, 'Just now'],
      ] as const;
      mocks.oidcAdapter.grant.findGrantsWithPagination.mockResolvedValue(
        offsets.map(([offset], index) => ({
          _id: `grant-${index}`,
          payload: { iat: nowSeconds - offset },
        }))
      );
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.list(makeReq(), res);

      expect(
        res.render.mock.calls[0][1].grants.map((grant: any) => grant.lastUsed)
      ).toEqual(offsets.map(([, label]) => label));
    });

    it('preserves the issued timestamp for view-level timezone formatting', async () => {
      const issuedAt = Date.parse('2026-08-01T10:30:45.000Z') / 1000;
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantsWithPagination.mockResolvedValue([
        {
          _id: 'grant-1',
          payload: { iat: issuedAt },
        },
      ]);
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.list(makeReq(), res);

      expect(res.render.mock.calls[0][1].grants[0].grantedAt).toEqual(
        new Date(issuedAt * 1000)
      );
    });

    it('reports a zero-based display range when no grants match', async () => {
      const { controller } = makeController();
      const res = makeRes();

      await controller.list(makeReq(), res);

      expect(res.render.mock.calls[0][1].pagination).toEqual(
        expect.objectContaining({
          totalGrants: 0,
          startIndex: 0,
          endIndex: 0,
        })
      );
    });
  });

  describe('show()', () => {
    it('throws a typed 404 guard when the grant does not exist', async () => {
      const { controller, oidcAdapter } = makeController();
      oidcAdapter.grant.findGrantById.mockResolvedValue(null);

      await expect(
        controller.show(makeReq({ params: { id: 'missing' } }), makeRes())
      ).rejects.toMatchObject({
        name: 'GuardError',
        message: 'Grant not found',
        status: 404,
        redirectTo: '/admin/user-grants',
        flashMessage: 'Grant not found',
      });
    });

    it('renders complete grant details and client metadata', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
      const mocks = makeMocks();
      const issuedAt = Date.parse('2026-08-01T10:30:00.000Z') / 1000;
      const expiresAt = Date.parse('2026-08-03T10:30:00.000Z') / 1000;
      mocks.oidcAdapter.grant.findGrantById.mockResolvedValue({
        _id: 'row-1',
        payload: {
          jti: 'grant-1',
          accountId: 'alice',
          clientId: 'client-1',
          iat: issuedAt,
          exp: expiresAt,
          openid: { scope: 'openid email' },
          resources: { api: 'read email' },
        },
        created_at: '2026-08-01T10:30:00.000Z',
        updated_at: '2026-08-01T11:00:00.000Z',
      });
      mocks.oidcAdapter.client.find.mockResolvedValue({
        clientId: 'client-1',
        clientName: 'Demo RP',
        clientUri: 'https://rp.example.com/app',
        logoUri: '/images/rp.svg',
        redirectUris: ['https://rp.example.com/callback'],
      });
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.show(makeReq({ params: { id: 'row-1' } }), res);

      const format = (timestamp: number) =>
        `${new Date(timestamp * 1000).toLocaleDateString()} ${new Date(
          timestamp * 1000
        ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
      expect(res.render).toHaveBeenCalledWith('admin/user-grants/show', {
        title: 'Grant Details',
        grant: expect.objectContaining({
          id: 'row-1',
          grantId: 'grant-1',
          username: 'alice',
          client: {
            id: 'client-1',
            name: 'Demo RP',
            developer: 'rp.example.com',
            logo: '/images/rp.svg',
            uri: 'https://rp.example.com/app',
            redirectUris: ['https://rp.example.com/callback'],
          },
          scopes: ['openid', 'email', 'read'],
          grantedAt: new Date(issuedAt * 1000),
          expiresAt: new Date(expiresAt * 1000),
          expiresIn: format(expiresAt),
          isExpired: false,
          created_at: new Date('2026-08-01T10:30:00.000Z'),
          updated_at: new Date('2026-08-01T11:00:00.000Z'),
        }),
      });
    });

    it('preserves the issued timestamp in grant details for timezone formatting', async () => {
      const issuedAt = Date.parse('2026-08-01T10:30:45.000Z') / 1000;
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantById.mockResolvedValue({
        _id: 'row-1',
        payload: { iat: issuedAt },
      });
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.show(makeReq({ params: { id: 'row-1' } }), res);

      expect(res.render.mock.calls[0][1].grant.grantedAt).toEqual(
        new Date(issuedAt * 1000)
      );
    });

    it('uses stable defaults when optional payload and client data are absent', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantById.mockResolvedValue({
        _id: 'row-1',
        payload: {},
      });
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.show(makeReq({ params: { id: 'row-1' } }), res);

      expect(mocks.oidcAdapter.client.find).not.toHaveBeenCalled();
      expect(res.render.mock.calls[0][1].grant).toEqual(
        expect.objectContaining({
          grantId: 'row-1',
          username: 'Unknown',
          client: expect.objectContaining({
            id: 'Unknown',
            name: 'Unknown Application',
          }),
          scopes: [],
          grantedAt: 'Unknown',
          expiresAt: null,
          expiresIn: 'Unknown',
          isExpired: false,
          created_at: new Date('2026-08-02T12:00:00.000Z'),
          updated_at: new Date('2026-08-02T12:00:00.000Z'),
        })
      );
    });

    it('logs client enrichment failures and still renders details', async () => {
      const failure = new Error('invalid client URL');
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantById.mockResolvedValue({
        _id: 'row-1',
        payload: { clientId: 'client-1' },
      });
      mocks.oidcAdapter.client.find.mockRejectedValue(failure);
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.show(makeReq({ params: { id: 'row-1' } }), res);

      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'client_info_load_failed',
      });
      expect(res.render.mock.calls[0][1].grant.client).toEqual(
        expect.objectContaining({ id: 'client-1', name: 'Unknown Application' })
      );
    });

    it('keeps defaults when the registered client no longer exists', async () => {
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantById.mockResolvedValue({
        _id: 'row-1',
        payload: { clientId: 'deleted-client' },
      });
      mocks.oidcAdapter.client.find.mockResolvedValue(null);
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.show(makeReq({ params: { id: 'row-1' } }), res);

      expect(res.render.mock.calls[0][1].grant.client).toEqual(
        expect.objectContaining({
          id: 'deleted-client',
          name: 'Unknown Application',
        })
      );
    });

    it('normalizes incomplete client metadata and marks expired grants', async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-08-02T12:00:00.000Z'));
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantById.mockResolvedValue({
        _id: 'row-1',
        payload: {
          clientId: 'client-1',
          exp: Date.parse('2026-08-01T12:00:00.000Z') / 1000,
        },
      });
      mocks.oidcAdapter.client.find.mockResolvedValue({
        clientId: '',
        clientName: '',
        clientUri: 42,
        logoUri: '',
        redirectUris: null,
      });
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.show(makeReq({ params: { id: 'row-1' } }), res);

      expect(res.render.mock.calls[0][1].grant).toEqual(
        expect.objectContaining({
          client: {
            id: 'client-1',
            name: 'Unknown Application',
            developer: 'Unknown Developer',
            logo: null,
            uri: '',
            redirectUris: [],
          },
          isExpired: true,
        })
      );
    });

    it('uses an empty URI when client metadata omits it', async () => {
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantById.mockResolvedValue({
        _id: 'row-1',
        payload: { clientId: 'client-1' },
      });
      mocks.oidcAdapter.client.find.mockResolvedValue({
        clientId: 'client-1',
        clientUri: '',
      });
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.show(makeReq({ params: { id: 'row-1' } }), res);

      expect(res.render.mock.calls[0][1].grant.client.uri).toBe('');
    });
  });

  describe('revokeGrant()', () => {
    it('redirects a native browser form after revoking the grant', async () => {
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantById.mockResolvedValue({
        payload: {
          jti: 'grant-1',
          accountId: 'alice',
          clientId: 'client-1',
        },
      });
      mocks.oidcAdapter.grant.find.mockResolvedValue({ jti: 'grant-1' });
      const { controller } = makeController(mocks);
      const req = makeReq({
        accepts: vi.fn(() => 'html'),
        headers: { accept: 'text/html' },
        params: { id: 'row-1' },
      });
      const res = makeRes();

      await controller.revokeGrant(req, res);

      expect(mocks.sessionManager.flash(req).success).toHaveBeenCalledWith(
        'Grant revoked successfully'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/user-grants');
      expect(res.json).not.toHaveBeenCalled();
    });

    it('redirects a native browser form with a recoverable error', async () => {
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantById.mockResolvedValue(null);
      const { controller } = makeController(mocks);
      const req = makeReq({
        accepts: vi.fn(() => 'html'),
        headers: { accept: 'text/html' },
        params: { id: 'missing' },
      });
      const res = makeRes();

      await controller.revokeGrant(req, res);

      expect(mocks.sessionManager.flash(req).error).toHaveBeenCalledWith(
        'Grant not found'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/user-grants');
      expect(res.status).not.toHaveBeenCalled();
      expect(res.json).not.toHaveBeenCalled();
    });

    it('returns 404 when the database grant does not exist', async () => {
      const { controller, oidcAdapter, activity } = makeController();
      oidcAdapter.grant.findGrantById.mockResolvedValue(null);
      const res = makeRes();

      await controller.revokeGrant(makeReq({ params: { id: 'missing' } }), res);

      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Grant not found',
      });
      expect(oidcAdapter.grant.find).not.toHaveBeenCalled();
      expect(oidcAdapter.grant.destroy).not.toHaveBeenCalled();
      expect(activity.success).not.toHaveBeenCalled();
    });

    it('returns 400 when the persisted grant has no provider identifier', async () => {
      const { controller, oidcAdapter } = makeController();
      oidcAdapter.grant.findGrantById.mockResolvedValue({ payload: {} });
      const res = makeRes();

      await controller.revokeGrant(makeReq({ params: { id: 'row-1' } }), res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Grant has no valid identifier',
      });
      expect(oidcAdapter.grant.find).not.toHaveBeenCalled();
    });

    it('returns 404 when the provider grant has already disappeared', async () => {
      const { controller, oidcAdapter } = makeController();
      oidcAdapter.grant.findGrantById.mockResolvedValue({
        payload: { jti: 'grant-1' },
      });
      oidcAdapter.grant.find.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.revokeGrant(makeReq({ params: { id: 'row-1' } }), res);

      expect(oidcAdapter.grant.find).toHaveBeenCalledWith('grant-1');
      expect(res.status).toHaveBeenCalledWith(404);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Grant not found in OIDC provider',
      });
      expect(oidcAdapter.grant.destroy).not.toHaveBeenCalled();
    });

    it('revokes the provider grant and records an attributable audit event', async () => {
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantById.mockResolvedValue({
        payload: {
          jti: 'grant-1',
          accountId: 'alice',
          clientId: 'client-1',
        },
      });
      mocks.oidcAdapter.grant.find.mockResolvedValue({ jti: 'grant-1' });
      const { controller } = makeController(mocks);
      const req = makeReq({
        params: { id: 'row-1' },
        requestId: 'request-1',
      });
      const res = makeRes();

      await controller.revokeGrant(req, res);

      expect(mocks.oidcAdapter.grant.destroy).toHaveBeenCalledWith('grant-1');
      expect(mocks.activity.success).toHaveBeenCalledWith(
        'grant_revoked_by_admin',
        'Admin revoked grant for user and client',
        null,
        expect.objectContaining({
          ip_address: '127.0.0.1',
          user_agent: 'vitest',
          client_id: 'client-1',
          actor: expect.objectContaining({
            id: 'admin-1',
            username: 'admin',
            actor_type: 'admin',
          }),
          target: {
            target_type: 'grant',
            entity_id: 'grant-1',
            entity_data: { accountId: 'alice', clientId: 'client-1' },
          },
          metadata: { requestId: 'request-1' },
        })
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Admin admin revoked grant grant-1 for user alice and client client-1'
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Grant revoked successfully',
      });
    });

    it('uses an anonymous audit actor when no admin session is available', async () => {
      const mocks = makeMocks();
      mocks.sessionManager.getActiveUser.mockReturnValue(undefined);
      mocks.oidcAdapter.grant.findGrantById.mockResolvedValue({
        payload: { jti: 'grant-1', accountId: 'alice', clientId: 'client-1' },
      });
      mocks.oidcAdapter.grant.find.mockResolvedValue({ jti: 'grant-1' });
      const { controller } = makeController(mocks);

      await controller.revokeGrant(
        makeReq({ params: { id: 'row-1' } }),
        makeRes()
      );

      expect(mocks.activity.success).toHaveBeenCalledWith(
        'grant_revoked_by_admin',
        expect.any(String),
        null,
        expect.objectContaining({ actor: { actor_type: 'anonymous' } })
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Admin unknown revoked grant')
      );
    });

    it('returns a stable 500 response when revocation fails', async () => {
      const failure = new Error('provider unavailable');
      const { controller, oidcAdapter, logger } = makeController();
      oidcAdapter.grant.findGrantById.mockRejectedValue(failure);
      const res = makeRes();

      await controller.revokeGrant(makeReq({ params: { id: 'row-1' } }), res);

      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'grant_revocation_failed',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to revoke grant',
      });
    });
  });

  describe('revokeUserGrants()', () => {
    it('redirects a native browser form after revoking every user grant', async () => {
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { _id: 'row-1', payload: { jti: 'grant-1' } },
      ]);
      mocks.oidcAdapter.grant.find.mockResolvedValue({ jti: 'grant-1' });
      const { controller } = makeController(mocks);
      const req = makeReq({
        accepts: vi.fn(() => 'html'),
        headers: { accept: 'text/html' },
        params: { username: 'alice' },
      });
      const res = makeRes();

      await controller.revokeUserGrants(req, res);

      expect(mocks.sessionManager.flash(req).success).toHaveBeenCalledWith(
        'Successfully revoked 1 grant(s)'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/user-grants');
      expect(res.json).not.toHaveBeenCalled();
    });

    it('redirects a native browser form when the user has no grants', async () => {
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([]);
      const { controller } = makeController(mocks);
      const req = makeReq({
        accepts: vi.fn(() => 'html'),
        headers: { accept: 'text/html' },
        params: { username: 'alice' },
      });
      const res = makeRes();

      await controller.revokeUserGrants(req, res);

      expect(mocks.sessionManager.flash(req).info).toHaveBeenCalledWith(
        'No grants found for this user'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/user-grants');
      expect(res.json).not.toHaveBeenCalled();
    });

    it.each([null, []])(
      'returns success when the user has no grants (%#)',
      async grants => {
        const { controller, oidcAdapter, activity } = makeController();
        oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue(grants);
        const res = makeRes();

        await controller.revokeUserGrants(
          makeReq({ params: { username: 'alice' } }),
          res
        );

        expect(res.json).toHaveBeenCalledWith({
          success: true,
          message: 'No grants found for this user',
          revokedCount: 0,
        });
        expect(activity.success).not.toHaveBeenCalled();
      }
    );

    it('continues past malformed, missing, and failed grants while auditing successes', async () => {
      const failure = new Error('one grant failed');
      const mocks = makeMocks();
      mocks.sessionManager.getActiveUser.mockReturnValue(undefined);
      mocks.oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { _id: 'without-jti', payload: {} },
        { _id: 'missing', payload: { jti: 'missing' } },
        { _id: 'valid', payload: { jti: 'valid' } },
        { _id: 'failed', payload: { jti: 'failed' } },
      ]);
      mocks.oidcAdapter.grant.find.mockImplementation(async id => {
        if (id === 'failed') throw failure;
        return id === 'valid' ? { jti: id } : undefined;
      });
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.revokeUserGrants(
        makeReq({ params: { username: 'alice' } }),
        res
      );

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Grant without-jti has no jti, skipping revocation'
      );
      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'grant_revocation_failed',
      });
      expect(mocks.oidcAdapter.grant.destroy).toHaveBeenCalledTimes(1);
      expect(mocks.oidcAdapter.grant.destroy).toHaveBeenCalledWith('valid');
      expect(mocks.activity.success).toHaveBeenCalledWith(
        'all_user_grants_revoked_by_admin',
        'Admin revoked all grants for user',
        null,
        expect.objectContaining({
          actor: { actor_type: 'anonymous' },
          target: {
            target_type: 'grant',
            username: 'alice',
            entity_data: { revokedCount: 1 },
          },
        })
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Admin unknown revoked all grants (1) for user alice'
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Successfully revoked 1 grant(s)',
        revokedCount: 1,
      });
    });

    it('does not create an audit event when no provider grants remain', async () => {
      const { controller, oidcAdapter, activity } = makeController();
      oidcAdapter.grant.findGrantsByAccountId.mockResolvedValue([
        { _id: 'missing', payload: { jti: 'missing' } },
      ]);
      oidcAdapter.grant.find.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.revokeUserGrants(
        makeReq({ params: { username: 'alice' } }),
        res
      );

      expect(activity.success).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ revokedCount: 0 })
      );
    });

    it('returns 500 when loading the user grants fails', async () => {
      const failure = new Error('grant store unavailable');
      const { controller, oidcAdapter, logger } = makeController();
      oidcAdapter.grant.findGrantsByAccountId.mockRejectedValue(failure);
      const res = makeRes();

      await controller.revokeUserGrants(
        makeReq({ params: { username: 'alice' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'user_grants_revocation_failed',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to revoke user grants',
      });
    });
  });

  describe('revokeClientGrants()', () => {
    it('redirects a native browser form after revoking every client grant', async () => {
      const mocks = makeMocks();
      mocks.oidcAdapter.grant.findGrantsByClientId.mockResolvedValue([
        { _id: 'row-1', payload: { jti: 'grant-1' } },
      ]);
      mocks.oidcAdapter.grant.find.mockResolvedValue({ jti: 'grant-1' });
      const { controller } = makeController(mocks);
      const req = makeReq({
        accepts: vi.fn(() => 'html'),
        headers: { accept: 'text/html' },
        params: { clientId: 'client-1' },
      });
      const res = makeRes();

      await controller.revokeClientGrants(req, res);

      expect(mocks.sessionManager.flash(req).success).toHaveBeenCalledWith(
        'Successfully revoked 1 grant(s)'
      );
      expect(res.redirect).toHaveBeenCalledWith('/admin/user-grants');
      expect(res.json).not.toHaveBeenCalled();
    });

    it.each([null, []])(
      'returns success when the client has no grants (%#)',
      async grants => {
        const { controller, oidcAdapter, activity } = makeController();
        oidcAdapter.grant.findGrantsByClientId.mockResolvedValue(grants);
        const res = makeRes();

        await controller.revokeClientGrants(
          makeReq({ params: { clientId: 'client-1' } }),
          res
        );

        expect(res.json).toHaveBeenCalledWith({
          success: true,
          message: 'No grants found for this client',
          revokedCount: 0,
        });
        expect(activity.success).not.toHaveBeenCalled();
      }
    );

    it('continues past malformed, missing, and failed client grants', async () => {
      const failure = new Error('one grant failed');
      const mocks = makeMocks();
      mocks.sessionManager.getActiveUser.mockReturnValue(undefined);
      mocks.oidcAdapter.grant.findGrantsByClientId.mockResolvedValue([
        { _id: 'without-jti', payload: {} },
        { _id: 'missing', payload: { jti: 'missing' } },
        { _id: 'valid', payload: { jti: 'valid' } },
        { _id: 'failed', payload: { jti: 'failed' } },
      ]);
      mocks.oidcAdapter.grant.find.mockImplementation(async id => {
        if (id === 'failed') throw failure;
        return id === 'valid' ? { jti: id } : undefined;
      });
      const { controller } = makeController(mocks);
      const res = makeRes();

      await controller.revokeClientGrants(
        makeReq({ params: { clientId: 'client-1' } }),
        res
      );

      expect(mocks.logger.warn).toHaveBeenCalledWith(
        'Grant without-jti has no jti, skipping revocation'
      );
      expect(mocks.logger.error).toHaveBeenCalledWith(failure, {
        context: 'grant_revocation_failed',
      });
      expect(mocks.oidcAdapter.grant.destroy).toHaveBeenCalledTimes(1);
      expect(mocks.oidcAdapter.grant.destroy).toHaveBeenCalledWith('valid');
      expect(mocks.activity.success).toHaveBeenCalledWith(
        'all_client_grants_revoked_by_admin',
        'Admin revoked all grants for client',
        null,
        expect.objectContaining({
          actor: { actor_type: 'anonymous' },
          target: {
            target_type: 'grant',
            entity_id: 'client-1',
            entity_name: 'client-1',
            entity_data: { revokedCount: 1 },
          },
        })
      );
      expect(mocks.logger.info).toHaveBeenCalledWith(
        'Admin unknown revoked all grants (1) for client client-1'
      );
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        message: 'Successfully revoked 1 grant(s)',
        revokedCount: 1,
      });
    });

    it('does not create an audit event when no provider grants remain', async () => {
      const { controller, oidcAdapter, activity } = makeController();
      oidcAdapter.grant.findGrantsByClientId.mockResolvedValue([
        { _id: 'missing', payload: { jti: 'missing' } },
      ]);
      oidcAdapter.grant.find.mockResolvedValue(undefined);
      const res = makeRes();

      await controller.revokeClientGrants(
        makeReq({ params: { clientId: 'client-1' } }),
        res
      );

      expect(activity.success).not.toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ revokedCount: 0 })
      );
    });

    it('returns 500 when loading the client grants fails', async () => {
      const failure = new Error('grant store unavailable');
      const { controller, oidcAdapter, logger } = makeController();
      oidcAdapter.grant.findGrantsByClientId.mockRejectedValue(failure);
      const res = makeRes();

      await controller.revokeClientGrants(
        makeReq({ params: { clientId: 'client-1' } }),
        res
      );

      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'client_grants_revocation_failed',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to revoke client grants',
      });
    });
  });

  describe('getStats()', () => {
    it('maps adapter statistics to the public admin response', async () => {
      const { controller, oidcAdapter } = makeController();
      oidcAdapter.grant.getGrantStatistics.mockResolvedValue({
        total: 8,
        recent: 3,
        expired: 2,
        byClient: [{ _id: 'client-1', count: 5 }],
        byUser: [{ _id: 'alice', count: 4 }],
      });
      const res = makeRes();

      await controller.getStats(makeReq(), res);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        stats: {
          totalGrants: 8,
          recentGrants: 3,
          expiredGrants: 2,
          grantsByClient: [{ clientId: 'client-1', count: 5 }],
          grantsByUser: [{ username: 'alice', count: 4 }],
        },
      });
    });

    it('returns 500 when statistics cannot be loaded', async () => {
      const failure = new Error('statistics unavailable');
      const { controller, oidcAdapter, logger } = makeController();
      oidcAdapter.grant.getGrantStatistics.mockRejectedValue(failure);
      const res = makeRes();

      await controller.getStats(makeReq(), res);

      expect(logger.error).toHaveBeenCalledWith(failure, {
        context: 'grant_statistics_load_failed',
      });
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Failed to get grant statistics',
      });
    });
  });
});
