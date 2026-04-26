import {
  type ISocialIntegration,
  type IntegrationMethod,
  type ProviderUserData,
  type TokenData,
} from '../../types/social-integration.js';

/**
 * Interface for SocialIntegrationService - handles social integration operations
 */
export interface ISocialIntegrationService {
  findById(id: string): Promise<ISocialIntegration | null>;

  findByUserAndMethod(
    userId: string,
    method: IntegrationMethod
  ): Promise<ISocialIntegration | undefined>;

  findByProviderSub(
    providerSub: string,
    method: IntegrationMethod
  ): Promise<ISocialIntegration | undefined>;

  findByUser(userId: string): Promise<ISocialIntegration[]>;

  findByMethod(method: IntegrationMethod): Promise<ISocialIntegration[]>;

  createIntegration(
    userId: string,
    method: IntegrationMethod,
    providerData: ProviderUserData,
    tokens?: TokenData
  ): Promise<ISocialIntegration>;

  updateIntegrationTokens(
    integrationId: string,
    tokens: TokenData
  ): Promise<ISocialIntegration>;

  updateIntegrationProviderData(
    integrationId: string,
    providerData: Partial<ProviderUserData>
  ): Promise<ISocialIntegration>;

  markIntegrationAsUsed(integrationId: string): Promise<ISocialIntegration>;

  deactivateIntegration(integrationId: string): Promise<ISocialIntegration>;

  activateIntegration(integrationId: string): Promise<ISocialIntegration>;

  findByUserAndMethodIncludingInactive(
    userId: string,
    method: IntegrationMethod
  ): Promise<ISocialIntegration | undefined>;

  deactivateSocialIntegrations(userId: string): Promise<number>;

  getIntegrationStatistics(): Promise<{
    totalIntegrations: number;
    activeIntegrations: number;
    integrationsByMethod: Record<string, number>;
    recentIntegrations: number;
  }>;

  findWithUserData(
    filter?: Record<string, unknown>,
    options?: {
      sort?: Record<string, 1 | -1>;
      limit?: number;
      skip?: number;
    }
  ): Promise<ISocialIntegration[]>;

  hasIntegration(userId: string, method: IntegrationMethod): Promise<boolean>;

  getSocialIntegrationCount(userId: string): Promise<number>;

  getAllActiveIntegrations(options?: {
    sort?: Record<string, 1 | -1>;
    limit?: number;
    skip?: number;
  }): Promise<ISocialIntegration[]>;

  findByProviderUsername(
    providerUsername: string,
    method: IntegrationMethod
  ): Promise<ISocialIntegration | undefined>;

  getIntegrationsByDateRange(
    startDate: Date,
    endDate: Date,
    method?: IntegrationMethod
  ): Promise<ISocialIntegration[]>;

  getRecentlyUsedIntegrations(
    days?: number,
    limit?: number
  ): Promise<ISocialIntegration[]>;

  // Bulk deactivate integrations by criteria
  bulkDeactivateIntegrations(criteria: {
    method?: IntegrationMethod;
    userId?: string;
    providerSub?: string;
    createdBefore?: Date;
  }): Promise<number>;

  markAsUsed(integrationId: string): Promise<ISocialIntegration>;

  activate(integrationId: string): Promise<ISocialIntegration>;

  deactivate(integrationId: string): Promise<ISocialIntegration>;

  updateTokens(
    integrationId: string,
    tokens: TokenData
  ): Promise<ISocialIntegration>;

  updateProviderData(
    integrationId: string,
    data: Partial<ProviderUserData>
  ): Promise<ISocialIntegration>;

  checkNeedsTokenRefresh(
    integrationId: string
  ): Promise<ISocialIntegration | null>;

  refreshTokenIfNeeded(
    integrationId: string,
    refreshFn: (integration: ISocialIntegration) => Promise<TokenData | null>
  ): Promise<TokenData | null>;
}
