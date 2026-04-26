import { createAccountFactory } from './specs/account.js';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IUserService } from '../di/interfaces/user-service.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IClientRegistryManager } from '../di/interfaces/client-registry-manager.interface.js';
import type { ISessionManager } from '../di/interfaces/session-manager.interface.js';
import type { IAuthService } from '../di/interfaces/auth-service.interface.js';
import type { IFileSystemUtils } from '../di/interfaces/file-system-utils.interface.js';
import type { IViewResolver } from '../di/interfaces/view-resolver.interface.js';
import type { IOIDCClientMerger } from '../di/interfaces/oidc-client-merger.interface.js';
import type { IOIDCAdapterBridge } from '../di/interfaces/oidc-adapter-bridge.interface.js';
import AcceptQueryParamAccessTokens from './specs/accept-query-param-access-token.js';
import AcrValues from './specs/acr-value.js';
import AllowOmittingSingleRegisteredRedirectUri from './specs/allow-omitting-single-registered-redirect-uri.js';
import Claims from './specs/claims.js';
import ClientBasedCORS from './specs/client-based-cors.js';
import Clients from './specs/client.js';
import ClockTolerance from './specs/clock-tolerance.js';
import ConformIdTokenClaims from './specs/conform-id-token-claims.js';
import Cookies from './specs/cookies.js';
import Discovery from './specs/discovery.js';
import EnableHttpPostMethods from './specs/enable-http-post-method.js';
import EnabledJWA from './specs/enabled-jwa.js';
import ExpiresWithSession from './specs/expires-with-session.js';
import ExtraClientMetadata from './specs/extra-client-metadata.js';
import ExtraParams from './specs/extra-param.js';
import ExtraTokenClaims from './specs/extra-token-claims.js';
import Features from './specs/feature.js';
import resourceIndicatorsFactory from './specs/feature/resource-indicator.js';
import Interactions from './specs/interaction.js';
import IssueRefreshToken from './specs/issue-refresh-token.js';
import LoadExistingGrant from './specs/load-existing-grant.js';
import PairwiseIdentifier from './specs/pairwise-identifier.js';
import Pkce from './specs/pkce.js';
import RenderError from './specs/render-error.js';
import Routes from './specs/route.js';
import RotateRefreshToken from './specs/rotate-refresh-token.js';
import Scopes from './specs/scopes.js';
import SubjectTypes from './specs/subject-type.js';
import Ttl from './specs/ttl.js';
import type { Configuration } from 'oidc-provider';
import type { IOIDCUtils } from '../di/interfaces/oidc-utils.interface.js';
import type { IOIDCConfig } from '../di/interfaces/oidc-config.interface.js';
import type { IKeyStore } from '../di/interfaces/key-store.interface.js';

/**
 * OpenID Provider Configuration Class
 *
 * This class contains all the configuration options for the OpenID Provider.
 * Each configuration option is documented with its purpose and reference to
 * the official documentation.
 *
 * @see {@link https://github.com/panva/node-oidc-provider/tree/main/docs#configuration-options}
 */
@injectable()
export default class OIDCConfig implements IOIDCConfig {
  private resourceIndicators: ReturnType<
    typeof resourceIndicatorsFactory
  > | null = null;

