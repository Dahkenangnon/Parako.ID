import type { AppConfig } from '../config/schemas/schema.js';
import { WEB_SAFE_FONTS } from '../config/constants.js';
import { CONFIGURABLE_SOCIAL_PROVIDER_IDS } from '../config/social-providers.js';
import { resolveBrandingUrlAsync } from './views.js';

const CANONICAL_PATH_BASE = 'https://parako.local';

export type ViewConfiguration = Pick<
  AppConfig,
  'application' | 'branding' | 'features' | 'integrations' | 'oidc' | 'security'
> & {
  deployment: AppConfig['deployment'] & {
    environment: 'development' | 'staging' | 'production';
  };
};

export interface ViewRequestMetadata {
  protocol: string;
  hostname: string;
  originalUrl: string;
}

export interface BuildConfigurationViewLocalsOptions {
  config: ViewConfiguration;
  request: ViewRequestMetadata;
  resolveFileUrl(storageKey: string): string | Promise<string>;
  enabledSocialProviders: readonly string[];
  restrictSocialProviders?: boolean;
}

export function canonicalViewPath(originalUrl: string): string {
  try {
    return new URL(originalUrl, CANONICAL_PATH_BASE).pathname;
  } catch {
    return '/';
  }
}

export async function buildConfigurationViewLocals({
  config,
  request,
  resolveFileUrl,
  enabledSocialProviders,
  restrictSocialProviders = false,
}: BuildConfigurationViewLocalsOptions) {
  const resolve = (value: string | null | undefined) =>
    resolveBrandingUrlAsync(value, resolveFileUrl);
  const authConfig = config.security.authentication;
  const customIdentifiers = (
    authConfig.custom_identifiers?.enabled
      ? (authConfig.custom_identifiers.fields ?? []).filter(
          field => field.usable_for_login
        )
      : []
  ).map(field => ({
    slot: field.slot,
    key: field.key,
    name: field.name,
    hint: field.hint_for_user,
  }));
  const configuredSocialProviders =
    config.features.social_providers.enabled ?? [];
  const effectiveSocialProviders = restrictSocialProviders
    ? enabledSocialProviders.filter(provider =>
        configuredSocialProviders.some(
          configuredProvider => configuredProvider === provider
        )
      )
    : [...enabledSocialProviders];
  const baseUrl =
    config.deployment.url || `${request.protocol}://${request.hostname}`;
  const canonicalUrl = `${baseUrl}${canonicalViewPath(request.originalUrl)}`;
  const [logo, logoDark, logoIcon, logoIconDark, favicon] = await Promise.all([
    resolve(config.branding.logo),
    resolve(config.branding.logoDark || config.branding.logo),
    resolve(config.branding.logoIcon || '/images/logo-icon-light.png'),
    resolve(config.branding.logoIconDark || '/images/logo-icon-dark.png'),
    resolve(config.branding.favicon || '/favicon.png'),
  ]);

  return {
    app: {
      title: config.application.title,
      description: config.application.description,
      locales: config.application.locales,
      url: config.deployment.url,
      env: config.deployment.environment,
      fingerprintJS: config.integrations.fingerprintjs?.enabled
        ? {
            apiKey: config.integrations.fingerprintjs.api_key,
            endpoint: config.integrations.fingerprintjs.endpoint,
          }
        : null,
    },
    branding: {
      companyName: config.branding.companyName,
      logo,
      logoDark,
      logoIcon,
      logoIconDark,
      favicon,
      colors: config.branding.colors || { light: {}, dark: {} },
      fonts: config.branding.fonts || {},
    },
    webSafeFonts: WEB_SAFE_FONTS,
    urls: {
      website: config.integrations.urls.website,
      privacy_policy: config.integrations.urls.privacy_policy,
      terms_of_service: config.integrations.urls.terms_of_service,
      contact: config.integrations.urls.contact,
    },
    socialProviders: {
      enabled: effectiveSocialProviders,
      available: config.features.social_providers.available || [
        ...CONFIGURABLE_SOCIAL_PROVIDER_IDS,
      ],
    },
    authentication: {
      loginMethods: {
        email: authConfig.login.login_methods.some(credential =>
          credential.includes('email')
        ),
        phone: authConfig.login.login_methods.some(
          credential =>
            credential.includes('phone') || credential.includes('phone_number')
        ),
        customIdentifier: authConfig.login.login_methods.some(credential =>
          credential.includes('custom_identifier')
        ),
        customIdentifiers,
        bothEnabled: authConfig.login.login_methods.length > 1,
      },
      signupMethods: {
        bothEnabled: authConfig.signup.signup_methods.length > 1,
        requireFullName:
          authConfig.signup.contact_channels?.full_name?.required ?? true,
      },
      customIdentifiers,
      emailVerificationRequired:
        authConfig.signup.require_email_verification || false,
      phoneVerificationRequired:
        authConfig.signup.require_phone_verification || false,
    },
    currentYear: new Date().getFullYear(),
    oidc: {
      issuer: config.oidc.issuer,
      path: config.oidc.path,
    },
    canonical_url: canonicalUrl,
    og: {
      title: config.application.title,
      description: config.application.description,
      url: canonicalUrl,
      site_name: config.branding.companyName,
      locale: config.application.locales.default,
    },
  };
}
