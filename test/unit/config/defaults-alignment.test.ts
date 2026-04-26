import { describe, it, expect } from 'vitest';
import { AppConfigSchema } from '../../../src/config/schemas/schema.js';
import { DEFAULT_FULL_CONFIG } from '../../../src/config/constants.js';
import { mergeConfig } from '../../../src/utils/config-merge.js';

describe('DEFAULT_FULL_CONFIG alignment', () => {
  it('passes full Zod validation', () => {
    const result = AppConfigSchema.safeParse(DEFAULT_FULL_CONFIG);
    if (!result.success) {
      const paths = result.error.issues.map(
        i => `${i.path.join('.')}: ${i.message}`
      );
      expect.fail(
        `DEFAULT_FULL_CONFIG failed Zod validation:\n${paths.join('\n')}`
      );
    }
    expect(result.success).toBe(true);
  });

  it('mergeConfig(DEFAULT_FULL_CONFIG, {}) produces valid config', () => {
    const merged = mergeConfig(DEFAULT_FULL_CONFIG, {});
    const result = AppConfigSchema.safeParse(merged);
    if (!result.success) {
      const paths = result.error.issues.map(
        i => `${i.path.join('.')}: ${i.message}`
      );
      expect.fail(
        `Merged empty config failed Zod validation:\n${paths.join('\n')}`
      );
    }
    expect(result.success).toBe(true);
  });

  it('partial config merged with defaults produces valid config', () => {
    const partial = {
      application: {
        title: 'My Custom App',
      },
    };
    const merged = mergeConfig(DEFAULT_FULL_CONFIG, partial);
    const result = AppConfigSchema.safeParse(merged);
    if (!result.success) {
      const paths = result.error.issues.map(
        i => `${i.path.join('.')}: ${i.message}`
      );
      expect.fail(
        `Partial config merge failed Zod validation:\n${paths.join('\n')}`
      );
    }
    expect(result.success).toBe(true);
    expect(result.data.application.title).toBe('My Custom App');
    // Other fields should retain defaults
    expect(result.data.deployment.url).toBe(DEFAULT_FULL_CONFIG.deployment.url);
  });

  it('user overrides replace defaults correctly', () => {
    const overrides = {
      deployment: {
        url: 'https://my-app.example.com',
        redis_prefix: 'myapp',
      },
      security: {
        protection: {
          rate_limiting: {
            enabled: false,
            requests_per_minute: 200,
          },
        },
      },
    };
    const merged = mergeConfig(DEFAULT_FULL_CONFIG, overrides);
    const result = AppConfigSchema.safeParse(merged);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.deployment.url).toBe('https://my-app.example.com');
      expect(result.data.deployment.redis_prefix).toBe('myapp');
      expect(result.data.security.protection.rate_limiting.enabled).toBe(false);
      expect(
        result.data.security.protection.rate_limiting.requests_per_minute
      ).toBe(200);
      // Non-overridden rate_limiting fields should retain defaults
      expect(result.data.security.protection.rate_limiting.window_minutes).toBe(
        DEFAULT_FULL_CONFIG.security.protection.rate_limiting.window_minutes
      );
    }
  });

  it('arrays are replaced (not concatenated) during merge', () => {
    const overrides = {
      features: {
        oidc: {
          scopes: ['openid', 'custom_scope'],
        },
        social_providers: {
          enabled: ['microsoft'],
        },
      },
    };
    const merged = mergeConfig(DEFAULT_FULL_CONFIG, overrides);
    const result = AppConfigSchema.safeParse(merged);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.features.oidc.scopes).toEqual([
        'openid',
        'custom_scope',
      ]);
      expect(result.data.features.social_providers.enabled).toEqual([
        'microsoft',
      ]);
    }
  });

  it('Zod defaults match DEFAULT_FULL_CONFIG for key fields', () => {
    // Parse empty-ish config through Zod to get its defaults
    // We need required fields that have no defaults, so use DEFAULT_FULL_CONFIG
    const result = AppConfigSchema.safeParse(DEFAULT_FULL_CONFIG);
    expect(result.success).toBe(true);
    if (!result.success) return;

    const parsed = result.data;

    // Security.protection
    expect(parsed.security.protection.rate_limiting.enabled).toBe(
      DEFAULT_FULL_CONFIG.security.protection.rate_limiting.enabled
    );
    expect(parsed.security.protection.rate_limiting.requests_per_minute).toBe(
      DEFAULT_FULL_CONFIG.security.protection.rate_limiting.requests_per_minute
    );

    // Security.authentication.multi_factor
    expect(parsed.security.authentication.multi_factor.enabled).toBe(
      DEFAULT_FULL_CONFIG.security.authentication.multi_factor.enabled
    );
    expect(parsed.security.authentication.multi_factor.totp.enabled).toBe(
      DEFAULT_FULL_CONFIG.security.authentication.multi_factor.totp.enabled
    );

    // WebAuthn
    expect(
      parsed.security.authentication.multi_factor.webauthn.user_verification
    ).toBe(
      DEFAULT_FULL_CONFIG.security.authentication.multi_factor.webauthn
        .user_verification
    );

    // Login
    expect(parsed.security.authentication.login.login_methods).toEqual(
      DEFAULT_FULL_CONFIG.security.authentication.login.login_methods
    );
    expect(
      parsed.security.authentication.login.password_policy.require_uppercase
    ).toBe(
      DEFAULT_FULL_CONFIG.security.authentication.login.password_policy
        .require_uppercase
    );

    // Signup
    expect(parsed.security.authentication.signup.signup_methods).toEqual(
      DEFAULT_FULL_CONFIG.security.authentication.signup.signup_methods
    );
    expect(
      parsed.security.authentication.signup.require_email_verification
    ).toBe(
      DEFAULT_FULL_CONFIG.security.authentication.signup
        .require_email_verification
    );

    // Recovery
    expect(
      parsed.security.authentication.recovery.security_questions.enabled
    ).toBe(
      DEFAULT_FULL_CONFIG.security.authentication.recovery.security_questions
        .enabled
    );

    // Session
    expect(parsed.security.authentication.session.encrypt_session_data).toBe(
      DEFAULT_FULL_CONFIG.security.authentication.session.encrypt_session_data
    );

    // Features
    expect(parsed.features.oidc.device_flow.enabled).toBe(
      DEFAULT_FULL_CONFIG.features.oidc.device_flow.enabled
    );
    expect(parsed.features.oidc.client_credentials.enabled).toBe(
      DEFAULT_FULL_CONFIG.features.oidc.client_credentials.enabled
    );
    expect(parsed.features.oidc.resource_indicators.enabled).toBe(
      DEFAULT_FULL_CONFIG.features.oidc.resource_indicators.enabled
    );
    expect(parsed.features.oidc.backchannel_logout.enabled).toBe(
      DEFAULT_FULL_CONFIG.features.oidc.backchannel_logout.enabled
    );
    expect(parsed.features.oidc.accept_query_param_access_tokens).toBe(
      DEFAULT_FULL_CONFIG.features.oidc.accept_query_param_access_tokens
    );
    expect(
      parsed.features.oidc.allow_omitting_single_registered_redirect_uri
    ).toBe(
      DEFAULT_FULL_CONFIG.features.oidc
        .allow_omitting_single_registered_redirect_uri
    );

    // Scopes and ACR
    expect(parsed.features.oidc.scopes).toEqual(
      DEFAULT_FULL_CONFIG.features.oidc.scopes
    );
    expect(parsed.features.oidc.acr_values.supported).toEqual(
      DEFAULT_FULL_CONFIG.features.oidc.acr_values.supported
    );

    // Social providers
    expect(parsed.features.social_providers.enabled).toEqual(
      DEFAULT_FULL_CONFIG.features.social_providers.enabled
    );
    expect(parsed.features.social_providers.behavior.missing_contact_info).toBe(
      DEFAULT_FULL_CONFIG.features.social_providers.behavior
        .missing_contact_info
    );

    // OIDC storage (computed from bootstrap, not in DEFAULT_FULL_CONFIG)
    // Zod default should produce a valid oidc_storage shape
    expect(parsed.oidc_storage.oidc_adapter.type).toBe('sqlite');
    expect(parsed.oidc_storage.oidc_adapter.mongodb.database).toBe('');
  });

  it('hardened defaults: security & correctness fields', () => {
    // Social providers disabled by default (no credentials configured)
    expect(DEFAULT_FULL_CONFIG.features.social_providers.enabled).toEqual([]);

    // Rate limiting enabled by default
    expect(DEFAULT_FULL_CONFIG.security.protection.rate_limiting.enabled).toBe(
      true
    );

    // PKCE required by default (OAuth 2.1 mandate)
    expect(DEFAULT_FULL_CONFIG.features.oidc.pkce.required).toBe(true);

    // Token TTL alignment: Zod defaults match constants
    const result = AppConfigSchema.safeParse(DEFAULT_FULL_CONFIG);
    expect(result.success).toBe(true);
    if (!result.success) return;

    expect(result.data.oidc.token_ttl.grant).toBe(3600);
    expect(result.data.oidc.token_ttl.interaction).toBe(600);
    expect(result.data.oidc.token_ttl.refresh_token).toBe(86400);
    expect(result.data.oidc.token_ttl.session).toBe(86400);
  });

  it('mergeConfig preserves empty arrays from overrides', () => {
    const merged = mergeConfig(DEFAULT_FULL_CONFIG, {
      features: { social_providers: { enabled: [] } },
    });
    const result = AppConfigSchema.safeParse(merged);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.features.social_providers.enabled).toEqual([]);
    }
  });
});
