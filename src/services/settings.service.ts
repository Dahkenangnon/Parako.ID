import { injectable, inject } from 'inversify';
import { type ISettings } from '../models/settings/types.js';
import { AppConfigSchema } from '../config/schemas/schema.js';
import { getDefaultFullConfig } from '../config/constants.js';
import { z } from 'zod';
import type { ISettingsService } from '../di/interfaces/settings-service.interface.js';
import { TYPES } from '../di/types.js';
import { ensureEncrypted, ensureDecrypted } from '../utils/encryption.js';
import {
  SENSITIVE_FIELDS,
  getNestedValue,
  setNestedValue,
  maskSensitiveValue,
  isSensitiveField,
} from '../utils/settings.helper.js';
import type { ISettingsRepository } from '../db/repositories/interfaces/settings.repository.js';
import type {
  BulkWriteResult,
  BulkDeleteResult,
} from '../di/interfaces/base-service.interface.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';

// ── IBaseService stubs ────────────────────────────────────────────────────────

type PaginatedServiceResult<T> = {
  results: T[];
  page: number;
  limit: number;
  totalResults: number;
  totalPages: number;
};

/**
 * Settings service for managing application configuration in database
 */
@injectable()
export class SettingsService implements ISettingsService {
  private static readonly MAIN_CONFIG_KEY = 'parako_config';
  private static readonly CONFIG_VERSION = '1.0.0';

  // Mutex lock for configuration updates to prevent race conditions
  private static configUpdateLock: Promise<void> | null = null;

  constructor(
    @inject(TYPES.Logger)
    private readonly logger: ILogger,
    @inject(TYPES.SettingsRepository)
    private readonly settingsRepo: ISettingsRepository
  ) {}

  // ── IBaseService contract ─────────────────────────────────────────────────

  async findOne(
    filter: Record<string, unknown> | string
  ): Promise<ISettings | null> {
    if (typeof filter === 'string') return this.settingsRepo.findById(filter);
    const key = (filter as any).key;
    const isActive = (filter as any).is_active;
    if (key && isActive !== false) return this.settingsRepo.findActive(key);
    return this.settingsRepo.findOne(filter as Record<string, unknown>);
  }

  async countDocuments(filter: Record<string, unknown> = {}): Promise<number> {
    return this.settingsRepo.count(filter as Record<string, unknown>);
  }

  async updateById(
    id: string,
    data: Partial<ISettings>,
    _options?: any
  ): Promise<ISettings | null> {
    try {
      return await this.settingsRepo.update(id, data as any);
    } catch (error) {
      const msg = (error as Error).message ?? '';
      if (msg.includes('not found') || msg.includes('Document not found'))
        return null;
      throw error;
    }
  }

  async updateMany(
    filter: Record<string, unknown>,
    data: Partial<ISettings>,
    _options?: { upsert?: boolean; runValidators?: boolean }
  ): Promise<BulkWriteResult> {
    // For settings, updateMany is only used to deactivate records.
    const docs = await this.settingsRepo.findMany(
      filter as Record<string, unknown>
    );
    for (const doc of docs) {
      await this.settingsRepo.update(String(doc._id), data as any);
    }
    return {
      modifiedCount: docs.length,
      matchedCount: docs.length,
      upsertedCount: 0,
    };
  }

  async deleteMany(
    _filter: Record<string, unknown>
  ): Promise<BulkDeleteResult> {
    throw new Error('deleteMany is not supported for settings');
  }

  async findMany(
    filter: Record<string, unknown> = {},
    _options: {
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
      limit?: number;
      skip?: number;
    } = {}
  ): Promise<ISettings[]> {
    return this.settingsRepo.findMany(
      filter as Record<string, unknown>,
      _options
    );
  }

  async findWithPagination(
    filter: Record<string, unknown>,
    options: {
      page: number;
      limit: number;
      sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
    }
  ): Promise<PaginatedServiceResult<ISettings>> {
    const docs = await this.settingsRepo.findMany(
      filter as Record<string, unknown>,
      { sort: options.sort, limit: options.limit }
    );
    return {
      results: docs,
      page: 1,
      limit: options.limit || docs.length,
      totalResults: docs.length,
      totalPages: 1,
    };
  }

