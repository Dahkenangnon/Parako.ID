import type { RuntimeConfig } from '../../config/types.js';
import type { ISettings } from '../../models/settings/types.js';

export interface SettingsSectionViewModel<Section extends string, Config> {
  title: string;
  section: Section;
  config: Config;
}

export type ApplicationSettingsViewModel = SettingsSectionViewModel<
  'application',
  RuntimeConfig['application']
> & {
  configVersion?: number;
};

export type BrandingSettingsViewModel = SettingsSectionViewModel<
  'branding',
  RuntimeConfig['branding']
>;

export type DeploymentSettingsViewModel = SettingsSectionViewModel<
  'deployment',
  RuntimeConfig['deployment']
>;

export type FeaturesSettingsViewModel = SettingsSectionViewModel<
  'features',
  Partial<RuntimeConfig['features']>
>;

export type OidcSettingsViewModel = SettingsSectionViewModel<
  'oidc',
  Partial<RuntimeConfig['oidc']>
> & {
  deploymentUrl: string;
};

export type IntegrationsSettingsViewModel = SettingsSectionViewModel<
  'integrations',
  Partial<RuntimeConfig['integrations']> & {
    notifications: Partial<RuntimeConfig['notifications']>;
  }
>;

type SecurityConfig = RuntimeConfig['security'];

type SecuritySettingsPage<
  Tab extends string,
  Config,
> = SettingsSectionViewModel<'security', Config> & {
  securityTab: Tab;
};

export type SecuritySettingsViewModel =
  | SecuritySettingsPage<
      'authentication',
      Partial<Pick<SecurityConfig, 'authentication'>>
    >
  | SecuritySettingsPage<'mfa', Partial<Pick<SecurityConfig, 'authentication'>>>
  | SecuritySettingsPage<
      'sessions',
      Partial<Pick<SecurityConfig, 'authentication'>> & {
        deployment: Pick<RuntimeConfig['deployment'], 'redis_prefix'>;
      }
    >
  | SecuritySettingsPage<
      'protection',
      Partial<Pick<SecurityConfig, 'authentication' | 'protection'>>
    >
  | SecuritySettingsPage<'secrets', Partial<Pick<SecurityConfig, 'secrets'>>>;

type SettingsHistoryRecord = Pick<
  ISettings,
  '_id' | 'id' | 'version' | 'is_active' | 'created_at' | 'metadata'
>;

export interface SettingsVersionViewModel {
  id?: string;
  version: string;
  isActive: boolean;
  createdAt?: string;
  updatedBy?: string;
}

export interface SettingsOverviewViewModel {
  title: string;
  isUsingFileConfig: boolean;
  versionHistory: SettingsVersionViewModel[];
  currentVersion: string;
}

export function createSettingsOverviewViewModel(
  history: readonly SettingsHistoryRecord[],
  isUsingFileConfig: boolean
): SettingsOverviewViewModel {
  const versionHistory = history.map(version => ({
    id: version._id ?? version.id,
    version: version.version,
    isActive: version.is_active,
    createdAt: version.created_at,
    updatedBy: version.metadata?.last_modified_by,
  }));
  const activeVersion =
    versionHistory.find(version => version.isActive) ?? versionHistory[0];

  return {
    title: 'Settings Overview',
    isUsingFileConfig,
    versionHistory,
    currentVersion: activeVersion?.version ?? '1.0.0',
  };
}

export function createSecuritySettingsViewModel(
  tab: 'authentication' | 'mfa' | 'sessions' | 'protection' | 'secrets',
  security: Partial<SecurityConfig>,
  redisPrefix = 'parako'
): SecuritySettingsViewModel {
  switch (tab) {
    case 'authentication':
      return {
        title: 'Authentication & Access',
        section: 'security',
        securityTab: tab,
        config:
          security.authentication === undefined
            ? {}
            : { authentication: security.authentication },
      };
    case 'mfa':
      return {
        title: 'Multi-Factor Authentication',
        section: 'security',
        securityTab: tab,
        config:
          security.authentication === undefined
            ? {}
            : { authentication: security.authentication },
      };
    case 'sessions':
      return {
        title: 'Session Management',
        section: 'security',
        securityTab: tab,
        config: {
          ...(security.authentication === undefined
            ? {}
            : { authentication: security.authentication }),
          deployment: { redis_prefix: redisPrefix },
        },
      };
    case 'protection':
      return {
        title: 'Protection & Detection',
        section: 'security',
        securityTab: tab,
        config: {
          ...(security.authentication === undefined
            ? {}
            : { authentication: security.authentication }),
          ...(security.protection === undefined
            ? {}
            : { protection: security.protection }),
        },
      };
    case 'secrets':
      return {
        title: 'Security Secrets',
        section: 'security',
        securityTab: tab,
        config:
          security.secrets === undefined ? {} : { secrets: security.secrets },
      };
  }
}
