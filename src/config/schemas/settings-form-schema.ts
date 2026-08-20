import { z } from 'zod';

const formObjectSchema = z.custom<Record<string, unknown>>(
  value => typeof value === 'object' && value !== null && !Array.isArray(value),
  'Expected a form object'
);

const requestMetadataShape = {
  _csrf: z.unknown().optional(),
  _deviceInfo: z.unknown().optional(),
};

export const ApplicationSettingsFormSchema = z
  .object({
    ...requestMetadataShape,
    _configVersion: z.unknown().optional(),
    title: z.unknown().optional(),
    description: z.unknown().optional(),
    locales: formObjectSchema.optional(),
  })
  .strict();

export const BrandingSettingsFormSchema = z
  .object({
    ...requestMetadataShape,
    companyName: z.unknown().optional(),
    logo: z.unknown().optional(),
    logoDark: z.unknown().optional(),
    logoIcon: z.unknown().optional(),
    logoIconDark: z.unknown().optional(),
    favicon: z.unknown().optional(),
    fonts: formObjectSchema.optional(),
    colors: formObjectSchema.optional(),
    ui: formObjectSchema.optional(),
  })
  .strict();

export const DeploymentSettingsFormSchema = z
  .object({
    ...requestMetadataShape,
    server: formObjectSchema.optional(),
    cookies: formObjectSchema.optional(),
  })
  .strict();

export const SecuritySettingsFormSchema = z
  .object({
    ...requestMetadataShape,
    authentication: formObjectSchema.optional(),
    protection: formObjectSchema.optional(),
    secrets: formObjectSchema.optional(),
    logging: formObjectSchema.optional(),
  })
  .strict();

export const FeaturesSettingsFormSchema = z
  .object({
    ...requestMetadataShape,
    oidc: formObjectSchema.optional(),
    social_providers: formObjectSchema.optional(),
  })
  .strict();

export const OidcSettingsFormSchema = z
  .object({
    ...requestMetadataShape,
    oidc: formObjectSchema.optional(),
  })
  .strict();

export const IntegrationsSettingsFormSchema = z
  .object({
    ...requestMetadataShape,
    integrations: formObjectSchema.optional(),
    notifications: formObjectSchema.optional(),
  })
  .strict();

function stripRequestMetadata(
  parsed: Record<string, unknown>
): Record<string, unknown> {
  const data = { ...parsed };
  delete data._csrf;
  delete data._deviceInfo;
  delete data._configVersion;
  return data;
}

export function parseApplicationSettingsForm(input: unknown): {
  data: Record<string, unknown>;
  configVersion: unknown;
} {
  const parsed = ApplicationSettingsFormSchema.parse(input);
  return {
    data: stripRequestMetadata(parsed),
    configVersion: parsed._configVersion,
  };
}

export function parseBrandingSettingsForm(
  input: unknown
): Record<string, unknown> {
  return stripRequestMetadata(BrandingSettingsFormSchema.parse(input));
}

export function parseDeploymentSettingsForm(
  input: unknown
): Record<string, unknown> {
  return stripRequestMetadata(DeploymentSettingsFormSchema.parse(input));
}

export function parseSecuritySettingsForm(
  input: unknown
): Record<string, unknown> {
  return stripRequestMetadata(SecuritySettingsFormSchema.parse(input));
}

export function parseFeaturesSettingsForm(
  input: unknown
): Record<string, unknown> {
  return stripRequestMetadata(FeaturesSettingsFormSchema.parse(input));
}

export function parseOidcSettingsForm(input: unknown): Record<string, unknown> {
  return stripRequestMetadata(OidcSettingsFormSchema.parse(input));
}

export function parseIntegrationsSettingsForm(
  input: unknown
): Record<string, unknown> {
  return stripRequestMetadata(IntegrationsSettingsFormSchema.parse(input));
}