  async createOne(data: Partial<ISettings>): Promise<ISettings> {
    return this.settingsRepo.create(data as any);
  }

  async createMany(
    data: Partial<ISettings>[],
    _options?: { ordered?: boolean }
  ): Promise<ISettings[]> {
    return Promise.all(data.map(d => this.settingsRepo.create(d as any)));
  }

  async deleteOne(
    _filter: Record<string, unknown> | string
  ): Promise<ISettings | null> {
    throw new Error('deleteOne is not supported for settings');
  }

  async aggregate(_pipeline: unknown[]): Promise<unknown[]> {
    throw new Error('aggregate is not supported by the repository abstraction');
  }

  // ── Lock helpers ──────────────────────────────────────────────────────────

  private async acquireConfigLock(): Promise<() => void> {
    while (SettingsService.configUpdateLock) {
      await SettingsService.configUpdateLock;
    }

    let releaseLock!: () => void;
    SettingsService.configUpdateLock = new Promise<void>(resolve => {
      releaseLock = resolve;
    });

    return () => {
      releaseLock();
      SettingsService.configUpdateLock = null;
    };
  }

  // ── Encryption helpers ────────────────────────────────────────────────────

  private encryptSensitiveFields(config: any): any {
    const encryptedConfig = JSON.parse(JSON.stringify(config));

    for (const fieldPath of SENSITIVE_FIELDS) {
      const value = getNestedValue(encryptedConfig, fieldPath);

      if (value !== undefined && value !== null) {
        if (Array.isArray(value)) {
          const encryptedArray = value.map((item: string) => {
            if (typeof item === 'string' && item.length > 0) {
              return ensureEncrypted(item);
            }
            return item;
          });
          setNestedValue(encryptedConfig, fieldPath, encryptedArray);
        } else if (typeof value === 'string' && value.length > 0) {
          const encryptedValue = ensureEncrypted(value);
          setNestedValue(encryptedConfig, fieldPath, encryptedValue);
        }
      }
    }

    return encryptedConfig;
  }

  private decryptSensitiveFields(config: any): any {
    const decryptedConfig = JSON.parse(JSON.stringify(config));

    for (const fieldPath of SENSITIVE_FIELDS) {
      const value = getNestedValue(decryptedConfig, fieldPath);

      if (value !== undefined && value !== null) {
        try {
          if (Array.isArray(value)) {
            const decryptedArray = value.map((item: string) => {
              if (typeof item === 'string' && item.length > 0) {
                return ensureDecrypted(item);
              }
              return item;
            });
            setNestedValue(decryptedConfig, fieldPath, decryptedArray);
          } else if (typeof value === 'string' && value.length > 0) {
            const decryptedValue = ensureDecrypted(value);
            setNestedValue(decryptedConfig, fieldPath, decryptedValue);
          }
        } catch (error) {
          this.logger.error(
            `[SettingsService] Failed to decrypt field: ${fieldPath}`,
            { error: error instanceof Error ? error.message : String(error) }
          );
        }
      }
    }

    return decryptedConfig;
  }

