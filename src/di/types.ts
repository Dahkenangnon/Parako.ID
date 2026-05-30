// Service identifiers for dependency injection
export const TYPES = {
  ConfigManager: Symbol.for('ConfigManager'),
  BootstrapConfigProvider: Symbol.for('BootstrapConfigProvider'),
  DatabaseConfigProvider: Symbol.for('DatabaseConfigProvider'),
  FileConfigProvider: Symbol.for('FileConfigProvider'),

  // Configuration schemas and constants
  AppConfigSchema: Symbol.for('AppConfigSchema'),
  BootstrapConfigSchema: Symbol.for('BootstrapConfigSchema'),
  DefaultFullConfig: Symbol.for('DefaultFullConfig'),

  EmailService: Symbol.for('EmailService'),

  NotificationService: Symbol.for('NotificationService'),

  // SMS services
  SmsService: Symbol.for('SmsService'),

  ViewResolver: Symbol.for('ViewResolver'),

  SessionManager: Symbol.for('SessionManager'),
  FlashManager: Symbol.for('FlashManager'),

  RedirectAuthority: Symbol.for('RedirectAuthority'),

  RecoveryUtils: Symbol.for('RecoveryUtils'),
  RecoveryService: Symbol.for('RecoveryService'),

  PasswordUtils: Symbol.for('PasswordUtils'),

  // MFA services
  MfaUtils: Symbol.for('MfaUtils'),

  FileSystemUtils: Symbol.for('FileSystemUtils'),

  // Config file reader services
  ConfigFileReader: Symbol.for('ConfigFileReader'),

  CookieManager: Symbol.for('CookieManager'),

  // Client device info services
  ClientDeviceInfoManager: Symbol.for('ClientDeviceInfoManager'),

  // Client registry config services
  ClientRegistryManager: Symbol.for('ClientRegistryManager'),

  Logger: Symbol.for('Logger'),

  DatabaseConnectionManager: Symbol.for('DatabaseConnectionManager'),

  GitHubSocialLogin: Symbol.for('GitHubSocialLogin'),
  GoogleSocialLogin: Symbol.for('GoogleSocialLogin'),
  MicrosoftSocialLogin: Symbol.for('MicrosoftSocialLogin'),
  LinkedInSocialLogin: Symbol.for('LinkedInSocialLogin'),
  FacebookSocialLogin: Symbol.for('FacebookSocialLogin'),
  SocialLoginManager: Symbol.for('SocialLoginManager'),

  StorageProvider: Symbol.for('StorageProvider'),
  ImageProcessorService: Symbol.for('ImageProcessorService'),

  LocalsMiddleware: Symbol.for('LocalsMiddleware'),
  SecurityMiddleware: Symbol.for('SecurityMiddleware'),
  UIMiddleware: Symbol.for('UIMiddleware'),
  UploadMiddleware: Symbol.for('UploadMiddleware'),
  KoaMiddleware: Symbol.for('KoaMiddleware'),
  OIDCMiddleware: Symbol.for('OIDCMiddleware'),
  ConfigValidationMiddleware: Symbol.for('ConfigValidationMiddleware'),
  RequestLoggerMiddleware: Symbol.for('RequestLoggerMiddleware'),
  TenantContextMiddleware: Symbol.for('TenantContextMiddleware'),

  MetricsService: Symbol.for('MetricsService'),

  UserService: Symbol.for('UserService'),
  ActivityService: Symbol.for('ActivityService'),
  AuthService: Symbol.for('AuthService'),
  SocialIntegrationService: Symbol.for('SocialIntegrationService'),
  SettingsService: Symbol.for('SettingsService'),
  I18nService: Symbol.for('I18nService'),
  GeolocationService: Symbol.for('GeolocationService'),
  IPReputationService: Symbol.for('IPReputationService'),
  WebAuthnService: Symbol.for('WebAuthnService'),

  // Tenant Settings Override
  TenantSettingsOverrideModel: Symbol.for('TenantSettingsOverrideModel'),
  TenantSettingsOverrideRepository: Symbol.for(
    'TenantSettingsOverrideRepository'
  ),
  TenantSettingsOverrideService: Symbol.for('TenantSettingsOverrideService'),

  AuthController: Symbol.for('AuthController'),
  AccountController: Symbol.for('AccountController'),
  AdminActivitiesController: Symbol.for('AdminActivitiesController'),
  AdminUsersController: Symbol.for('AdminUsersController'),
  AdminOidcClientsController: Symbol.for('AdminOidcClientsController'),
  AdminUserGrantsController: Symbol.for('AdminUserGrantsController'),
  AdminHomeController: Symbol.for('AdminHomeController'),
  AdminSessionsController: Symbol.for('AdminSessionsController'),
  AdminSettingsController: Symbol.for('AdminSettingsController'),
  WebAuthnController: Symbol.for('WebAuthnController'),
  AdminJwksController: Symbol.for('AdminJwksController'),
  AdminConfigurationController: Symbol.for('AdminConfigurationController'),
  AdminDataTransferController: Symbol.for('AdminDataTransferController'),

  // Data Transfer Service
  DataTransferService: Symbol.for('DataTransferService'),

  // Key Store
  KeyStore: Symbol.for('KeyStore'),

  // OIDC dependencies
  Account: Symbol.for('Account'),
  OIDCUtils: Symbol.for('OIDCUtils'),
  OIDCConfig: Symbol.for('OIDCConfig'),
  OIDCClientMerger: Symbol.for('OIDCClientMerger'),

  // OIDC Flow Handlers
  OIDCAbortHandler: Symbol.for('OIDCAbortHandler'),
  OIDCConsentHandler: Symbol.for('OIDCConsentHandler'),
  OIDCErrorHandler: Symbol.for('OIDCErrorHandler'),
  OIDCInteractionHandler: Symbol.for('OIDCInteractionHandler'),
  OIDCLoginHandler: Symbol.for('OIDCLoginHandler'),
  OIDCMfaHandler: Symbol.for('OIDCMfaHandler'),
  OIDCNewDeviceVerifyHandler: Symbol.for('OIDCNewDeviceVerifyHandler'),
  OIDCSelectAccountHandler: Symbol.for('OIDCSelectAccountHandler'),
  OIDCSocialCallbackHandler: Symbol.for('OIDCSocialCallbackHandler'),
  OIDCSocialLoginHandler: Symbol.for('OIDCSocialLoginHandler'),
  OIDCWebAuthnMfaHandler: Symbol.for('OIDCWebAuthnMfaHandler'),

  UserModel: Symbol.for('UserModel'),
  ActivityModel: Symbol.for('ActivityModel'),
  SocialIntegrationModel: Symbol.for('SocialIntegrationModel'),
  SettingsModel: Symbol.for('SettingsModel'),
  JwksKeyModel: Symbol.for('JwksKeyModel'),
  TenantModel: Symbol.for('TenantModel'),

  // OIDC Adapter Bridge
  OIDCAdapterBridge: Symbol.for('OIDCAdapterBridge'),

  // OIDC Provider Service
  ProviderService: Symbol.for('ProviderService'),

  // Tenant Provider Registry (multi-tenancy: Provider-per-tenant pool)
  TenantProviderRegistry: Symbol.for('TenantProviderRegistry'),
  TenantActivityRedisClient: Symbol.for('TenantActivityRedisClient'),
  ProviderFactory: Symbol.for('ProviderFactory'),

  // OIDC Listener Service
  OIDCListenerService: Symbol.for('OIDCListenerService'),

  // _ops Infrastructure Gateway
  OpsTenantMiddleware: Symbol.for('OpsTenantMiddleware'),
  OpsSocialCallbackService: Symbol.for('OpsSocialCallbackService'),
  OpsRedisClient: Symbol.for('OpsRedisClient'),

  // Social Tier 1 completion (cross-tenant OAuth relay)
  SocialTier1CompletionService: Symbol.for('SocialTier1CompletionService'),

  // _platforms Admin Portal
  PlatformTenantMiddleware: Symbol.for('PlatformTenantMiddleware'),
  PlatformAdminService: Symbol.for('PlatformAdminService'),
  PlatformAdminController: Symbol.for('PlatformAdminController'),

  // Routes Manager
  MainRoutesManager: Symbol.for('MainRoutesManager'),
  OidcRoutesManager: Symbol.for('OidcRoutesManager'),

  // OIDC Entry
  OidcManager: Symbol.for('OidcManager'),

  // Redis Pub/Sub event bus
  RedisPubSubService: Symbol.for('RedisPubSubService'),

  // Repository layer (DB-agnostic)
  UserRepository: Symbol.for('UserRepository'),
  ActivityRepository: Symbol.for('ActivityRepository'),
  SettingsRepository: Symbol.for('SettingsRepository'),
  SocialIntegrationRepository: Symbol.for('SocialIntegrationRepository'),
  TenantRepository: Symbol.for('TenantRepository'),

  // Prisma client (only bound when adapter !== 'mongodb')
  PrismaClient: Symbol.for('PrismaClient'),

  // Management API v1 — single router factory that creates all controllers
  // internally (controllers are plain classes, not DI-resolved individually)
  ApiV1RoutesManager: Symbol.for('ApiV1RoutesManager'),

  Application: Symbol.for('Application'),
} as const;
