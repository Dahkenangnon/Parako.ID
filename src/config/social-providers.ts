/**
 * Social providers with built-in configuration UI and runtime adapters.
 *
 * Keep this list narrower than `SocialProvider`: that type also represents
 * provider identifiers accepted by generic social-auth data structures, while
 * only the providers below can currently be enabled in Parako configuration.
 */
export const CONFIGURABLE_SOCIAL_PROVIDER_IDS = [
  'google',
  'github',
  'microsoft',
  'linkedin',
  'facebook',
] as const;

export type ConfigurableSocialProvider =
  (typeof CONFIGURABLE_SOCIAL_PROVIDER_IDS)[number];

const CONFIGURABLE_SOCIAL_PROVIDERS = new Set<string>(
  CONFIGURABLE_SOCIAL_PROVIDER_IDS
);

export function isConfigurableSocialProvider(
  provider: unknown
): provider is ConfigurableSocialProvider {
  return (
    typeof provider === 'string' && CONFIGURABLE_SOCIAL_PROVIDERS.has(provider)
  );
}

export interface SocialProviderCredentials {
  client_id?: unknown;
  client_secret?: unknown;
}

export type InvalidSocialProviderCredential = 'client_id' | 'client_secret';

/**
 * Return the first credential that cannot be used for a provider request.
 * Sample placeholders are deliberately treated as missing so selecting an
 * example provider never exposes a login flow that is guaranteed to fail.
 */
export function findInvalidSocialProviderCredential(
  provider: string,
  credentials: SocialProviderCredentials
): InvalidSocialProviderCredential | null {
  const clientId =
    typeof credentials.client_id === 'string'
      ? credentials.client_id.trim()
      : '';
  if (!clientId || clientId === `your-${provider}-client-id`) {
    return 'client_id';
  }

  const clientSecret =
    typeof credentials.client_secret === 'string'
      ? credentials.client_secret.trim()
      : '';
  if (!clientSecret || clientSecret === `your-${provider}-client-secret`) {
    return 'client_secret';
  }

  return null;
}
