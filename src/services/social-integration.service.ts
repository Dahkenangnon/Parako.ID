import {
  type ISocialIntegration,
  type IntegrationMethod,
  type ProviderUserData,
  type TokenData,
} from '../types/social-integration.js';
import { injectable, inject } from 'inversify';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { ISocialIntegrationService } from '../di/interfaces/social-integration-service.interface.js';
import type { ISocialIntegrationRepository } from '../db/repositories/interfaces/social-integration.repository.js';
import { TYPES } from '../di/types.js';
import { ensureEncrypted } from '../utils/encryption.js';

const INTEGRATION_METHODS: IntegrationMethod[] = [
  'local',
  'oauth',
  'ldap',
  'google',
  'github',
  'facebook',
  'linkedin',
  'twitter',
  'microsoft',
  'apple',
];

/**
 * Service for user integration-related database operations
 * Provides integration-specific methods beyond the standard CRUD operations
 */
@injectable()
export class SocialIntegrationService implements ISocialIntegrationService {
  constructor(
    @inject(TYPES.Logger) protected readonly logger: ILogger,
    @inject(TYPES.SocialIntegrationRepository)
    private readonly socialIntegrationRepo: ISocialIntegrationRepository,
    @inject(TYPES.UserService) private readonly userService: IUserService
  ) {}

  public async findById(id: string): Promise<ISocialIntegration | null> {
    return this.socialIntegrationRepo.findById(id);
  }

