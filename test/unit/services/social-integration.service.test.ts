/**
 * TDD — SocialIntegrationService uses ISocialIntegrationRepository for data access
 *
 * RED: SocialIntegrationService extends BaseService (Mongoose), uses socialIntegrationModel directly.
 * GREEN: After migrating to ISocialIntegrationRepository.
 */
import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SocialIntegrationService } from '../../../src/services/social-integration.service.js';
import type { ISocialIntegration } from '../../../src/types/social-integration.js';
import type { ISocialIntegrationRepository } from '../../../src/db/repositories/interfaces/social-integration.repository.js';
import { ensureDecrypted } from '../../../src/utils/encryption.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => mockLogger,
  getLogger: () => null,
  flush: async () => {},
  shutdown: async () => {},
} as any;

const mockUserService = {
  findById: vi.fn(),
} as any;

function makeMockRepo(): ISocialIntegrationRepository {
  return {
    findById: vi.fn(),
    findOne: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
    findByUserId: vi.fn(),
    findByUserAndProvider: vi.fn(),
    findByProvider: vi.fn(),
    deleteByUserId: vi.fn(),
  } as unknown as ISocialIntegrationRepository;
}

function makeIntegration(
  overrides: Partial<ISocialIntegration> = {}
): ISocialIntegration {
  return {
    _id: 'int-123',
    id: 'int-123',
    user_id: 'user-456',
    method: 'google',
    provider_sub: 'google-sub-123',
    provider_username: 'testuser',
    is_active: true,
    last_used: new Date('2025-01-01'),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as unknown as ISocialIntegration;
}

function makeService(
  repo: ISocialIntegrationRepository
): SocialIntegrationService {
  return new SocialIntegrationService(mockLogger, repo as any, mockUserService);
}

describe('SocialIntegrationService — ISocialIntegrationRepository delegation', () => {
  let repo: ISocialIntegrationRepository;
  let service: SocialIntegrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    service = makeService(repo);
  });

  describe('findById', () => {
    it('delegates to repo.findById', async () => {
      const integration = makeIntegration();
      vi.mocked(repo.findById).mockResolvedValue(integration);

      const result = await service.findById('int-123');

      expect(repo.findById).toHaveBeenCalledWith('int-123');
      expect(result).toEqual(integration);
    });

    it('returns null when not found', async () => {
      vi.mocked(repo.findById).mockResolvedValue(null);

      const result = await service.findById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('findByUserAndMethod', () => {
    it('delegates to repo.findOne with user_id and method filter', async () => {
      const integration = makeIntegration();
      vi.mocked(repo.findOne).mockResolvedValue(integration);

      const result = await service.findByUserAndMethod('user-456', 'google');

      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-456', method: 'google' })
      );
      expect(result).toEqual(integration);
    });

    it('returns undefined when not found', async () => {
      vi.mocked(repo.findOne).mockResolvedValue(null);

      const result = await service.findByUserAndMethod('user-456', 'github');

      expect(result).toBeUndefined();
    });

    it('normalizes non-Error repository failures before logging and rethrowing', async () => {
      vi.mocked(repo.findOne)
        .mockRejectedValueOnce('lookup failed')
        .mockRejectedValueOnce(new Error('error lookup failed'));

      await expect(
        service.findByUserAndMethod('user-456', 'google')
      ).rejects.toBe('lookup failed');
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'lookup failed' }),
        expect.objectContaining({ error: 'lookup failed' })
      );
      await expect(
        service.findByUserAndMethod('user-456', 'google')
      ).rejects.toThrow('error lookup failed');
    });
  });

  describe('findByProviderSub', () => {
    it('delegates to repo.findOne with provider_sub and method', async () => {
      const integration = makeIntegration();
      vi.mocked(repo.findOne).mockResolvedValue(integration);

      const result = await service.findByProviderSub(
        'google-sub-123',
        'google'
      );

      expect(repo.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          provider_sub: 'google-sub-123',
          method: 'google',
        })
      );
      expect(result).toEqual(integration);
    });
  });

  describe('findByUser', () => {
    it('delegates to repo.findMany with user_id and is_active filter', async () => {
      const integrations = [makeIntegration()];
      vi.mocked(repo.findMany).mockResolvedValue(integrations);

      const result = await service.findByUser('user-456');

      expect(repo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-456', is_active: true }),
        expect.anything()
      );
      expect(result).toEqual(integrations);
    });
  });

  describe('createIntegration', () => {
    it('delegates to repo.create after validating no existing integration', async () => {
      const created = makeIntegration();
      vi.mocked(mockUserService.findById).mockResolvedValue({
        _id: 'user-456',
      });
      vi.mocked(repo.findOne).mockResolvedValue(null); // no existing integration
      vi.mocked(repo.create).mockResolvedValue(created);

      const result = await service.createIntegration('user-456', 'google', {
        sub: 'google-sub-new',
        email: 'user@example.com',
      });

      expect(repo.create).toHaveBeenCalled();
      expect(result).toEqual(created);
    });

    it('throws when user already has integration for method', async () => {
      vi.mocked(mockUserService.findById).mockResolvedValue({
        _id: 'user-456',
      });
      vi.mocked(repo.findOne).mockResolvedValue(makeIntegration()); // existing!

      await expect(
        service.createIntegration('user-456', 'google', {
          sub: 'google-sub-123',
        })
      ).rejects.toThrow(/already has a google integration/);

      expect(repo.create).not.toHaveBeenCalled();
    });

    it('encrypts OAuth tokens before the integration is persisted', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'a'.repeat(64);
      vi.mocked(mockUserService.findById).mockResolvedValue({
        _id: 'user-456',
      });
      vi.mocked(repo.findOne).mockResolvedValue(null);
      vi.mocked(repo.create).mockImplementation(async data =>
        makeIntegration(data as Partial<ISocialIntegration>)
      );

      try {
        await service.createIntegration(
          'user-456',
          'google',
          { sub: 'google-sub-new' },
          {
            access_token: 'access-plain',
            refresh_token: 'refresh-plain',
            id_token: 'id-plain',
            token_type: 'Bearer',
          }
        );

        const persisted = vi.mocked(repo.create).mock.calls[0][0] as any;
        expect(persisted.tokens.access_token).toMatch(/^ENCRYPTED:v1:/);
        expect(persisted.tokens.refresh_token).toMatch(/^ENCRYPTED:v1:/);
        expect(persisted.tokens.id_token).toMatch(/^ENCRYPTED:v1:/);
        expect(ensureDecrypted(persisted.tokens.access_token)).toBe(
          'access-plain'
        );
        expect(ensureDecrypted(persisted.tokens.refresh_token)).toBe(
          'refresh-plain'
        );
        expect(ensureDecrypted(persisted.tokens.id_token)).toBe('id-plain');
        expect(persisted.tokens.token_type).toBe('Bearer');
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }
    });

    it('rejects an empty provider subject before reading user data', async () => {
      await expect(
        service.createIntegration('user-456', 'google', { sub: '   ' })
      ).rejects.toThrow('Provider subject is required');
      expect(mockUserService.findById).not.toHaveBeenCalled();
      expect(repo.create).not.toHaveBeenCalled();
    });
  });

  describe('markAsUsed', () => {
    it('delegates to repo.findById then repo.update with last_used', async () => {
      const integration = makeIntegration();
      const updated = makeIntegration({ last_used: new Date() });
      vi.mocked(repo.findById).mockResolvedValue(integration);
      vi.mocked(repo.update).mockResolvedValue(updated);

      const result = await service.markAsUsed('int-123');

      expect(repo.findById).toHaveBeenCalledWith('int-123');
      expect(repo.update).toHaveBeenCalledWith(
        'int-123',
        expect.objectContaining({ last_used: expect.any(Date) })
      );
      expect(result).toEqual(updated);
    });

    it('throws when integration not found', async () => {
      vi.mocked(repo.findById).mockResolvedValue(null);

      await expect(service.markAsUsed('nonexistent')).rejects.toThrow(
        /Integration not found/
      );
    });
  });

  describe('activate', () => {
    it('delegates to repo.update with is_active: true', async () => {
      const integration = makeIntegration({ is_active: false });
      const activated = makeIntegration({ is_active: true });
      vi.mocked(repo.findById).mockResolvedValue(integration);
      vi.mocked(repo.update).mockResolvedValue(activated);

      const result = await service.activate('int-123');

      expect(repo.update).toHaveBeenCalledWith('int-123', { is_active: true });
      expect(result.is_active).toBe(true);
    });
  });

  describe('deactivate', () => {
    it('delegates to repo.update with is_active: false', async () => {
      const integration = makeIntegration({ is_active: true });
      const deactivated = makeIntegration({ is_active: false });
      vi.mocked(repo.findById).mockResolvedValue(integration);
      vi.mocked(repo.update).mockResolvedValue(deactivated);

      const result = await service.deactivate('int-123');

      expect(repo.update).toHaveBeenCalledWith('int-123', { is_active: false });
      expect(result.is_active).toBe(false);
    });
  });

  describe('deactivateSocialIntegrations', () => {
    it('finds active integrations then updates each to is_active: false', async () => {
      const integrations = [
        makeIntegration({ id: 'int-1' }),
        makeIntegration({ id: 'int-2' }),
      ];
      vi.mocked(repo.findMany).mockResolvedValue(integrations);
      vi.mocked(repo.update).mockResolvedValue(integrations[0]);

      const count = await service.deactivateSocialIntegrations('user-456');

      expect(repo.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-456', is_active: true })
      );
      expect(repo.update).toHaveBeenCalledTimes(2);
      expect(count).toBe(2);
    });

    it('rejects malformed repository rows instead of updating an empty id', async () => {
      vi.mocked(repo.findMany).mockResolvedValue([
        makeIntegration({ id: undefined, _id: undefined }),
      ]);

      await expect(
        service.deactivateSocialIntegrations('user-456')
      ).rejects.toThrow('Integration id is required');
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('date and bulk-operation validation', () => {
    it('rejects invalid date objects before querying integrations', async () => {
      await expect(
        service.getIntegrationsByDateRange(
          new Date('invalid'),
          new Date('2026-01-02T00:00:00.000Z')
        )
      ).rejects.toThrow('valid dates');
      expect(repo.findMany).not.toHaveBeenCalled();
    });

    it.each([Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects a non-finite recent-day window: %s',
      async days => {
        await expect(
          service.getRecentlyUsedIntegrations(days)
        ).resolves.toEqual([]);
        expect(repo.findMany).not.toHaveBeenCalled();
      }
    );

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
      'rejects an invalid recent-result limit: %s',
      async limit => {
        await expect(
          service.getRecentlyUsedIntegrations(7, limit)
        ).resolves.toEqual([]);
        expect(repo.findMany).not.toHaveBeenCalled();
      }
    );

    it('rejects malformed rows during bulk deactivation', async () => {
      vi.mocked(repo.findMany).mockResolvedValue([
        makeIntegration({ id: undefined, _id: undefined }),
      ]);

      await expect(
        service.bulkDeactivateIntegrations({ method: 'google' })
      ).rejects.toThrow('Integration id is required');
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe('getSocialIntegrationCount', () => {
    it('delegates to repo.count with user_id and is_active filter', async () => {
      vi.mocked(repo.count).mockResolvedValue(3);

      const result = await service.getSocialIntegrationCount('user-456');

      expect(repo.count).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 'user-456', is_active: true })
      );
      expect(result).toBe(3);
    });
  });

  describe('getIntegrationStatistics', () => {
    it('delegates count calls to repo', async () => {
      vi.mocked(repo.count).mockResolvedValue(5);

      const stats = await service.getIntegrationStatistics();

      expect(repo.count).toHaveBeenCalled();
      expect(stats.totalIntegrations).toBe(5);
      expect(stats.activeIntegrations).toBe(5);
      expect(stats).toHaveProperty('integrationsByMethod');
    });
  });

  describe('query helpers and failure policies', () => {
    it('returns empty query results when repositories return no collection', async () => {
      vi.mocked(repo.findMany).mockResolvedValue(undefined as any);

      await expect(service.findByUser('user-456')).resolves.toEqual([]);
      await expect(service.findByMethod('google')).resolves.toEqual([]);
      await expect(service.findWithUserData()).resolves.toEqual([]);
      await expect(service.getAllActiveIntegrations()).resolves.toEqual([]);
    });

    it('queries active integrations by method', async () => {
      const integration = makeIntegration();
      vi.mocked(repo.findMany).mockResolvedValue([integration]);

      await expect(service.findByMethod('google')).resolves.toEqual([
        integration,
      ]);
      expect(repo.findMany).toHaveBeenCalledWith({
        method: 'google',
        is_active: true,
      });
    });

    it('supports inactive lookup and contains its repository failure', async () => {
      const integration = makeIntegration({ is_active: false });
      vi.mocked(repo.findOne)
        .mockResolvedValueOnce(integration)
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('inactive lookup failed'));

      await expect(
        service.findByUserAndMethodIncludingInactive('user-456', 'google')
      ).resolves.toBe(integration);
      await expect(
        service.findByUserAndMethodIncludingInactive('user-456', 'github')
      ).resolves.toBeUndefined();
      await expect(
        service.findByUserAndMethodIncludingInactive('user-456', 'facebook')
      ).resolves.toBeUndefined();
      expect(repo.findOne).toHaveBeenNthCalledWith(1, {
        user_id: 'user-456',
        method: 'google',
      });
    });

    it('passes user-data query options and propagates repository failures', async () => {
      const integration = makeIntegration();
      vi.mocked(repo.findMany)
        .mockResolvedValueOnce([integration])
        .mockRejectedValueOnce(new Error('query failed'));
      const filter = { method: 'google' };
      const options = { sort: { last_used: -1 as const }, limit: 2, skip: 1 };

      await expect(service.findWithUserData(filter, options)).resolves.toEqual([
        integration,
      ]);
      expect(repo.findMany).toHaveBeenNthCalledWith(1, filter, options);
      await expect(service.findWithUserData(filter, options)).rejects.toThrow(
        'query failed'
      );
    });

    it('reports integration presence and fails closed on lookup errors', async () => {
      const lookup = vi
        .spyOn(service, 'findByUserAndMethod')
        .mockResolvedValueOnce(makeIntegration())
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('presence failed'));

      await expect(service.hasIntegration('user-456', 'google')).resolves.toBe(
        true
      );
      await expect(service.hasIntegration('user-456', 'github')).resolves.toBe(
        false
      );
      await expect(
        service.hasIntegration('user-456', 'facebook')
      ).resolves.toBe(false);
      expect(lookup).toHaveBeenCalledTimes(3);
    });

    it('queries all active integrations with options and returns [] on failure', async () => {
      const options = { sort: { last_used: -1 as const }, limit: 5, skip: 2 };
      vi.mocked(repo.findMany)
        .mockResolvedValueOnce([makeIntegration()])
        .mockRejectedValueOnce(new Error('admin query failed'));

      await expect(
        service.getAllActiveIntegrations(options)
      ).resolves.toHaveLength(1);
      expect(repo.findMany).toHaveBeenNthCalledWith(
        1,
        { is_active: true },
        options
      );
      await expect(service.getAllActiveIntegrations(options)).resolves.toEqual(
        []
      );
    });

    it('finds by provider username and represents absence as undefined', async () => {
      const integration = makeIntegration();
      vi.mocked(repo.findOne)
        .mockResolvedValueOnce(integration)
        .mockResolvedValueOnce(null)
        .mockRejectedValueOnce(new Error('username query failed'));

      await expect(
        service.findByProviderUsername('testuser', 'google')
      ).resolves.toBe(integration);
      await expect(
        service.findByProviderUsername('missing', 'google')
      ).resolves.toBeUndefined();
      await expect(
        service.findByProviderUsername('broken', 'google')
      ).rejects.toThrow('username query failed');
      expect(repo.findOne).toHaveBeenNthCalledWith(1, {
        provider_username: 'testuser',
        method: 'google',
        is_active: true,
      });
    });

    it('propagates failures for strict query helpers', async () => {
      vi.mocked(repo.findOne).mockRejectedValue(new Error('find-one failed'));
      await expect(service.findByProviderSub('sub', 'google')).rejects.toThrow(
        'find-one failed'
      );

      vi.mocked(repo.findMany).mockRejectedValue(new Error('find-many failed'));
      await expect(service.findByUser('user-456')).rejects.toThrow(
        'find-many failed'
      );
      await expect(service.findByMethod('google')).rejects.toThrow(
        'find-many failed'
      );
    });

    it('returns safe count and statistics fallbacks on repository failures', async () => {
      vi.mocked(repo.count).mockRejectedValue(new Error('count failed'));

      await expect(service.getSocialIntegrationCount('user-456')).resolves.toBe(
        0
      );
      await expect(service.getIntegrationStatistics()).resolves.toEqual({
        totalIntegrations: 0,
        activeIntegrations: 0,
        integrationsByMethod: {},
        recentIntegrations: 0,
      });
    });
  });

  describe('creation conflicts and compatibility wrappers', () => {
    it('rejects missing users and provider accounts linked elsewhere', async () => {
      vi.mocked(mockUserService.findById)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ _id: 'user-456' });

      await expect(
        service.createIntegration('missing', 'google', { sub: 'sub-1' })
      ).rejects.toThrow('User not found');

      vi.mocked(repo.findOne)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeIntegration({ user_id: 'other-user' }));
      await expect(
        service.createIntegration('user-456', 'google', { sub: 'sub-1' })
      ).rejects.toThrow('already linked to another user');
      expect(repo.create).not.toHaveBeenCalled();
    });

    it('delegates compatibility method names to the canonical operations', async () => {
      const integration = makeIntegration();
      const tokens = { access_token: 'access' };
      const providerData = { name: 'Updated' };
      const updateTokens = vi
        .spyOn(service, 'updateTokens')
        .mockResolvedValue(integration);
      const updateProviderData = vi
        .spyOn(service, 'updateProviderData')
        .mockResolvedValue(integration);
      const markAsUsed = vi
        .spyOn(service, 'markAsUsed')
        .mockResolvedValue(integration);
      const deactivate = vi
        .spyOn(service, 'deactivate')
        .mockResolvedValue(integration);
      const activate = vi
        .spyOn(service, 'activate')
        .mockResolvedValue(integration);

      await expect(
        service.updateIntegrationTokens('int-123', tokens)
      ).resolves.toBe(integration);
      await expect(
        service.updateIntegrationProviderData('int-123', providerData)
      ).resolves.toBe(integration);
      await expect(service.markIntegrationAsUsed('int-123')).resolves.toBe(
        integration
      );
      await expect(service.deactivateIntegration('int-123')).resolves.toBe(
        integration
      );
      await expect(service.activateIntegration('int-123')).resolves.toBe(
        integration
      );

      expect(updateTokens).toHaveBeenCalledWith('int-123', tokens);
      expect(updateProviderData).toHaveBeenCalledWith('int-123', providerData);
      expect(markAsUsed).toHaveBeenCalledWith('int-123');
      expect(deactivate).toHaveBeenCalledWith('int-123');
      expect(activate).toHaveBeenCalledWith('int-123');
    });
  });

  describe('statistics and time-window queries', () => {
    it('returns distinct totals and only non-zero per-method counts', async () => {
      vi.mocked(repo.count).mockImplementation(async filter => {
        const effectiveFilter = filter ?? {};
        if ('method' in effectiveFilter)
          return effectiveFilter.method === 'google' ? 2 : 0;
        if ('created_at' in effectiveFilter) return 3;
        if (effectiveFilter.is_active === true) return 8;
        return 10;
      });

      await expect(service.getIntegrationStatistics()).resolves.toEqual({
        totalIntegrations: 10,
        activeIntegrations: 8,
        integrationsByMethod: { google: 2 },
        recentIntegrations: 3,
      });
      expect(repo.count).toHaveBeenCalledTimes(13);
    });

    it('keeps top-level statistics when per-method counts fail', async () => {
      vi.mocked(repo.count)
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(3)
        .mockRejectedValueOnce(new Error('method count failed'));

      await expect(service.getIntegrationStatistics()).resolves.toEqual({
        totalIntegrations: 10,
        activeIntegrations: 8,
        integrationsByMethod: {},
        recentIntegrations: 3,
      });
    });

    it('queries valid date ranges with and without a method', async () => {
      const start = new Date('2026-01-01T00:00:00.000Z');
      const end = new Date('2026-01-02T00:00:00.000Z');
      vi.mocked(repo.findMany)
        .mockResolvedValueOnce([makeIntegration()])
        .mockResolvedValueOnce(undefined as any);

      await expect(
        service.getIntegrationsByDateRange(start, end, 'google')
      ).resolves.toHaveLength(1);
      expect(repo.findMany).toHaveBeenNthCalledWith(
        1,
        {
          is_active: true,
          created_at: { $gte: start, $lte: end },
          method: 'google',
        },
        { sort: { created_at: -1 } }
      );
      await expect(
        service.getIntegrationsByDateRange(start, end)
      ).resolves.toEqual([]);
    });

    it('rejects missing, reversed, and equal date ranges and propagates query errors', async () => {
      const valid = new Date('2026-01-02T00:00:00.000Z');
      await expect(
        service.getIntegrationsByDateRange(null as any, valid)
      ).rejects.toThrow('valid dates');
      await expect(
        service.getIntegrationsByDateRange(valid, new Date('2026-01-01'))
      ).rejects.toThrow('before end date');
      await expect(
        service.getIntegrationsByDateRange(valid, new Date(valid))
      ).rejects.toThrow('before end date');

      vi.mocked(repo.findMany).mockRejectedValue(new Error('range failed'));
      await expect(
        service.getIntegrationsByDateRange(
          new Date('2026-01-01'),
          new Date('2026-01-02')
        )
      ).rejects.toThrow('range failed');
    });

    it('queries recently used integrations with defaults and custom values', async () => {
      const now = new Date('2026-08-02T00:00:00.000Z').getTime();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      vi.mocked(repo.findMany)
        .mockResolvedValueOnce([makeIntegration()])
        .mockResolvedValueOnce(undefined as any)
        .mockRejectedValueOnce(new Error('recent failed'));

      await expect(service.getRecentlyUsedIntegrations()).resolves.toHaveLength(
        1
      );
      expect(repo.findMany).toHaveBeenNthCalledWith(
        1,
        {
          is_active: true,
          last_used: { $gte: new Date(now - 7 * 24 * 60 * 60 * 1000) },
        },
        { sort: { last_used: -1 }, limit: 10 }
      );
      await expect(service.getRecentlyUsedIntegrations(2, 3)).resolves.toEqual(
        []
      );
      await expect(service.getRecentlyUsedIntegrations(2, 3)).resolves.toEqual(
        []
      );
    });
  });

  describe('bulk mutation, token, and provider updates', () => {
    it('builds every bulk criterion and supports repository _id fallback', async () => {
      const createdBefore = new Date('2026-01-01T00:00:00.000Z');
      vi.mocked(repo.findMany).mockResolvedValue([
        makeIntegration({ id: undefined, _id: 'mongo-id' }),
      ]);
      vi.mocked(repo.update).mockResolvedValue(makeIntegration());

      await expect(
        service.bulkDeactivateIntegrations({
          method: 'google',
          userId: 'user-456',
          providerSub: 'sub',
          createdBefore,
        })
      ).resolves.toBe(1);
      expect(repo.findMany).toHaveBeenCalledWith({
        is_active: true,
        method: 'google',
        user_id: 'user-456',
        provider_sub: 'sub',
        created_at: { $lt: createdBefore },
      });
      expect(repo.update).toHaveBeenCalledWith('mongo-id', {
        is_active: false,
      });
    });

    it('bulk-deactivates all active integrations with empty criteria and propagates failures', async () => {
      vi.mocked(repo.findMany)
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('bulk failed'));

      await expect(service.bulkDeactivateIntegrations({})).resolves.toBe(0);
      expect(repo.findMany).toHaveBeenNthCalledWith(1, { is_active: true });
      await expect(service.bulkDeactivateIntegrations({})).rejects.toThrow(
        'bulk failed'
      );
    });

    it('encrypts and merges token updates while preserving empty optional tokens', async () => {
      const originalKey = process.env.ENCRYPTION_KEY;
      process.env.ENCRYPTION_KEY = 'b'.repeat(64);
      const integration = makeIntegration({
        tokens: { access_token: 'old', scope: 'openid' },
      });
      vi.mocked(repo.findById).mockResolvedValue(integration);
      vi.mocked(repo.update).mockImplementation(async (_id, data) =>
        makeIntegration(data as Partial<ISocialIntegration>)
      );

      try {
        await service.updateTokens('int-123', {
          access_token: '',
          refresh_token: undefined,
          id_token: 'new-id-token',
          token_type: 'Bearer',
        });
        await service.updateTokens('int-123', {
          access_token: 'new-access-token',
          id_token: undefined,
        });
      } finally {
        if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
        else process.env.ENCRYPTION_KEY = originalKey;
      }

      const update = vi.mocked(repo.update).mock.calls[0][1] as any;
      expect(update.tokens).toMatchObject({
        access_token: '',
        refresh_token: undefined,
        scope: 'openid',
        token_type: 'Bearer',
      });
      expect(update.tokens.id_token).toMatch(/^ENCRYPTED:v1:/);
      expect(update.last_used).toBeInstanceOf(Date);
    });

    it('rejects token and provider updates for missing integrations', async () => {
      vi.mocked(repo.findById).mockResolvedValue(null);
      await expect(
        service.updateTokens('missing', { access_token: 'token' })
      ).rejects.toThrow('Integration not found');
      await expect(
        service.updateProviderData('missing', { name: 'Name' })
      ).rejects.toThrow('Integration not found');
    });

    it('merges provider data and stamps last use', async () => {
      const integration = makeIntegration({
        provider_data: { sub: 'sub', email: 'old@example.com' },
      });
      vi.mocked(repo.findById).mockResolvedValue(integration);
      vi.mocked(repo.update).mockImplementation(async (_id, data) =>
        makeIntegration(data as Partial<ISocialIntegration>)
      );

      await service.updateProviderData('int-123', {
        email: 'new@example.com',
        name: 'New Name',
      });

      expect(repo.update).toHaveBeenCalledWith('int-123', {
        provider_data: {
          sub: 'sub',
          email: 'new@example.com',
          name: 'New Name',
        },
        last_used: expect.any(Date),
      });
    });

    it.each(['activate', 'deactivate'] as const)(
      '%s rejects a missing integration',
      async operation => {
        vi.mocked(repo.findById).mockResolvedValue(null);
        await expect(service[operation]('missing')).rejects.toThrow(
          'Integration not found'
        );
      }
    );
  });

  describe('token refresh decisions', () => {
    it('returns null for missing, non-expiring, and still-valid integrations', async () => {
      const now = new Date('2026-08-02T00:00:00.000Z').getTime();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      vi.mocked(repo.findById)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(makeIntegration({ tokens: undefined }))
        .mockResolvedValueOnce(
          makeIntegration({
            tokens: {
              access_token: 'token',
              expires_at: new Date(now + 61_000),
            },
          })
        );

      await expect(
        service.checkNeedsTokenRefresh('missing')
      ).resolves.toBeNull();
      await expect(
        service.checkNeedsTokenRefresh('no-expiry')
      ).resolves.toBeNull();
      await expect(service.checkNeedsTokenRefresh('valid')).resolves.toBeNull();
    });

    it('requires an expired integration to have a refresh token', async () => {
      const now = new Date('2026-08-02T00:00:00.000Z').getTime();
      vi.spyOn(Date, 'now').mockReturnValue(now);
      const withoutRefresh = makeIntegration({
        tokens: { access_token: 'token', expires_at: new Date(now) },
      });
      const withRefresh = makeIntegration({
        tokens: {
          access_token: 'token',
          refresh_token: 'refresh',
          expires_at: new Date(now),
        },
      });
      vi.mocked(repo.findById)
        .mockResolvedValueOnce(withoutRefresh)
        .mockResolvedValueOnce(withRefresh)
        .mockRejectedValueOnce(new Error('refresh check failed'));

      await expect(
        service.checkNeedsTokenRefresh('no-refresh')
      ).resolves.toBeNull();
      await expect(service.checkNeedsTokenRefresh('expired')).resolves.toBe(
        withRefresh
      );
      await expect(
        service.checkNeedsTokenRefresh('broken')
      ).resolves.toBeNull();
    });

    it('skips refresh, handles empty responses, and persists successful refreshes', async () => {
      const integration = makeIntegration();
      const newTokens = { access_token: 'new-access' };
      const check = vi
        .spyOn(service, 'checkNeedsTokenRefresh')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(integration)
        .mockResolvedValueOnce(integration);
      const refresh = vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(newTokens);
      const update = vi
        .spyOn(service, 'updateTokens')
        .mockResolvedValue(integration);

      await expect(
        service.refreshTokenIfNeeded('not-needed', refresh)
      ).resolves.toBeNull();
      await expect(
        service.refreshTokenIfNeeded('empty', refresh)
      ).resolves.toBeNull();
      await expect(
        service.refreshTokenIfNeeded('success', refresh)
      ).resolves.toBe(newTokens);
      expect(check).toHaveBeenCalledTimes(3);
      expect(update).toHaveBeenCalledWith('success', newTokens);
    });

    it('contains refresh callback and token persistence failures', async () => {
      vi.spyOn(service, 'checkNeedsTokenRefresh').mockResolvedValue(
        makeIntegration()
      );
      const refreshFailure = vi
        .fn()
        .mockRejectedValue(new Error('refresh failed'));
      await expect(
        service.refreshTokenIfNeeded('int-123', refreshFailure)
      ).resolves.toBeNull();

      vi.spyOn(service, 'updateTokens').mockRejectedValue(
        new Error('persist failed')
      );
      await expect(
        service.refreshTokenIfNeeded('int-123', async () => ({
          access_token: 'new',
        }))
      ).resolves.toBeNull();
    });
  });
});
