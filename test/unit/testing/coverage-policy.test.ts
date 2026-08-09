import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import vitestConfig from '../../../vitest.config.js';

describe('coverage policy', () => {
  it('exposes enforceable global floors using the Vitest 4 threshold shape', () => {
    const coverage = vitestConfig.test?.coverage;
    const thresholds = coverage?.thresholds;

    expect(thresholds).toMatchObject({
      branches: 16.01,
      functions: 21.19,
      lines: 18.22,
      statements: 18.07,
    });
    expect(thresholds).not.toHaveProperty('global');
  });

  it('measures both application sources and production scripts', () => {
    expect(vitestConfig.test?.coverage?.include).toEqual([
      'src/**/*.{js,ts}',
      'scripts/**/*.{js,mjs,ts}',
    ]);
  });

  it('does not hide first-party files behind generic filename exclusions', () => {
    const genericExclusions = [
      'src/**/index.ts',
      'src/types/**',
      'src/**/types.ts',
      'src/**/interfaces.ts',
      'src/**/schemas.ts',
      'src/**/constants.ts',
      'src/**/config.ts',
      'src/**/vite.config.ts',
      'src/**/vitest.config.ts',
    ];

    expect(vitestConfig.test?.coverage?.exclude).not.toEqual(
      expect.arrayContaining(genericExclusions)
    );
  });

  it('registers every production coverage exclusion with review metadata', () => {
    const registry = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'test/coverage/exclusions.json'),
        'utf8'
      )
    ) as {
      version: number;
      exclusions: Array<{
        file: string;
        lines: string;
        reason: string;
        alternativeEvidence: string;
        approver: string;
        reviewDate: string;
      }>;
    };

    expect(registry.version).toBe(1);
    expect(registry.exclusions).not.toHaveLength(0);
    const wholeFileExclusions = registry.exclusions
      .filter(({ lines }) => lines === 'all')
      .map(({ file }) => file);
    const lineLevelExclusions = registry.exclusions
      .filter(({ lines }) => lines !== 'all')
      .map(({ file }) => file);

    expect(wholeFileExclusions).toEqual(vitestConfig.test?.coverage?.exclude);
    expect(
      (vitestConfig.test?.coverage?.exclude ?? []).filter(file =>
        lineLevelExclusions.includes(file)
      )
    ).toEqual([]);

    for (const exclusion of registry.exclusions) {
      expect(exclusion).toEqual({
        file: expect.any(String),
        lines: expect.any(String),
        reason: expect.any(String),
        alternativeEvidence: expect.any(String),
        approver: expect.any(String),
        reviewDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      });
      expect(Object.values(exclusion).every(Boolean)).toBe(true);
    }
  });

  it('emits every coverage artifact required by CI', () => {
    expect(vitestConfig.test?.coverage?.reporter).toEqual(
      expect.arrayContaining(['text', 'json-summary', 'lcov', 'html'])
    );
  });

  it('requires 100% coverage for every newly added instrumented file', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;
    const newInstrumentedFiles = [
      'scripts/testing/generate-production-artifact-manifest.mjs',
      'scripts/testing/production-artifact-manifest.ts',
    ];

    for (const filePath of newInstrumentedFiles) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed release tooling at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'scripts/create-release-manifest.mjs',
      'scripts/create-sbom.mjs',
      'scripts/extract-changelog.mjs',
      'scripts/tag-release.mjs',
      'scripts/build-manifest.js',
      'scripts/release.mjs',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed critical OIDC and JWKS files at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;
    const completedCriticalFiles = [
      'src/models/jwks-key.model.ts',
      'src/oidc/config.ts',
      'src/oidc/client-merger.ts',
      'src/oidc/adapter/client.interface.ts',
      'src/oidc/index.ts',
      'src/oidc/listener.ts',
      'src/oidc/provider.ts',
      'src/oidc/provider-keystore-updater.ts',
      'src/oidc/utils.ts',
      'src/oidc/key-store/constants.ts',
      'src/oidc/key-store/db-key-store.ts',
      'src/oidc/key-store/file-key-store.ts',
      'src/oidc/key-store/mongoose-jwks-key.repository.ts',
      'src/oidc/key-store/prisma-jwks-key.repository.ts',
      'src/oidc/flows/route.ts',
      'src/oidc/flows/handlers/abort.ts',
      'src/oidc/flows/middleware/cache.middleware.ts',
      'src/oidc/flows/middleware/koa.middleware.ts',
      'src/oidc/flows/middleware/oidc.middleware.ts',
      'src/oidc/middleware/cache-headers.ts',
      'src/oidc/flows/handlers/consent.ts',
      'src/oidc/flows/handlers/error.ts',
      'src/oidc/flows/handlers/interaction.ts',
      'src/oidc/flows/handlers/login.ts',
      'src/oidc/flows/handlers/mfa.ts',
      'src/oidc/flows/handlers/new-device-verify.ts',
      'src/oidc/flows/handlers/select-account.ts',
      'src/oidc/flows/handlers/social-callback.ts',
      'src/oidc/flows/handlers/social-login.ts',
      'src/oidc/flows/handlers/webauthn-mfa.ts',
      'src/oidc/specs/*.ts',
      'src/oidc/specs/feature.ts',
      'src/oidc/specs/feature/**/*.ts',
      'src/oidc/specs/feature/device-flow.ts',
      'src/oidc/specs/feature/rp-initiated-logout.ts',
    ];

    for (const filePath of completedCriticalFiles) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps the completed multi-tenant provider registry at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    expect(thresholds['src/multi-tenancy/tenant-provider-registry.ts']).toEqual(
      { 100: true }
    );
  });

  it('keeps completed OIDC admin adapters at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/oidc/adapter/mongodb/admin-service.ts',
      'src/oidc/adapter/prisma/admin-service.ts',
      'src/oidc/adapter/redis/admin-service.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed worker and job infrastructure at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/jobs/config.ts',
      'src/jobs/domains/background-tasks/handlers/data-import.handler.ts',
      'src/jobs/domains/background-tasks/handlers/jwks-rotation.handler.ts',
      'src/jobs/domains/background-tasks/handlers/password-breach-check.handler.ts',
      'src/jobs/domains/background-tasks/queue.ts',
      'src/jobs/domains/background-tasks/worker.ts',
      'src/jobs/processing/queue-manager.ts',
      'src/jobs/processing/worker-manager.ts',
      'src/jobs/redis.ts',
      'src/jobs/schedules/jwks-rotation.schedule.ts',
      'src/worker.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed database infrastructure at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/db/connection.ts',
      'src/db/extensions/tenant.extension.ts',
      'src/db/plugins/paginate.plugin.ts',
      'src/db/plugins/tenant.plugin.ts',
      'src/db/plugins/to-json.plugin.ts',
      'src/db/prisma.ts',
      'src/db/repositories/mongoose/activity.repository.ts',
      'src/db/repositories/mongoose/base.repository.ts',
      'src/db/repositories/mongoose/settings.repository.ts',
      'src/db/repositories/mongoose/social-integration.repository.ts',
      'src/db/repositories/mongoose/tenant-settings-override.repository.ts',
      'src/db/repositories/mongoose/tenant.repository.ts',
      'src/db/repositories/mongoose/user.repository.ts',
      'src/db/repositories/prisma/activity.repository.ts',
      'src/db/repositories/prisma/base.repository.ts',
      'src/db/repositories/prisma/settings.repository.ts',
      'src/db/repositories/prisma/social-integration.repository.ts',
      'src/db/repositories/prisma/tenant-settings-override.repository.ts',
      'src/db/repositories/prisma/tenant.repository.ts',
      'src/db/repositories/prisma/user.repository.ts',
      'src/db/utils.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed persistence models and schemas at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/models/activity.model.ts',
      'src/models/base.model.ts',
      'src/models/jwks-key.model.ts',
      'src/models/settings.model.ts',
      'src/models/settings/application.ts',
      'src/models/settings/branding/ui/customization/views/accounts.ts',
      'src/models/settings/branding/ui/customization/views/auth.ts',
      'src/models/settings/branding/ui/customization/views/errorpage.ts',
      'src/models/settings/branding/ui/customization/views/oidc.ts',
      'src/models/settings/schemas.ts',
      'src/models/settings/types.ts',
      'src/models/social-integration.model.ts',
      'src/models/tenant-settings-override/model.ts',
      'src/models/tenant.model.ts',
      'src/models/user.model.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed shared service infrastructure at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/services/activity.service.ts',
      'src/services/auth.service.ts',
      'src/services/base.service.ts',
      'src/services/data-transfer/data-transfer.service.ts',
      'src/services/data-transfer/entities/activities.entity.ts',
      'src/services/data-transfer/entities/index.ts',
      'src/services/data-transfer/entities/oidc-clients.entity.ts',
      'src/services/data-transfer/entities/users.entity.ts',
      'src/services/data-transfer/format-utils.ts',
      'src/services/geolocation.service.ts',
      'src/services/i18n.service.ts',
      'src/services/image-processor.service.ts',
      'src/services/ip-reputation.service.ts',
      'src/services/notification.service.ts',
      'src/services/ops-social-callback.service.ts',
      'src/services/platform-admin.service.ts',
      'src/services/recovery.service.ts',
      'src/services/redis-pubsub.service.ts',
      'src/services/settings.service.ts',
      'src/services/sms.service.ts',
      'src/services/social-integration.service.ts',
      'src/services/social-tier1-completion.service.ts',
      'src/services/tenant-settings-override.service.ts',
      'src/services/user.service.ts',
      'src/services/webauthn.service.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed configuration boundaries at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/config/computed-fields.ts',
      'src/config/constants.ts',
      'src/config/hardening-defaults.ts',
      'src/config/i18n.ts',
      'src/config/index.ts',
      'src/config/provider/bootstrap-provider.ts',
      'src/config/provider/db-provider.ts',
      'src/config/provider/file-provider.ts',
      'src/config/schemas/bootstrap-schema.ts',
      'src/config/schemas/schema.ts',
      'src/config/types.ts',
      'src/config/validation/persistence-validator.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed tenant context and bootstrap contracts at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/multi-tenancy/master-tenant-bootstrap.ts',
      'src/multi-tenancy/redis-key.ts',
      'src/multi-tenancy/tenant-context.ts',
      'src/multi-tenancy/tenant-issuer.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed redirect and session security boundaries at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/utils/redirect-authority.ts',
      'src/utils/session.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed Management API primitives at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/api/v1/errors.ts',
      'src/api/v1/response.ts',
      'src/api/v1/scopes.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed Management API validators at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/api/v1/validators/audit.validator.ts',
      'src/api/v1/validators/clients.validator.ts',
      'src/api/v1/validators/jwks.validator.ts',
      'src/api/v1/validators/registration-tokens.validator.ts',
      'src/api/v1/validators/sessions.validator.ts',
      'src/api/v1/validators/tenants.validator.ts',
      'src/api/v1/validators/users.validator.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed Management API route factories at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/api/v1/routes/index.ts',
      'src/api/v1/routes/audit.routes.ts',
      'src/api/v1/routes/clients.routes.ts',
      'src/api/v1/routes/jwks.routes.ts',
      'src/api/v1/routes/registration-tokens.routes.ts',
      'src/api/v1/routes/sessions.routes.ts',
      'src/api/v1/routes/stats.routes.ts',
      'src/api/v1/routes/tenants.routes.ts',
      'src/api/v1/routes/users.routes.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed Management API authentication, abuse-control, session, and tenant boundaries at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/api/v1/controllers/audit.controller.ts',
      'src/api/v1/controllers/clients.controller.ts',
      'src/api/v1/controllers/jwks.controller.ts',
      'src/api/v1/controllers/registration-tokens.controller.ts',
      'src/api/v1/controllers/sessions.controller.ts',
      'src/api/v1/controllers/stats.controller.ts',
      'src/api/v1/controllers/tenants.controller.ts',
      'src/api/v1/controllers/users.controller.ts',
      'src/api/v1/middleware/audit-logger.middleware.ts',
      'src/api/v1/middleware/error-handler.middleware.ts',
      'src/api/v1/middleware/jwt-auth.middleware.ts',
      'src/api/v1/middleware/rate-limiter.middleware.ts',
      'src/api/v1/middleware/scope-guard.middleware.ts',
      'src/api/v1/middleware/validate-body.middleware.ts',
      'src/api/v1/middleware/validate-query.middleware.ts',
      'src/api/v1/pagination.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed admin controllers at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/controllers/admin/activity.controller.ts',
      'src/controllers/admin/configuration.controller.ts',
      'src/controllers/admin/data-transfer.controller.ts',
      'src/controllers/admin/grant.controller.ts',
      'src/controllers/admin/home.controller.ts',
      'src/controllers/admin/jwks.controller.ts',
      'src/controllers/admin/oidc-client.controller.ts',
      'src/controllers/admin/platform.controller.ts',
      'src/controllers/admin/session.controller.ts',
      'src/controllers/admin/settings.controller.ts',
      'src/controllers/admin/user.controller.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps completed public controllers at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    expect(thresholds['src/controllers/webauthn.controller.ts']).toEqual({
      100: true,
    });
  });

  it('keeps the completed account controller at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    expect(thresholds['src/controllers/account.controller.ts']).toEqual({
      100: true,
    });
  });

  it('keeps completed UI route factories at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/routes/accounts.ts',
      'src/routes/admin.ts',
      'src/routes/auth.ts',
      'src/routes/index.ts',
      'src/routes/media.ts',
      'src/routes/ops.ts',
      'src/routes/webauthn.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });

  it('keeps the completed application composition root at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    expect(thresholds['src/app.ts']).toEqual({ 100: true });
  });

  it('keeps the completed server process entrypoint at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    expect(thresholds['src/index.ts']).toEqual({ 100: true });
  });

  it('keeps completed browser assets at 100%', () => {
    const thresholds = vitestConfig.test?.coverage?.thresholds as Record<
      string,
      unknown
    >;

    for (const filePath of [
      'src/assets/js/flash.ts',
      'src/assets/js/auth/oidc/consent.ts',
      'src/assets/js/admin/configuration/features.ts',
      'src/assets/js/admin/configuration/integrations.ts',
      'src/assets/js/admin/configuration/oidc-ttl.ts',
      'src/assets/js/admin/configuration/security.ts',
      'src/assets/js/admin/configuration/tenant-custom-identifiers.ts',
      'src/assets/js/admin/settings/custom-identifiers.ts',
      'src/assets/js/auth/account-recovery.ts',
      'src/assets/js/auth/email-verification.ts',
      'src/assets/js/auth/forgot-password.ts',
      'src/assets/js/auth/login.ts',
      'src/assets/js/auth/logout.ts',
      'src/assets/js/auth/mfa-verify.ts',
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
      'src/assets/js/admin/configuration/common.ts',
      'src/assets/js/admin/data-transfer/data-transfer.ts',
      'src/assets/js/admin/layout.ts',
      'src/assets/js/admin/oidc-clients.ts',
      'src/assets/js/admin/oidc-clients/form.ts',
      'src/assets/js/admin/users.ts',
      'src/assets/js/admin/users/form.ts',
      'src/assets/js/admin/users/activities.ts',
      'src/assets/js/admin/users/data-mgmt.ts',
      'src/assets/js/main.ts',
      'src/assets/js/user.ts',
      'src/assets/js/utils/dialog.ts',
      'src/assets/js/utils/file-upload.ts',
      'src/assets/js/utils/form-helpers.ts',
      'src/assets/js/utils/tooltip.ts',
      'src/assets/js/webauthn/authenticate.ts',
      'src/assets/js/webauthn/register.ts',
      'src/assets/js/sw/register.ts',
      'src/assets/js/sw/service-worker.ts',
      'src/assets/js/vendor/alpine.ts',
      'src/assets/js/vendor/fingerprintjs.ts',
      'src/assets/js/vendor/lucide.ts',
      'src/assets/js/admin/activities/index.ts',
      'src/assets/js/admin/configuration/custom-identifiers.ts',
      'src/assets/js/admin/configuration/validation.ts',
      'src/assets/js/admin/grants/index.ts',
      'src/assets/js/admin/jwks.ts',
      'src/assets/js/admin/sessions/index.ts',
      'src/assets/js/account/apps.ts',
      'src/assets/js/account/layout.ts',
      'src/assets/js/account/recovery-codes.ts',
      'src/assets/js/account/sessions.ts',
      'src/assets/js/account/settings/avatar.ts',
      'src/assets/js/account/settings/confirm-handler.ts',
      'src/assets/js/account/settings/index.ts',
      'src/assets/js/account/settings/language.ts',
      'src/assets/js/account/settings/mfa.ts',
      'src/assets/js/account/settings/passkeys.ts',
      'src/assets/js/account/settings/password.ts',
      'src/assets/js/account/settings/password-visibility.ts',
      'src/assets/js/admin/settings.ts',
      'src/assets/js/admin/settings/application.ts',
      'src/assets/js/admin/settings/branding.ts',
      'src/assets/js/admin/settings/common.ts',
      'src/assets/js/admin/settings/deployment.ts',
      'src/assets/js/admin/settings/features.ts',
      'src/assets/js/admin/settings/import.ts',
      'src/assets/js/admin/settings/integrations.ts',
      'src/assets/js/admin/settings/oidc.ts',
      'src/assets/js/admin/settings/overview.ts',
      'src/assets/js/admin/settings/security.ts',
    ]) {
      expect(thresholds[filePath]).toEqual({ 100: true });
    }
  });
});
