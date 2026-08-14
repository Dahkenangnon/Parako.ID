import { validateE2ePostgresqlUrl } from '../support/e2e-prerequisites.ts';

export const SELF_STARTING_SPECS = [
  'admin-user-configuration-profiles.spec.ts',
  'deployment-matrix-admission.spec.ts',
  'management-api-adapter-matrix.spec.ts',
  'management-api-tenants.spec.ts',
  'oidc-feature-adapter-matrix.spec.ts',
  'password-session-adapter-matrix.spec.ts',
  'platform-admin-adapter-matrix.spec.ts',
  'public-account-adapter-matrix.spec.ts',
  'public-health.spec.ts',
  'public-login-profiles.spec.ts',
  'tenant-resolution-adapter-matrix.spec.ts',
  'webauthn-adapter-matrix.spec.ts',
] as const;

const FEATURE_PROFILE_SPECS = [
  'admin-configuration.spec.ts',
  'ops-infrastructure.spec.ts',
  'account-notification-policy.spec.ts',
  'public-phone-verification.spec.ts',
  'public-security-question-recovery.spec.ts',
  'public-sms-recovery.spec.ts',
  'public-social-auth.spec.ts',
  'public-social-policy-max.spec.ts',
  'public-social-policy-restricted.spec.ts',
  'public-webauthn.spec.ts',
  'admin-data-import.spec.ts',
  'admin-jwks-scheduler.spec.ts',
  'worker-graceful-shutdown.spec.ts',
] as const;

export const E2E_CELL_IDS = [
  'sqlite-single',
  'mongodb-single',
  'mongodb-multi',
  'postgresql-single',
  'postgresql-multi',
] as const;

export type E2eCellId = (typeof E2E_CELL_IDS)[number];

export const E2E_PROFILE_IDS = [
  'default',
  'database-configuration',
  'notification-policy',
  'phone-verification',
  'security-questions',
  'sms-recovery',
  'social',
  'social-policy-max',
  'social-policy-restricted',
  'background-jobs',
  'worker-drain',
  'operations',
  'webauthn',
] as const;

export type E2eProfileId = (typeof E2E_PROFILE_IDS)[number];
export type E2eSelectionProfile = E2eProfileId | 'self-starting';

export interface E2eCell {
  id: E2eCellId;
  environment: Record<string, string>;
}

export interface E2eProfile {
  id: E2eProfileId;
  testMatch?: string[];
  testIgnore?: string[];
  environment: Record<string, string>;
}

export function resolveE2eCell(id: E2eCellId, postgresqlUrl?: string): E2eCell {
  const singleTenantOrigin = 'http://localhost:19007';
  const multiTenantOrigin = 'http://browser-e2e.idp.localhost:19007';
  const multiTenantDeployment = 'http://idp.localhost:19007';

  switch (id) {
    case 'sqlite-single':
      return {
        id: 'sqlite-single',
        environment: {
          PARAKO_E2E_STORAGE_ADAPTER: 'sqlite',
          PARAKO_E2E_MULTI_TENANCY: 'false',
          PARAKO_E2E_IDP_ORIGIN: singleTenantOrigin,
          PARAKO_E2E_DEPLOYMENT_URL: singleTenantOrigin,
        },
      };
    case 'mongodb-single':
      return {
        id: 'mongodb-single',
        environment: {
          PARAKO_E2E_STORAGE_ADAPTER: 'mongodb',
          PARAKO_E2E_MULTI_TENANCY: 'false',
          PARAKO_E2E_IDP_ORIGIN: singleTenantOrigin,
          PARAKO_E2E_DEPLOYMENT_URL: singleTenantOrigin,
        },
      };
    case 'mongodb-multi':
      return {
        id: 'mongodb-multi',
        environment: {
          PARAKO_E2E_STORAGE_ADAPTER: 'mongodb',
          PARAKO_E2E_MULTI_TENANCY: 'true',
          PARAKO_E2E_TENANT_ID: 'browser-e2e',
          PARAKO_E2E_IDP_ORIGIN: multiTenantOrigin,
          PARAKO_E2E_DEPLOYMENT_URL: multiTenantDeployment,
        },
      };
    case 'postgresql-single':
      return {
        id: 'postgresql-single',
        environment: {
          PARAKO_E2E_STORAGE_ADAPTER: 'postgresql',
          PARAKO_E2E_MULTI_TENANCY: 'false',
          PARAKO_E2E_POSTGRESQL_URL: validateE2ePostgresqlUrl(postgresqlUrl),
          PARAKO_E2E_IDP_ORIGIN: singleTenantOrigin,
          PARAKO_E2E_DEPLOYMENT_URL: singleTenantOrigin,
        },
      };
    case 'postgresql-multi':
      return {
        id: 'postgresql-multi',
        environment: {
          PARAKO_E2E_STORAGE_ADAPTER: 'postgresql',
          PARAKO_E2E_MULTI_TENANCY: 'true',
          PARAKO_E2E_POSTGRESQL_URL: validateE2ePostgresqlUrl(postgresqlUrl),
          PARAKO_E2E_TENANT_ID: 'browser-e2e',
          PARAKO_E2E_IDP_ORIGIN: multiTenantOrigin,
          PARAKO_E2E_DEPLOYMENT_URL: multiTenantDeployment,
        },
      };
  }
}

