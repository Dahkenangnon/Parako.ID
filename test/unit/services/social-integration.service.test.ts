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

// ── Stubs ─────────────────────────────────────────────────────────────────────

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

// ── Mock ISocialIntegrationRepository ─────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SocialIntegrationService — ISocialIntegrationRepository delegation', () => {
  let repo: ISocialIntegrationRepository;
  let service: SocialIntegrationService;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = makeMockRepo();
    service = makeService(repo);
  });

  // ── findById ──────────────────────────────────────────────────────────────

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

  // ── findByUserAndMethod ───────────────────────────────────────────────────

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
  });

  // ── findByProviderSub ─────────────────────────────────────────────────────

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

  // ── findByUser ────────────────────────────────────────────────────────────

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

  // ── createIntegration ─────────────────────────────────────────────────────

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
  });

  // ── markAsUsed ────────────────────────────────────────────────────────────

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

  // ── activate / deactivate ─────────────────────────────────────────────────

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

  // ── deactivateSocialIntegrations ──────────────────────────────────────────

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
  });

  // ── getSocialIntegrationCount ─────────────────────────────────────────────

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

  // ── getIntegrationStatistics ──────────────────────────────────────────────

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
});