  private validateEncryptionKey(): void {
    const encryptionKey = process.env.ENCRYPTION_KEY;

    if (!encryptionKey) {
      throw new Error(
        'ENCRYPTION_KEY environment variable is not set. ' +
          'Please set it in your .env file. ' +
          "Generate a key using: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }

    const isValidHex =
      encryptionKey.length === 64 && /^[0-9a-fA-F]{64}$/.test(encryptionKey);
    const isValidBase64 = encryptionKey.length === 44;
    const isValidBuffer = Buffer.from(encryptionKey).length === 32;

    if (!isValidHex && !isValidBase64 && !isValidBuffer) {
      throw new Error(
        'ENCRYPTION_KEY must be 32 bytes (64 hex characters or 44 base64 characters). ' +
          'Current key length is invalid. ' +
          "Generate a new key using: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
      );
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  public async loadAndDecryptConfiguration(): Promise<ISettings | null> {
    try {
      this.validateEncryptionKey();

      const settings = await this.settingsRepo.findActive(
        SettingsService.MAIN_CONFIG_KEY
      );

      if (!settings) {
        this.logger.warn('No main configuration found in database');
        return null;
      }

      const decryptedConfig = this.decryptSensitiveFields(settings);
      const validatedConfig = AppConfigSchema.parse(decryptedConfig);

      // AppConfig includes computed oidc_storage which ISettings doesn't persist,
      // but other fields overlap correctly.
      return validatedConfig as unknown as ISettings;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'load_and_decrypt_configuration',
      });
      throw error;
    }
  }

  public async getMainConfiguration(): Promise<ISettings | null> {
    try {
      const settings = await this.settingsRepo.findActive(
        SettingsService.MAIN_CONFIG_KEY
      );

      if (!settings) {
        this.logger.warn('No main configuration found in database');
        return null;
      }

      // Config was already validated on save; return as-is so callers receive
      // the raw settings document without an extra round-trip through Zod.
      return settings;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'get_main_configuration',
      });
      throw error;
    }
  }