export const E2E_PROFILES: Record<E2eProfileId, E2eProfile> = {
  default: {
    id: 'default',
    testIgnore: [...SELF_STARTING_SPECS, ...FEATURE_PROFILE_SPECS],
    environment: {},
  },
  'database-configuration': {
    id: 'database-configuration',
    testMatch: ['admin-configuration.spec.ts'],
    environment: {
      PARAKO_E2E_DATABASE_CONFIG: 'true',
      PARAKO_E2E_SIBLING_TENANT_ID: 'browser-e2e-sibling',
    },
  },
  'notification-policy': {
    id: 'notification-policy',
    testMatch: ['account-notification-policy.spec.ts'],
    environment: { PARAKO_E2E_NOTIFICATION_PREFERENCES: 'false' },
  },
  'phone-verification': {
    id: 'phone-verification',
    testMatch: ['public-phone-verification.spec.ts'],
    environment: {
      PARAKO_E2E_SMS: 'true',
      PARAKO_E2E_SMS_REGISTRATION: 'true',
    },
  },
  'security-questions': {
    id: 'security-questions',
    testMatch: ['public-security-question-recovery.spec.ts'],
    environment: { PARAKO_E2E_SECURITY_QUESTIONS: 'true' },
  },
  'sms-recovery': {
    id: 'sms-recovery',
    testMatch: ['public-sms-recovery.spec.ts'],
    environment: { PARAKO_E2E_SMS: 'true' },
  },
  social: {
    id: 'social',
    testMatch: ['public-social-auth.spec.ts'],
    environment: {
      PARAKO_E2E_SOCIAL: 'true',
      PARAKO_E2E_SMS: 'true',
      PARAKO_E2E_SMS_REGISTRATION: 'true',
    },
  },
  'social-policy-max': {
    id: 'social-policy-max',
    testMatch: ['public-social-policy-max.spec.ts'],
    environment: {
      PARAKO_E2E_SOCIAL: 'true',
      PARAKO_E2E_SOCIAL_ALLOW_MULTIPLE: 'true',
      PARAKO_E2E_SOCIAL_MAX_PROVIDERS: '1',
    },
  },
  'social-policy-restricted': {
    id: 'social-policy-restricted',
    testMatch: ['public-social-policy-restricted.spec.ts'],
    environment: {
      PARAKO_E2E_SOCIAL: 'true',
      PARAKO_E2E_SOCIAL_EXISTING_USER_POLICY: 'auto_link',
      PARAKO_E2E_SOCIAL_NO_USER_POLICY: 'require_existing_account',
      PARAKO_E2E_SOCIAL_ALLOW_MULTIPLE: 'false',
    },
  },
  'background-jobs': {
    id: 'background-jobs',
    testMatch: ['admin-data-import.spec.ts', 'admin-jwks-scheduler.spec.ts'],
    environment: {
      PARAKO_E2E_BACKGROUND_JOBS: 'true',
      // SHA1 range for the deterministic managed-user fixture password. The
      // worker receives only the k-anonymous prefix/suffix, never plaintext.
      PARAKO_E2E_HIBP_PREFIX: 'AD3F7',
      PARAKO_E2E_HIBP_SUFFIX: 'ECDEA8AC30E95A4A9C7E6AEF792FF784AFA',
      PARAKO_E2E_HIBP_COUNT: '42',
    },
  },
  'worker-drain': {
    id: 'worker-drain',
    testMatch: ['worker-graceful-shutdown.spec.ts'],
    environment: {
      PARAKO_E2E_BACKGROUND_JOBS: 'true',
      PARAKO_E2E_WORKER_DRAIN: 'true',
      PARAKO_E2E_HIBP_PREFIX: 'AD3F7',
      PARAKO_E2E_HIBP_SUFFIX: 'ECDEA8AC30E95A4A9C7E6AEF792FF784AFA',
      PARAKO_E2E_HIBP_COUNT: '42',
      PARAKO_E2E_DRAIN_HIBP_PREFIX: 'ABCDE',
      PARAKO_E2E_DRAIN_HIBP_SUFFIX: 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
      PARAKO_E2E_DRAIN_HIBP_COUNT: '84',
    },
  },
  operations: {
    id: 'operations',
    testMatch: ['ops-infrastructure.spec.ts'],
    environment: {
      PARAKO_E2E_OPERATIONS: 'true',
      // gitleaks:allow -- deterministic HMAC key for an isolated local E2E gateway.
      PARAKO_E2E_HMAC_SECRET: 'parako-browser-e2e-ops-hmac-secret',
    },
  },
  webauthn: {
    id: 'webauthn',
    testMatch: ['public-webauthn.spec.ts'],
    environment: { PARAKO_E2E_WEBAUTHN: 'true' },
  },
};

export function parseE2eCellId(value: string | undefined): E2eCellId {
  const id = value ?? 'sqlite-single';
  if (!E2E_CELL_IDS.includes(id as E2eCellId)) {
    throw new Error(`Unknown PARAKO_E2E_CELL: ${id}`);
  }
  return id as E2eCellId;
}

export function parseE2eProfile(
  value: string | undefined
): E2eSelectionProfile {
  const id = value ?? 'default';
  if (id !== 'self-starting' && !E2E_PROFILE_IDS.includes(id as E2eProfileId)) {
    throw new Error(`Unknown PARAKO_E2E_PROFILE: ${id}`);
  }
  return id as E2eSelectionProfile;
}
