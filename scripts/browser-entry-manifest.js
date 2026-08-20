import { relative } from 'node:path';

const BROWSER_SOURCE_ROOT = 'src/assets/js';

/**
 * Executable browser roots referenced by Nunjucks templates.
 *
 * Dependencies belong in the TypeScript import graph and must not be added
 * here unless a template loads their emitted bundle directly.
 */
export const BROWSER_ENTRY_POINTS = Object.freeze([
  'src/assets/js/account/apps.ts',
  'src/assets/js/account/layout.ts',
  'src/assets/js/account/recovery-codes.ts',
  'src/assets/js/account/security-questions-setup.ts',
  'src/assets/js/account/sessions.ts',
  'src/assets/js/account/settings/index.ts',
  'src/assets/js/account/settings/passkeys.ts',
  'src/assets/js/admin/activities/index.ts',
  'src/assets/js/admin/configuration/common.ts',
  'src/assets/js/admin/configuration/features.ts',
  'src/assets/js/admin/configuration/integrations.ts',
  'src/assets/js/admin/configuration/oidc-ttl.ts',
  'src/assets/js/admin/configuration/security.ts',
  'src/assets/js/admin/configuration/tenant-custom-identifiers.ts',
  'src/assets/js/admin/configuration/validation.ts',
  'src/assets/js/admin/data-transfer/data-transfer.ts',
  'src/assets/js/admin/grants/index.ts',
  'src/assets/js/admin/jwks.ts',
  'src/assets/js/admin/layout.ts',
  'src/assets/js/admin/oidc-clients.ts',
  'src/assets/js/admin/oidc-clients/form.ts',
  'src/assets/js/admin/sessions/index.ts',
  'src/assets/js/admin/settings.ts',
  'src/assets/js/admin/settings/application.ts',
  'src/assets/js/admin/settings/branding.ts',
  'src/assets/js/admin/settings/common.ts',
  'src/assets/js/admin/settings/custom-identifiers.ts',
  'src/assets/js/admin/settings/deployment.ts',
  'src/assets/js/admin/settings/features.ts',
  'src/assets/js/admin/settings/import.ts',
  'src/assets/js/admin/settings/integrations.ts',
  'src/assets/js/admin/settings/oidc.ts',
  'src/assets/js/admin/settings/overview.ts',
  'src/assets/js/admin/settings/security.ts',
  'src/assets/js/admin/users.ts',
  'src/assets/js/admin/users/activities.ts',
  'src/assets/js/admin/users/form.ts',
  'src/assets/js/auth/account-recovery.ts',
  'src/assets/js/auth/email-verification.ts',
  'src/assets/js/auth/forgot-password.ts',
  'src/assets/js/auth/login.ts',
  'src/assets/js/auth/logout.ts',
  'src/assets/js/auth/mfa-verify.ts',
  'src/assets/js/auth/oidc/consent.ts',
  'src/assets/js/auth/oidc/device-flow-code-input.ts',
  'src/assets/js/auth/oidc/device-flow-confirm-code.ts',
  'src/assets/js/auth/oidc/device-flow-success.ts',
  'src/assets/js/auth/oidc/login.ts',
  'src/assets/js/auth/oidc/logout.ts',
  'src/assets/js/auth/oidc/mfa.ts',
  'src/assets/js/auth/recovery-backup-codes.ts',
  'src/assets/js/auth/recovery-security-questions.ts',
  'src/assets/js/auth/recovery-sms.ts',
  'src/assets/js/auth/recovery-verify-code.ts',
  'src/assets/js/auth/register.ts',
  'src/assets/js/auth/reset-password.ts',
  'src/assets/js/auth/setup-mfa.ts',
  'src/assets/js/auth/social-contact-info.ts',
  'src/assets/js/auth/social-password-setup.ts',
  'src/assets/js/error-page.ts',
  'src/assets/js/flash.ts',
  'src/assets/js/main.ts',
  'src/assets/js/sw/register.ts',
  'src/assets/js/user.ts',
  'src/assets/js/vendor/alpine.ts',
  'src/assets/js/vendor/fingerprintjs.ts',
  'src/assets/js/vendor/lucide.ts',
  'src/assets/js/webauthn/authenticate.ts',
  'src/assets/js/webauthn/register.ts',
]);

export const SERVICE_WORKER_ENTRY_POINT = 'src/assets/js/sw/service-worker.ts';

export function logicalAssetForEntry(entryPoint) {
  const sourceRelative = relative(BROWSER_SOURCE_ROOT, entryPoint).replace(
    /\\/g,
    '/'
  );
  if (sourceRelative.startsWith('../') || !sourceRelative.endsWith('.ts')) {
    throw new Error(`Invalid browser entry point: ${entryPoint}`);
  }
  return `js/${sourceRelative.replace(/\.ts$/, '.js')}`;
}

export function sourceEntryForLogicalAsset(logicalAsset) {
  if (!logicalAsset.startsWith('js/') || !logicalAsset.endsWith('.js')) {
    throw new Error(`Invalid browser asset path: ${logicalAsset}`);
  }
  return `${BROWSER_SOURCE_ROOT}/${logicalAsset
    .slice('js/'.length)
    .replace(/\.js$/, '.ts')}`;
}