  constructor(
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.ClientRegistryManager)
    private readonly clientRegistryManager: IClientRegistryManager,
    @inject(TYPES.SessionManager)
    private readonly sessionManager: ISessionManager,
    @inject(TYPES.AuthService) private readonly authService: IAuthService,
    @inject(TYPES.UserService) private readonly userService: IUserService,
    @inject(TYPES.FileSystemUtils)
    private readonly fileSystemUtils: IFileSystemUtils,
    @inject(TYPES.ViewResolver) private readonly viewResolver: IViewResolver,
    @inject(TYPES.OIDCClientMerger)
    private readonly clientMerger: IOIDCClientMerger,
    @inject(TYPES.OIDCUtils) private readonly oidcUtils: IOIDCUtils,
    @inject(TYPES.KeyStore) private readonly keyStore: IKeyStore,
    @inject(TYPES.OIDCAdapterBridge)
    private readonly oidcAdapterBridge: IOIDCAdapterBridge
  ) {}

  /**
   * Get JWKS from the key store (async — call before provider creation)
   */
  public async getJwks(): Promise<{ keys: JsonWebKey[] }> {
    return this.keyStore.getJWKS();
  }

  /**
   * Get the complete OIDC Provider configuration
   * @returns Complete OIDC Provider configuration object
   */
  public getConfig(): Configuration {
    return {
      // Security & Authentication
      ...this.getSecurityConfig(),

      // Session & Token Management
      ...this.getSessionConfig(),

      // Features & Capabilities
      ...this.getFeaturesConfig(),

      // Interaction & UI
      ...this.getInteractionConfig(),

      // Client & Discovery
      ...this.getClientConfig(),

      ...this.getMiscConfig(),
    };
  }

  /**
   * Security and Authentication related configuration
   */
  private getSecurityConfig() {
    return {
      acceptQueryParamAccessTokens: AcceptQueryParamAccessTokens(
        this.configManager
      ),
      acrValues: AcrValues(this.configManager),
      clockTolerance: ClockTolerance(this.configManager),
      conformIdTokenClaims: ConformIdTokenClaims(this.configManager),
      cookies: Cookies(this.configManager),
      enabledJWA: EnabledJWA(this.configManager),
      extraClientMetadata: ExtraClientMetadata(this.configManager),
      extraParams: ExtraParams(this.configManager),
      extraTokenClaims: ExtraTokenClaims(),
      pairwiseIdentifier: PairwiseIdentifier(this.configManager, this.logger),
      pkce: Pkce(this.configManager),
      rotateRefreshToken: RotateRefreshToken(this.logger),
      ttl: Ttl(this.configManager, this.logger),
    };
  }

  /**
   * Session and Token Management related configuration
   */
  private getSessionConfig() {
    return {
      issueRefreshToken: IssueRefreshToken(),
      loadExistingGrant: LoadExistingGrant(this.logger),
      expiresWithSession: ExpiresWithSession(),
    };
  }

  /**
   * Features and Capabilities related configuration
   */
  private getFeaturesConfig() {
    this.resourceIndicators = resourceIndicatorsFactory(
      this.configManager,
      this.clientRegistryManager,
      this.logger,
      this.oidcAdapterBridge
    );

    return {
      features: Features(
        this.configManager,
        this.logger,
        this.viewResolver,
        this.oidcUtils,
        this.resourceIndicators
      ),
      claims: Claims(this.configManager),
      scopes: Scopes(this.configManager),
      subjectTypes: SubjectTypes(this.configManager),
    };
  }

  /**
   * Initialize resource servers from DB clients (async).
   * Called after adapter initialization during provider startup.
   */
  public async initializeResourceServers(): Promise<void> {
    if (this.resourceIndicators?.loadDbClients) {
      await this.resourceIndicators.loadDbClients();
    }
  }

  /**
   * Interaction and UI related configuration
   */
  private getInteractionConfig() {
    return {
      interactions: Interactions(
        this.configManager,
        this.userService,
        this.sessionManager,
        this.logger
      ),
      renderError: RenderError(this.viewResolver, this.oidcUtils),
    };
  }

  /**
   * Client and Discovery related configuration
   */
  private getClientConfig() {
    return {
      clients: Clients(this.clientMerger),
      allowOmittingSingleRegisteredRedirectUri:
        AllowOmittingSingleRegisteredRedirectUri(this.configManager),
      clientBasedCORS: ClientBasedCORS(),
      discovery: Discovery(this.configManager),
      enableHttpPostMethods: EnableHttpPostMethods(this.configManager),
    };
  }

  /**
   * Miscellaneous configuration
   */
  private getMiscConfig() {
    return {
      routes: Routes(this.configManager),
      findAccount: createAccountFactory(
        this.logger,
        this.userService,
        this.configManager
      ),
    };
  }
}