  public async saveMainConfiguration(
    config: any,
    modifiedBy?: string,
    reason?: string
  ): Promise<ISettings> {
    const releaseLock = await this.acquireConfigLock();

    try {
      this.validateEncryptionKey();

      const encryptedConfig = this.encryptSensitiveFields(config);

      const existingSettings = await this.settingsRepo.findActive(
        SettingsService.MAIN_CONFIG_KEY
      );

      if (existingSettings) {
        const currentVersion = existingSettings._version || 0;
        const history = await this.settingsRepo.findHistory(
          SettingsService.MAIN_CONFIG_KEY,
          2
        );
        const latestInactive = history.find(
          h => !h.is_active && h._version > currentVersion
        );

        if (latestInactive) {
          this.logger.warn('Configuration version conflict detected', {
            configKey: SettingsService.MAIN_CONFIG_KEY,
            expectedVersion: currentVersion,
            latestVersion: latestInactive._version,
            attemptedBy: modifiedBy,
            context: 'optimistic_locking_conflict',
          });

          throw new Error(
            'Configuration was modified by another user. Please refresh the page and try again.'
          );
        }
      }

      const configToSave = {
        ...encryptedConfig,
        key: SettingsService.MAIN_CONFIG_KEY,
        schema_version: SettingsService.CONFIG_VERSION,
        description:
          existingSettings?.description ||
          'Main Parako.ID application configuration',
      };

      const result = await this.settingsRepo.save(
        SettingsService.MAIN_CONFIG_KEY,
        configToSave,
        {
          last_modified_by: modifiedBy,
          change_reason: reason,
          tags: existingSettings?.metadata?.tags || ['main', 'configuration'],
          environment: existingSettings?.metadata?.environment,
        }
      );

      this.logger.info(
        'Configuration saved as new version (auto-backup created)',
        {
          configKey: SettingsService.MAIN_CONFIG_KEY,
          version: result.version,
          _version: result._version,
          modifiedBy,
          previousVersion: existingSettings?.version,
        }
      );

      await this.cleanupOldVersions(SettingsService.MAIN_CONFIG_KEY, 10);

      return result;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'save_main_configuration',
        key: SettingsService.MAIN_CONFIG_KEY,
      });
      throw error;
    } finally {
      releaseLock();
    }
  }

  public async saveMainConfigurationWithTransaction(
    config: any,
    modifiedBy?: string,
    reason?: string
  ): Promise<ISettings> {
    // Transaction support is handled internally by the repository.
    // Fall back to regular save — the repo.save() method is already atomic.
    this.logger.info(
      'Saving configuration (repo.save() provides atomic versioning).'
    );
    return this.saveMainConfiguration(config, modifiedBy, reason);
  }

  public async getConfigurationByKey(key: string): Promise<ISettings | null> {
    try {
      return await this.settingsRepo.findActive(key);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'get_configuration_by_key',
        key,
      });
      return null;
    }
  }

  public async saveConfigurationByKey(
    key: string,
    value: any,
    _description?: string,
    modifiedBy?: string,
    reason?: string
  ): Promise<ISettings> {
    const isMainConfig = key === SettingsService.MAIN_CONFIG_KEY;
    const releaseLock = isMainConfig ? await this.acquireConfigLock() : null;

    try {
      const configToSave = {
        ...value,
        key,
        schema_version: SettingsService.CONFIG_VERSION,
      };

      const result = await this.settingsRepo.save(key, configToSave, {
        last_modified_by: modifiedBy,
        change_reason: reason,
        tags: ['configuration'],
      });

      this.logger.info('Configuration updated successfully', {
        configKey: key,
        version: result.version,
        _version: result._version,
        modifiedBy,
      });

      return result;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'save_configuration_by_key',
        key,
      });
      throw error;
    } finally {
      if (releaseLock) {
        releaseLock();
      }
    }
  }

  public async getMainConfigurationLastUpdated(): Promise<Date | null> {
    try {
      const settings = await this.settingsRepo.findActive(
        SettingsService.MAIN_CONFIG_KEY
      );
      return settings?.updated_at ? new Date(settings.updated_at) : null;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'get_main_configuration_last_updated',
        key: SettingsService.MAIN_CONFIG_KEY,
      });
      return null;
    }
  }

  public async hasMainConfiguration(): Promise<boolean> {
    try {
      const settings = await this.settingsRepo.findActive(
        SettingsService.MAIN_CONFIG_KEY
      );
      return settings !== null;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'has_main_configuration',
        key: SettingsService.MAIN_CONFIG_KEY,
      });
      return false;
    }
  }

  public async configDocumentExists(): Promise<boolean> {
    try {
      const count = await this.settingsRepo.count({
        key: SettingsService.MAIN_CONFIG_KEY,
      });
      return count > 0;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'config_document_exists_check',
      });
      return false;
    }
  }

  public async getAllActiveConfigurations(): Promise<ISettings[]> {
    try {
      return await this.settingsRepo.findMany(
        { is_active: true },
        { sort: { updated_at: -1 } }
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'get_all_active_configurations',
      });
      return [];
    }
  }

  public async getConfigurationHistory(key: string): Promise<ISettings[]> {
    try {
      return await this.settingsRepo.findHistory(key);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'get_configuration_history',
        key,
      });
      return [];
    }
  }

  public validateConfiguration(config: unknown): z.ZodSafeParseResult<any> {
    return AppConfigSchema.safeParse(config);
  }

  public async getConfigurationStatistics(): Promise<{
    totalConfigurations: number;
    activeConfigurations: number;
    mainConfigurationExists: boolean;
    lastMainConfigurationUpdate: Date | null;
  }> {
    try {
      const [
        totalConfigurations,
        activeConfigurations,
        mainConfigurationExists,
        lastMainConfigurationUpdate,
      ] = await Promise.all([
        this.settingsRepo.count({}),
        this.settingsRepo.count({ is_active: true }),
        this.hasMainConfiguration(),
        this.getMainConfigurationLastUpdated(),
      ]);

      return {
        totalConfigurations,
        activeConfigurations,
        mainConfigurationExists,
        lastMainConfigurationUpdate,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'get_configuration_statistics',
      });
      return {
        totalConfigurations: 0,
        activeConfigurations: 0,
        mainConfigurationExists: false,
        lastMainConfigurationUpdate: null,
      };
    }
  }

  public async migrateFromFile(
    fileConfig: any,
    modifiedBy?: string,
    reason?: string
  ): Promise<ISettings> {
    try {
      this.logger.info(
        'Starting configuration migration from file to database',
        {
          modifiedBy,
          reason: reason || 'Migration from file configuration',
        }
      );

      return await this.saveMainConfiguration(
        fileConfig,
        modifiedBy || 'system',
        reason || 'Migration from file configuration'
      );
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'migrate_from_file',
      });
      throw error;
    }
  }

  public async flushInitialConfiguration(
    modifiedBy?: string,
    reason?: string
  ): Promise<ISettings | null> {
    try {
      const existingConfig = await this.getMainConfiguration();
      if (existingConfig) {
        this.logger.info(
          'Main configuration already exists, skipping initial flush'
        );
        return existingConfig;
      }

      this.logger.info(
        'No main configuration found, flushing initial default configuration...'
      );

      const validatedConfig = AppConfigSchema.parse(getDefaultFullConfig());

      const savedConfig = await this.saveMainConfiguration(
        validatedConfig,
        modifiedBy || 'system',
        reason || 'Initial configuration flush'
      );

      this.logger.info(
        'Initial default configuration flushed to database successfully'
      );
      return savedConfig;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'flush_initial_configuration',
      });
      return null;
    }
  }

  private incrementVersion(version: string): string {
    const versionParts = version.split('.').map(Number);
    versionParts[2] = (versionParts[2] || 0) + 1;
    return versionParts.join('.');
  }

  // Keep for external callers (admin panel uses this)
  public generateConfigDiff(
    oldConfig: any,
    newConfig: any,
    pathPrefix: string = ''
  ): ConfigDiff[] {
    const changes: ConfigDiff[] = [];

    const maskIfSensitive = (path: string, value: any): any => {
      if (isSensitiveField(path)) {
        if (Array.isArray(value)) {
          return value.map(v =>
            typeof v === 'string' ? maskSensitiveValue(v) : v
          );
        }
        if (typeof value === 'string') {
          return maskSensitiveValue(value);
        }
      }
      return value;
    };

    const allKeys = new Set([
      ...Object.keys(oldConfig || {}),
      ...Object.keys(newConfig || {}),
    ]);

    for (const key of allKeys) {
      if (
        key === '_id' ||
        key === '__v' ||
        key === 'created_at' ||
        key === 'updated_at' ||
        key === '_version' ||
        key === 'schema_version' ||
        key === 'is_active' ||
        key === 'key' ||
        key === 'description' ||
        key === 'metadata'
      ) {
        continue;
      }

      const fieldPath = pathPrefix ? `${pathPrefix}.${key}` : key;
      const oldValue = oldConfig?.[key];
      const newValue = newConfig?.[key];

      if (oldValue === undefined && newValue !== undefined) {
        changes.push({
          field: fieldPath,
          oldValue: null,
          newValue: maskIfSensitive(fieldPath, newValue),
          changeType: 'added',
        });
        continue;
      }

      if (oldValue !== undefined && newValue === undefined) {
        changes.push({
          field: fieldPath,
          oldValue: maskIfSensitive(fieldPath, oldValue),
          newValue: null,
          changeType: 'removed',
        });
        continue;
      }

      if (oldValue !== undefined && newValue !== undefined) {
        if (
          typeof oldValue === 'object' &&
          !Array.isArray(oldValue) &&
          oldValue !== null &&
          typeof newValue === 'object' &&
          !Array.isArray(newValue) &&
          newValue !== null
        ) {
          const nestedChanges = this.generateConfigDiff(
            oldValue,
            newValue,
            fieldPath
          );
          changes.push(...nestedChanges);
        } else if (JSON.stringify(oldValue) !== JSON.stringify(newValue)) {
          changes.push({
            field: fieldPath,
            oldValue: maskIfSensitive(fieldPath, oldValue),
            newValue: maskIfSensitive(fieldPath, newValue),
            changeType: 'modified',
          });
        }
      }
    }

    return changes;
  }

  public analyzeConfigImpact(changes: ConfigDiff[]): ConfigImpact {
    const servicesAffected = new Set<string>();
    const warnings: string[] = [];
    let requiresRestart = false;

    for (const change of changes) {
      const { field } = change;

      if (field.startsWith('oidc.')) {
        servicesAffected.add('oidc');

        if (field === 'oidc.issuer') {
          requiresRestart = true;
          warnings.push(
            'CRITICAL: Changing OIDC issuer will invalidate all existing tokens, sessions, and client registrations. ' +
              'All users will need to re-authenticate. This is a BREAKING CHANGE.'
          );
        }

        if (field.startsWith('oidc.secrets.')) {
          requiresRestart = true;
          warnings.push(
            'OIDC secrets modified. Application restart required. Existing sessions may be invalidated.'
          );
        }

        if (field.startsWith('oidc.discovery.')) {
          warnings.push(
            'OIDC discovery document modified. Relying parties should refresh their cached discovery documents.'
          );
        }

        if (field.startsWith('oidc.features.')) {
          requiresRestart = true;
          warnings.push(
            'OIDC features changed. Application restart required for changes to take effect.'
          );
        }
      }

      if (field.startsWith('security.')) {
        servicesAffected.add('security');

        if (field.startsWith('security.secrets.jwt_secret')) {
          requiresRestart = true;
          warnings.push(
            'CRITICAL: JWT secret modified. All existing JWT tokens will be invalidated. Users will need to re-authenticate.'
          );
        }

        if (field.startsWith('security.secrets.cookie_secrets')) {
          requiresRestart = true;
          warnings.push(
            'Cookie secrets modified. Application restart required. Existing sessions will be invalidated.'
          );
        }

        if (field.startsWith('security.authentication.multi_factor.')) {
          servicesAffected.add('authentication');
          warnings.push(
            'Multi-factor authentication settings modified. Changes will affect new MFA enrollments.'
          );
        }

        if (field.startsWith('security.rate_limiting.')) {
          warnings.push(
            'Rate limiting configuration modified. New limits will apply to subsequent requests.'
          );
        }
      }

      if (field.startsWith('integrations.')) {
        servicesAffected.add('integrations');

        if (field.startsWith('integrations.email.')) {
          servicesAffected.add('email');
          requiresRestart = true;
          warnings.push(
            'Email/SMTP configuration modified. Application restart required. Test email connectivity after restart.'
          );
        }

        if (field.startsWith('integrations.social_providers.')) {
          servicesAffected.add('social_login');
          warnings.push(
            'Social login provider configuration modified. Test social login flows to ensure connectivity.'
          );
        }
      }

      if (field.startsWith('deployment.')) {
        servicesAffected.add('deployment');

        if (field === 'deployment.url') {
          requiresRestart = true;
          warnings.push(
            'IMPORTANT: Deployment URL changed. This will automatically update OIDC issuer, callback URLs, ' +
              'and integration URLs. Verify all redirect URIs are updated in OIDC clients and social login providers.'
          );
        }

        if (field.startsWith('deployment.server.allowed_origins')) {
          warnings.push(
            'CORS allowed origins modified. New origins will apply immediately to subsequent requests.'
          );
        }
      }

      if (field.startsWith('branding.')) {
        servicesAffected.add('branding');

        if (field === 'branding.companyName') {
          warnings.push(
            'Company name changed. This will automatically update MFA issuer names (TOTP and WebAuthn). ' +
              'Users may see the new name in their authenticator apps after re-enrollment.'
          );
        }
      }

      if (field.startsWith('features.')) {
        servicesAffected.add('features');
      }
    }

    return {
      servicesAffected: Array.from(servicesAffected),
      requiresRestart,
      warnings,
    };
  }

  public async validateAndFixActiveConfigs(): Promise<{
    isValid: boolean;
    multipleActiveFound: boolean;
    fixedCount: number;
    keptVersion: string | null;
    details: string;
  }> {
    try {
      this.logger.info(
        '[SettingsService] Running startup validation for active configurations...'
      );

      const activeConfigs = await this.settingsRepo.findMany(
        { key: SettingsService.MAIN_CONFIG_KEY, is_active: true },
        { sort: { created_at: -1 } }
      );

      if (activeConfigs.length <= 1) {
        this.logger.info(
          '[SettingsService] Validation passed: Single active configuration detected',
          {
            activeCount: activeConfigs.length,
            version: activeConfigs[0]?.version || 'none',
          }
        );

        return {
          isValid: true,
          multipleActiveFound: false,
          fixedCount: 0,
          keptVersion: activeConfigs[0]?.version || null,
          details: `Validation passed: ${activeConfigs.length} active configuration(s) found`,
        };
      }

      this.logger.error(
        '[SettingsService] CRITICAL: Multiple active configurations detected!',
        {
          count: activeConfigs.length,
          versions: activeConfigs.map(c => ({
            version: c.version,
            _version: c._version,
            created_at: c.created_at,
            updated_at: c.updated_at,
          })),
        }
      );

      const [newestConfig, ...olderConfigs] = activeConfigs;

      this.logger.warn(
        '[SettingsService] Auto-healing: Keeping newest config, deactivating older ones',
        {
          keeping: {
            version: newestConfig.version,
            _version: newestConfig._version,
            created_at: newestConfig.created_at,
          },
          deactivating: olderConfigs.map(c => ({
            version: c.version,
            _version: c._version,
            created_at: c.created_at,
          })),
        }
      );

      let fixedCount = 0;
      for (const config of olderConfigs) {
        try {
          await this.settingsRepo.update(String(config._id), {
            is_active: false,
          } as any);
          fixedCount++;
          this.logger.info('[SettingsService] Deactivated older config', {
            version: config.version,
            _version: config._version,
          });
        } catch (error) {
          this.logger.error('[SettingsService] Failed to deactivate config', {
            version: config.version,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const activeConfigsAfterFix = await this.settingsRepo.count({
        key: SettingsService.MAIN_CONFIG_KEY,
        is_active: true,
      });

      if (activeConfigsAfterFix === 1) {
        this.logger.info(
          '[SettingsService] Auto-healing successful: Single active config restored',
          {
            keptVersion: newestConfig.version,
            deactivatedCount: fixedCount,
          }
        );

        return {
          isValid: false,
          multipleActiveFound: true,
          fixedCount,
          keptVersion: newestConfig.version,
          details: `Auto-healed: Found ${activeConfigs.length} active configs, kept newest (v${newestConfig.version}), deactivated ${fixedCount} older configs`,
        };
      } else {
        this.logger.error('[SettingsService] Auto-healing incomplete', {
          remainingActiveCount: activeConfigsAfterFix,
          expectedCount: 1,
        });

        return {
          isValid: false,
          multipleActiveFound: true,
          fixedCount,
          keptVersion: newestConfig.version,
          details: `Auto-healing incomplete: ${activeConfigsAfterFix} active configs remain after attempting to fix`,
        };
      }
    } catch (error) {
      this.logger.error('[SettingsService] Validation failed with error', {
        error: error instanceof Error ? error.message : String(error),
        context: 'validate_and_fix_active_configs',
      });

      return {
        isValid: false,
        multipleActiveFound: false,
        fixedCount: 0,
        keptVersion: null,
        details: `Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  public async cleanupOldVersions(
    key: string,
    keepCount: number = 10
  ): Promise<number> {
    try {
      const allVersions = await this.settingsRepo.findHistory(key);

      if (allVersions.length <= keepCount) {
        this.logger.debug('No cleanup needed', {
          configKey: key,
          totalVersions: allVersions.length,
          keepCount,
        });
        return 0;
      }

      const versionsToDelete = allVersions.slice(keepCount);
      const idsToDelete = versionsToDelete
        .map((v: ISettings) => v._id)
        .filter((id: any) => id !== undefined);

      if (idsToDelete.length === 0) {
        return 0;
      }

      let deletedCount = 0;
      for (const id of idsToDelete) {
        try {
          await this.settingsRepo.delete(String(id));
          deletedCount++;
        } catch (error) {
          this.logger.error('[SettingsService] Failed to delete old version', {
            id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      this.logger.info('Configuration version cleanup completed', {
        configKey: key,
        totalVersions: allVersions.length,
        kept: keepCount,
        deleted: deletedCount,
        deletedVersions: versionsToDelete.map((v: ISettings) => ({
          version: v.version,
          _version: v._version,
          created_at: v.created_at,
        })),
      });

      return deletedCount;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'cleanup_old_versions',
        configKey: key,
        keepCount,
      });
      return 0;
    }
  }
}

/**
 * Configuration diff entry representing a single field change
 */
export interface ConfigDiff {
  field: string;
  oldValue: any;
  newValue: any;
  changeType: 'added' | 'modified' | 'removed';
}

/**
 * Configuration impact analysis result
 */
export interface ConfigImpact {
  servicesAffected: string[];
  requiresRestart: boolean;
  warnings: string[];
}