  /**
   * Find integration by user ID and method
   */
  public async findByUserAndMethod(
    userId: string,
    method: IntegrationMethod
  ): Promise<ISocialIntegration | undefined> {
    try {
      const integration = await this.socialIntegrationRepo.findOne({
        user_id: userId,
        method,
        is_active: true,
      });

      return integration || undefined;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_integration_by_user_and_method',
        userId,
        method,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Find integration by provider sub and method
   */
  public async findByProviderSub(
    providerSub: string,
    method: IntegrationMethod
  ): Promise<ISocialIntegration | undefined> {
    try {
      const integration = await this.socialIntegrationRepo.findOne({
        provider_sub: providerSub,
        method,
        is_active: true,
      });

      return integration || undefined;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_integration_by_provider_sub',
        providerSub,
        method,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Find all integrations for a user
   */
  public async findByUser(userId: string): Promise<ISocialIntegration[]> {
    try {
      const integrations = await this.socialIntegrationRepo.findMany(
        { user_id: userId, is_active: true },
        { sort: { last_used: -1 } }
      );

      return integrations || [];
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_integrations_by_user',
        userId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Find integrations by method
   */
  public async findByMethod(
    method: IntegrationMethod
  ): Promise<ISocialIntegration[]> {
    try {
      const integrations = await this.socialIntegrationRepo.findMany({
        method,
        is_active: true,
      });

      return integrations || [];
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_integrations_by_method',
        method,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Create a new integration for a user
   */
  public async createIntegration(
    userId: string,
    method: IntegrationMethod,
    providerData: ProviderUserData,
    tokens?: TokenData
  ): Promise<ISocialIntegration> {
    try {
      const user = await this.userService.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const existingIntegration = await this.findByUserAndMethod(
        userId,
        method
      );
      if (existingIntegration) {
        throw new Error(`User already has a ${method} integration`);
      }

      const existingByProvider = await this.findByProviderSub(
        providerData.sub,
        method
      );
      if (existingByProvider) {
        throw new Error(
          `This ${method} account is already linked to another user`
        );
      }

      const integrationData: Partial<ISocialIntegration> = {
        user_id: userId,
        method,
        provider_sub: providerData.sub,
        provider_username: providerData.provider_username,
        provider_data: providerData,
        tokens,
        is_active: true,
        last_used: new Date(),
        metadata: {
          created_by: 'user',
          linked_at: new Date(),
        },
      };

      const integration = await this.socialIntegrationRepo.create(
        integrationData as any
      );

      this.logger.info('User integration created', {
        userId,
        method,
        providerSub: providerData.sub,
        integrationId: integration._id,
      });

      return integration;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_creating_user_integration',
        userId,
        method,
        providerSub: providerData.sub,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Update integration tokens
   */
  public async updateIntegrationTokens(
    integrationId: string,
    tokens: TokenData
  ): Promise<ISocialIntegration> {
    return this.updateTokens(integrationId, tokens);
  }

  /**
   * Update integration provider data
   */
  public async updateIntegrationProviderData(
    integrationId: string,
    providerData: Partial<ProviderUserData>
  ): Promise<ISocialIntegration> {
    return this.updateProviderData(integrationId, providerData);
  }

  /**
   * Mark integration as used
   */
  public async markIntegrationAsUsed(
    integrationId: string
  ): Promise<ISocialIntegration> {
    return this.markAsUsed(integrationId);
  }

  /**
   * Deactivate integration
   */
  public async deactivateIntegration(
    integrationId: string
  ): Promise<ISocialIntegration> {
    return this.deactivate(integrationId);
  }

  /**
   * Activate integration
   */
  public async activateIntegration(
    integrationId: string
  ): Promise<ISocialIntegration> {
    return this.activate(integrationId);
  }

  /**
   * Find integration by user ID and method including inactive ones
   */
  public async findByUserAndMethodIncludingInactive(
    userId: string,
    method: IntegrationMethod
  ): Promise<ISocialIntegration | undefined> {
    try {
      const integration = await this.socialIntegrationRepo.findOne({
        user_id: userId,
        method,
      });

      return integration || undefined;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_user_integration_including_inactive',
        userId,
        method,
        error: err.message,
      });
      return undefined;
    }
  }

  /**
   * Deactivate all integrations for a user
   */
  public async deactivateSocialIntegrations(userId: string): Promise<number> {
    try {
      const active = await this.socialIntegrationRepo.findMany({
        user_id: userId,
        is_active: true,
      });

      await Promise.all(
        active.map(integration =>
          this.socialIntegrationRepo.update(
            integration.id || integration._id || '',
            {
              is_active: false,
            } as any
          )
        )
      );

      this.logger.info('User integrations deactivated', {
        userId,
        deactivatedCount: active.length,
      });

      return active.length;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_deactivating_user_integrations',
        userId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Get integration statistics
   */
  public async getIntegrationStatistics(): Promise<{
    totalIntegrations: number;
    activeIntegrations: number;
    integrationsByMethod: Record<string, number>;
    recentIntegrations: number;
  }> {
    try {
      const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [totalIntegrations, activeIntegrations, recentIntegrations] =
        await Promise.all([
          this.socialIntegrationRepo.count({}),
          this.socialIntegrationRepo.count({ is_active: true }),
          this.socialIntegrationRepo.count({
            is_active: true,
            created_at: { $gte: cutoff },
          }),
        ]);

      const integrationsByMethod = await this.getIntegrationsByMethod();

      return {
        totalIntegrations,
        activeIntegrations,
        integrationsByMethod,
        recentIntegrations,
      };
    } catch (error) {
      this.logger.error('Error getting integration statistics', {
        error: (error as Error).message,
      });
      return {
        totalIntegrations: 0,
        activeIntegrations: 0,
        integrationsByMethod: {},
        recentIntegrations: 0,
      };
    }
  }

  /**
   * Find integrations with user data
   * Note: populate is not available in the repository abstraction;
   * returns integrations without embedded user data.
   */
  public async findWithUserData(
    filter: Record<string, unknown> = {},
    options: {
      sort?: Record<string, 1 | -1>;
      limit?: number;
      skip?: number;
    } = {}
  ): Promise<ISocialIntegration[]> {
    try {
      const integrations = await this.socialIntegrationRepo.findMany(filter, {
        sort: options.sort,
        limit: options.limit,
        skip: options.skip,
      });
      return integrations || [];
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_integrations_with_user_data',
        filter,
        options,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Check if user has integration for specific method
   */
  public async hasIntegration(
    userId: string,
    method: IntegrationMethod
  ): Promise<boolean> {
    try {
      const integration = await this.findByUserAndMethod(userId, method);
      return !!integration;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_checking_user_integration',
        userId,
        method,
        error: err.message,
      });
      return false;
    }
  }

  /**
   * Get integration count for a user
   */
  public async getSocialIntegrationCount(userId: string): Promise<number> {
    try {
      return await this.socialIntegrationRepo.count({
        user_id: userId,
        is_active: true,
      });
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_user_integration_count',
        userId,
        error: err.message,
      });
      return 0;
    }
  }

  /**
   * Get all active integrations (for admin purposes)
   */
  public async getAllActiveIntegrations(
    options: {
      sort?: Record<string, 1 | -1>;
      limit?: number;
      skip?: number;
    } = {}
  ): Promise<ISocialIntegration[]> {
    try {
      const integrations = await this.socialIntegrationRepo.findMany(
        { is_active: true },
        {
          sort: options.sort,
          limit: options.limit,
          skip: options.skip,
        }
      );
      return integrations || [];
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_all_active_integrations',
        options,
        error: err.message,
      });
      return [];
    }
  }

  /**
   * Find integrations by provider username
   */
  public async findByProviderUsername(
    providerUsername: string,
    method: IntegrationMethod
  ): Promise<ISocialIntegration | undefined> {
    try {
      const integration = await this.socialIntegrationRepo.findOne({
        provider_username: providerUsername,
        method,
        is_active: true,
      });

      return integration || undefined;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_finding_integration_by_provider_username',
        providerUsername,
        method,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Get integrations created within a date range
   */
  public async getIntegrationsByDateRange(
    startDate: Date,
    endDate: Date,
    method?: IntegrationMethod
  ): Promise<ISocialIntegration[]> {
    try {
      if (!startDate || !endDate) {
        throw new Error('Start date and end date are required');
      }

      if (startDate >= endDate) {
        throw new Error('Start date must be before end date');
      }

      const filter: Record<string, unknown> = {
        is_active: true,
        created_at: {
          $gte: startDate,
          $lte: endDate,
        },
      };

      if (method) {
        filter.method = method;
      }

      const integrations = await this.socialIntegrationRepo.findMany(filter, {
        sort: { created_at: -1 },
      });

      return integrations || [];
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_integrations_by_date_range',
        startDate,
        endDate,
        method,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Get recently used integrations
   */
  public async getRecentlyUsedIntegrations(
    days: number = 7,
    limit: number = 10
  ): Promise<ISocialIntegration[]> {
    try {
      if (days <= 0) {
        throw new Error('Days must be greater than 0');
      }

      const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const integrations = await this.socialIntegrationRepo.findMany(
        {
          is_active: true,
          last_used: { $gte: cutoffDate },
        },
        {
          sort: { last_used: -1 },
          limit,
        }
      );

      return integrations || [];
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_getting_recently_used_integrations',
        days,
        limit,
        error: err.message,
      });
      return [];
    }
  }

  /**
   * Bulk deactivate integrations by criteria
   */
  public async bulkDeactivateIntegrations(criteria: {
    method?: IntegrationMethod;
    userId?: string;
    providerSub?: string;
    createdBefore?: Date;
  }): Promise<number> {
    try {
      const filter: Record<string, unknown> = { is_active: true };

      if (criteria.method) {
        filter.method = criteria.method;
      }

      if (criteria.userId) {
        filter.user_id = criteria.userId;
      }

      if (criteria.providerSub) {
        filter.provider_sub = criteria.providerSub;
      }

      if (criteria.createdBefore) {
        filter.created_at = { $lt: criteria.createdBefore };
      }

      const integrations = await this.socialIntegrationRepo.findMany(filter);
      await Promise.all(
        integrations.map(integration =>
          this.socialIntegrationRepo.update(
            integration.id || integration._id || '',
            {
              is_active: false,
            } as any
          )
        )
      );

      this.logger.info('Bulk deactivated integrations', {
        criteria,
        deactivatedCount: integrations.length,
      });

      return integrations.length;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_bulk_deactivating_integrations',
        criteria,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Mark integration as used
   */
  public async markAsUsed(integrationId: string): Promise<ISocialIntegration> {
    try {
      const integration =
        await this.socialIntegrationRepo.findById(integrationId);
      if (!integration) {
        throw new Error('Integration not found');
      }

      const updated = await this.socialIntegrationRepo.update(integrationId, {
        last_used: new Date(),
      } as any);

      this.logger.info('Integration marked as used', {
        integrationId,
        method: integration.method,
        userId: integration.user_id,
      });

      return updated;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_marking_integration_as_used',
        integrationId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Activate integration
   */
  public async activate(integrationId: string): Promise<ISocialIntegration> {
    try {
      const integration =
        await this.socialIntegrationRepo.findById(integrationId);
      if (!integration) {
        throw new Error('Integration not found');
      }

      const updated = await this.socialIntegrationRepo.update(integrationId, {
        is_active: true,
      } as any);

      this.logger.info('Integration activated', {
        integrationId,
        method: integration.method,
        userId: integration.user_id,
      });

      return updated;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_activating_integration',
        integrationId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Deactivate integration
   */
  public async deactivate(integrationId: string): Promise<ISocialIntegration> {
    try {
      const integration =
        await this.socialIntegrationRepo.findById(integrationId);
      if (!integration) {
        throw new Error('Integration not found');
      }

      const updated = await this.socialIntegrationRepo.update(integrationId, {
        is_active: false,
      } as any);

      this.logger.info('Integration deactivated', {
        integrationId,
        method: integration.method,
        userId: integration.user_id,
      });

      return updated;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_deactivating_integration',
        integrationId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Update tokens
   * Tokens are encrypted at rest for security
   */
  public async updateTokens(
    integrationId: string,
    tokens: TokenData
  ): Promise<ISocialIntegration> {
    try {
      const integration =
        await this.socialIntegrationRepo.findById(integrationId);
      if (!integration) {
        throw new Error('Integration not found');
      }

      const encryptedTokens: TokenData = {
        ...tokens,
        access_token: tokens.access_token
          ? ensureEncrypted(tokens.access_token)
          : tokens.access_token,
        refresh_token: tokens.refresh_token
          ? ensureEncrypted(tokens.refresh_token)
          : tokens.refresh_token,
        id_token: tokens.id_token
          ? ensureEncrypted(tokens.id_token)
          : tokens.id_token,
      };

      const updated = await this.socialIntegrationRepo.update(integrationId, {
        tokens: { ...integration.tokens, ...encryptedTokens },
        last_used: new Date(),
      } as any);

      this.logger.info('Integration tokens updated', {
        integrationId,
        method: integration.method,
        userId: integration.user_id,
      });

      return updated;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_updating_integration_tokens',
        integrationId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Update provider data
   */
  public async updateProviderData(
    integrationId: string,
    data: Partial<ProviderUserData>
  ): Promise<ISocialIntegration> {
    try {
      const integration =
        await this.socialIntegrationRepo.findById(integrationId);
      if (!integration) {
        throw new Error('Integration not found');
      }

      const updated = await this.socialIntegrationRepo.update(integrationId, {
        provider_data: { ...integration.provider_data, ...data },
        last_used: new Date(),
      } as any);

      this.logger.info('Integration provider data updated', {
        integrationId,
        method: integration.method,
        userId: integration.user_id,
      });

      return updated;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_updating_integration_provider_data',
        integrationId,
        error: err.message,
      });
      throw error;
    }
  }

  /**
   * Check if an integration needs token refresh
   */
  public async checkNeedsTokenRefresh(
    integrationId: string
  ): Promise<ISocialIntegration | null> {
    try {
      const integration =
        await this.socialIntegrationRepo.findById(integrationId);
      if (!integration) {
        return null;
      }

      const expiresAt = integration.tokens?.expires_at;
      if (!expiresAt) {
        return null; // No expiration info, assume valid
      }
      const bufferMs = 60 * 1000; // 60 second buffer
      if (new Date(expiresAt).getTime() > Date.now() + bufferMs) {
        return null; // Token still valid
      }

      if (!integration.tokens?.refresh_token) {
        this.logger.debug('Integration has no refresh token', {
          integrationId,
          method: integration.method,
        });
        return null;
      }

      return integration;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_checking_token_refresh_needed',
        integrationId,
        error: err.message,
      });
      return null;
    }
  }

  /**
   * Refresh tokens if needed using a provided refresh function
   */
  public async refreshTokenIfNeeded(
    integrationId: string,
    refreshFn: (integration: ISocialIntegration) => Promise<TokenData | null>
  ): Promise<TokenData | null> {
    try {
      const integration = await this.checkNeedsTokenRefresh(integrationId);
      if (!integration) {
        return null; // No refresh needed
      }

      this.logger.info('Refreshing expired token', {
        integrationId,
        method: integration.method,
        userId: integration.user_id,
      });

      const newTokens = await refreshFn(integration);
      if (!newTokens) {
        this.logger.warn('Token refresh returned no tokens', {
          integrationId,
          method: integration.method,
        });
        return null;
      }

      await this.updateTokens(integrationId, newTokens);

      this.logger.info('Token refreshed successfully', {
        integrationId,
        method: integration.method,
        userId: integration.user_id,
      });

      return newTokens;
    } catch (error) {
      const err = error as Error;
      this.logger.error(err, {
        context: 'error_refreshing_token',
        integrationId,
        error: err.message,
      });
      return null;
    }
  }

  /**
   * Get integrations count by method (using individual counts)
   */
  private async getIntegrationsByMethod(): Promise<Record<string, number>> {
    try {
      const counts = await Promise.all(
        INTEGRATION_METHODS.map(async method => {
          const count = await this.socialIntegrationRepo.count({
            method,
            is_active: true,
          });
          return [method, count] as const;
        })
      );
      return Object.fromEntries(counts.filter(([, count]) => count > 0));
    } catch (error) {
      this.logger.error('Error getting integrations by method', {
        error: (error as Error).message,
      });
      return {};
    }
  }
}
