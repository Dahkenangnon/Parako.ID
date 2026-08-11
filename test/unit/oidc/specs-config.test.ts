import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errors } from 'oidc-provider';

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import AcceptQueryParamAccessToken from '../../../src/oidc/specs/accept-query-param-access-token.js';
import AcrValues from '../../../src/oidc/specs/acr-value.js';
import AllowOmittingSingleRegisteredRedirectUri from '../../../src/oidc/specs/allow-omitting-single-registered-redirect-uri.js';
import Claims from '../../../src/oidc/specs/claims.js';
import ClockTolerance from '../../../src/oidc/specs/clock-tolerance.js';
import ConformIdTokenClaims from '../../../src/oidc/specs/conform-id-token-claims.js';
import Cookies from '../../../src/oidc/specs/cookies.js';
import Discovery from '../../../src/oidc/specs/discovery.js';
import EnableHttpPostMethod from '../../../src/oidc/specs/enable-http-post-method.js';
import EnabledJWA from '../../../src/oidc/specs/enabled-jwa.js';
import ExtraClientMetadata from '../../../src/oidc/specs/extra-client-metadata.js';
import ExtraParams from '../../../src/oidc/specs/extra-param.js';
import ExtraTokenClaims from '../../../src/oidc/specs/extra-token-claims.js';
import BackchannelLogout from '../../../src/oidc/specs/feature/backchannel-logout.js';
import ClientCredential from '../../../src/oidc/specs/feature/client-credential.js';
import DevInteraction from '../../../src/oidc/specs/feature/dev-interaction.js';
import Introspection from '../../../src/oidc/specs/feature/introspection.js';
import JWTIntrospection from '../../../src/oidc/specs/feature/jwt-introspection.js';
import RegistrationManagement from '../../../src/oidc/specs/feature/registration-management.js';
import Revocation from '../../../src/oidc/specs/feature/revocation.js';
import UserInfo from '../../../src/oidc/specs/feature/user-info.js';
import Client from '../../../src/oidc/specs/client.js';
import Routes from '../../../src/oidc/specs/route.js';
import Scopes from '../../../src/oidc/specs/scopes.js';
import SubjectTypes from '../../../src/oidc/specs/subject-type.js';

describe('OIDC provider specification configuration', () => {
  let config: ReturnType<typeof getDefaultFullConfig>;
  let configManager: { getConfig: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    config = getDefaultFullConfig();
    configManager = { getConfig: vi.fn(() => config) };
  });

  it('uses the documented snake-case redirect omission setting', () => {
    config.features.oidc.allow_omitting_single_registered_redirect_uri = false;
    config.features.oidc.allowOmittingSingleRegisteredRedirectUri = true;

    expect(AllowOmittingSingleRegisteredRedirectUri(configManager as any)).toBe(
      false
    );
  });

  it('keeps the legacy redirect omission setting as a compatibility fallback', () => {
    config.features.oidc.allow_omitting_single_registered_redirect_uri =
      undefined as any;
    config.features.oidc.allowOmittingSingleRegisteredRedirectUri = false;

    expect(AllowOmittingSingleRegisteredRedirectUri(configManager as any)).toBe(
      false
    );
  });

  it('maps scalar provider options from runtime configuration', () => {
    config.features.oidc.accept_query_param_access_tokens = false;
    config.features.oidc.clock_tolerance = 42;
    config.features.oidc.conform_id_token_claims = true;
    config.features.oidc.enable_http_post_methods = true;

    expect(AcceptQueryParamAccessToken(configManager as any)).toBe(false);
    expect(ClockTolerance(configManager as any)).toBe(42);
    expect(ConformIdTokenClaims(configManager as any)).toBe(true);
    expect(EnableHttpPostMethod(configManager as any)).toBe(true);
  });

  it('maps claims, scopes, subject types, and cookie signing keys', () => {
    const claims = { openid: ['sub'], custom: ['tenant_id'] };
    const scopes = ['openid', 'custom'];
    const subjectTypes = ['pairwise'] as const;
    const cookieSecrets = ['current-secret', 'previous-secret'];
    config.features.oidc.claims = claims;
    config.features.oidc.scopes = scopes;
    config.features.oidc.subject_types = [...subjectTypes];
    config.security.secrets.cookie_secrets = cookieSecrets;

    expect(Claims(configManager as any)).toBe(claims);
    expect(Scopes(configManager as any)).toBe(scopes);
    expect(SubjectTypes(configManager as any)).toEqual(subjectTypes);
    expect(Cookies(configManager as any)).toEqual({ keys: cookieSecrets });
  });

  it('uses SameSite=None for provider cookies when HTTP POST endpoints are enabled', () => {
    config.features.oidc.enable_http_post_methods = true;

    expect(Cookies(configManager as any)).toEqual({
      keys: config.security.secrets.cookie_secrets,
      long: { sameSite: 'none' },
    });
  });

  it('includes baseline ACR values once and preserves configured order', () => {
    config.features.oidc.acr_values.supported = [
      'urn:mfa:otp',
      'urn:mfa:webauthn',
      'urn:pwd',
    ];

    expect(AcrValues(configManager as any)).toEqual([
      'urn:pwd',
      'urn:mfa:otp',
      'urn:mfa:webauthn',
    ]);
  });

  it('maps every supported JWA family without renaming configured values', () => {
    const jwa = config.oidc.jwa;

    expect(EnabledJWA(configManager as any)).toEqual({
      authorizationEncryptionAlgValues: jwa.authorization_encryption_alg_values,
      authorizationEncryptionEncValues: jwa.authorization_encryption_enc_values,
      authorizationSigningAlgValues: jwa.authorization_signing_alg_values,
      clientAuthSigningAlgValues: jwa.client_auth_signing_alg_values,
      dPoPSigningAlgValues: jwa.dpop_signing_alg_values,
      idTokenEncryptionAlgValues: jwa.id_token_encryption_alg_values,
      idTokenEncryptionEncValues: jwa.id_token_encryption_enc_values,
      idTokenSigningAlgValues: jwa.id_token_signing_alg_values,
      introspectionEncryptionAlgValues: jwa.introspection_encryption_alg_values,
      introspectionEncryptionEncValues: jwa.introspection_encryption_enc_values,
      introspectionSigningAlgValues: jwa.introspection_signing_alg_values,
      requestObjectEncryptionAlgValues:
        jwa.request_object_encryption_alg_values,
      requestObjectEncryptionEncValues:
        jwa.request_object_encryption_enc_values,
      requestObjectSigningAlgValues: jwa.request_object_signing_alg_values,
      userinfoEncryptionAlgValues: jwa.userinfo_encryption_alg_values,
      userinfoEncryptionEncValues: jwa.userinfo_encryption_enc_values,
      userinfoSigningAlgValues: jwa.userinfo_signing_alg_values,
    });
  });

  it('extends discovery metadata with the application locale allowlist', () => {
    config.oidc.discovery = {
      service_documentation: 'https://docs.example.test',
      ui_locales_supported: ['stale-locale'],
    } as any;
    config.application.locales.available = ['en', 'fr'];

    expect(Discovery(configManager as any)).toEqual({
      service_documentation: 'https://docs.example.test',
      ui_locales_supported: ['en', 'fr'],
    });
  });

  it('maps every configured provider endpoint route', () => {
    const routes = config.oidc.routes;

    expect(Routes(configManager as any)).toEqual({
      authorization: routes.authorization,
      userinfo: routes.userinfo,
      registration: routes.registration,
      backchannel_authentication: routes.backchannel_authentication,
      challenge: routes.challenge,
      code_verification: routes.code_verification,
      device_authorization: routes.device_authorization,
      end_session: routes.end_session,
      introspection: routes.introspection,
      jwks: routes.jwks,
      pushed_authorization_request: routes.pushed_authorization_request,
      revocation: routes.revocation,
      token: routes.token,
    });
  });

  it('delegates provider client assembly to the client merger', () => {
    const mergedClients = [{ client_id: 'configured-client' }];
    const clientMerger = {
      mergeClients: vi.fn(() => mergedClients),
    };

    expect(Client(clientMerger as any)).toBe(mergedClients);
    expect(clientMerger.mergeClients).toHaveBeenCalledWith([]);
  });

  it('exposes only configured extra parameters and client metadata names', () => {
    const allowedParams = ['tenant_id', 'continue'];
    const properties = ['allowedResources', 'isInternalClient'];
    config.features.oidc.extra_params.allowed_params = allowedParams;
    config.features.oidc.extra_client_metadata = { properties };

    expect(ExtraParams(configManager as any)).toBe(allowedParams);

    const metadata = ExtraClientMetadata(configManager as any);
    const accumulated = { client_id: 'client' } as any;
    expect(metadata.properties).toEqual([...properties, 'ttl']);
    expect(properties).toEqual(['allowedResources', 'isInternalClient']);
    expect(
      metadata.validator({} as any, 'isInternalClient', true, accumulated)
    ).toBeUndefined();
    expect(accumulated).toEqual({ client_id: 'client' });
  });

  it('registers and accepts supported positive per-client TTL overrides', () => {
    const metadata = ExtraClientMetadata(configManager as any);
    const ttl = {
      AccessToken: 60,
      BackchannelAuthenticationRequest: 90,
      ClientCredentials: 120,
      RefreshToken: 180,
    };

    expect(metadata.properties).toContain('ttl');
    expect(() =>
      metadata.validator({} as any, 'ttl', ttl, { ttl } as any)
    ).not.toThrow();
  });

  it('accepts omitted TTL metadata and always exposes the required property', () => {
    config.features.oidc.extra_client_metadata = undefined as never;
    const metadata = ExtraClientMetadata(configManager as any);

    expect(metadata.properties).toEqual(['ttl']);
    expect(() =>
      metadata.validator({} as any, 'ttl', undefined, {} as any)
    ).not.toThrow();
  });

  it.each([
    null,
    [],
    { UnsupportedArtifact: 60 },
    { ClientCredentials: 0 },
    { ClientCredentials: -1 },
    { ClientCredentials: 1.5 },
    { ClientCredentials: Number.POSITIVE_INFINITY },
    { ClientCredentials: '60' },
  ])('rejects unsafe per-client TTL metadata %j', ttl => {
    const metadata = ExtraClientMetadata(configManager as any);

    expect(() =>
      metadata.validator({} as any, 'ttl', ttl, { ttl } as any)
    ).toThrow(errors.InvalidClientMetadata);
  });

  it('does not expose extra authorization parameters when disabled', () => {
    config.features.oidc.extra_params.enabled = false;
    config.features.oidc.extra_params.allowed_params = ['tenant_id'];

    expect(ExtraParams(configManager as any)).toEqual([]);
  });

  it('does not add undocumented placeholder claims to every access token', async () => {
    const extraTokenClaims = ExtraTokenClaims();

    await expect(extraTokenClaims({} as any, {})).resolves.toEqual({});
  });

  it('maps simple OIDC feature toggles', () => {
    config.features.oidc.client_credentials.enabled = false;
    config.features.oidc.dev_interactions.enabled = true;
    config.features.oidc.jwt_introspection.enabled = true;
    config.features.oidc.backchannel_logout.enabled = false;
    config.features.oidc.token_revocation.enabled = false;
    config.features.oidc.userinfo_endpoint.enabled = false;

    expect(ClientCredential(configManager as any)).toEqual({ enabled: false });
    expect(DevInteraction(configManager as any)).toEqual({ enabled: true });
    expect(JWTIntrospection(configManager as any)).toEqual({ enabled: true });
    expect(BackchannelLogout(configManager as any)).toEqual({ enabled: false });
    expect(Revocation(configManager as any).enabled).toBe(false);
    expect(UserInfo(configManager as any)).toEqual({ enabled: false });
  });

  it('maps dynamic registration-management behavior', () => {
    config.features.oidc.client_registration_management = {
      enabled: true,
      rotate_registration_access_token: false,
    };

    expect(RegistrationManagement(configManager as any)).toEqual({
      enabled: true,
      rotateRegistrationAccessToken: false,
    });
  });

  it('prevents a public client from introspecting another client token', () => {
    const introspection = Introspection(configManager as any);
    const ctx = { oidc: { client: { clientId: 'requesting-client' } } } as any;
    const publicClient = {
      clientAuthMethod: 'none',
    } as any;

    expect(introspection.enabled).toBe(
      config.features.oidc.token_introspection.enabled
    );
    expect(
      introspection.allowedPolicy(ctx, publicClient, {
        clientId: 'other-client',
      })
    ).toBe(false);
    expect(
      introspection.allowedPolicy(ctx, publicClient, {
        clientId: 'requesting-client',
      })
    ).toBe(true);
  });

  it('allows authenticated or unresolved clients through introspection policy', () => {
    const introspection = Introspection(configManager as any);
    const ctx = { oidc: { client: { clientId: 'requesting-client' } } } as any;

    expect(
      introspection.allowedPolicy(
        ctx,
        { clientAuthMethod: 'client_secret_basic' } as any,
        undefined
      )
    ).toBe(true);
    expect(introspection.allowedPolicy(ctx, undefined, undefined)).toBe(true);
  });

  it('allows a client to revoke its own token', () => {
    const revocation = Revocation(configManager as any);

    expect(revocation.enabled).toBe(
      config.features.oidc.token_revocation.enabled
    );
    expect(
      revocation.allowedPolicy(
        {} as any,
        { clientId: 'requesting-client', clientAuthMethod: 'none' } as any,
        { clientId: 'requesting-client' } as any
      )
    ).toBe(true);
  });

  it('silently rejects public cross-client revocation to prevent token guessing', () => {
    const revocation = Revocation(configManager as any);

    expect(
      revocation.allowedPolicy(
        {} as any,
        { clientId: 'requesting-client', clientAuthMethod: 'none' } as any,
        { clientId: 'other-client' } as any
      )
    ).toBe(false);
  });

  it('rejects authenticated cross-client revocation', () => {
    const revocation = Revocation(configManager as any);

    expect(() =>
      revocation.allowedPolicy(
        {} as any,
        {
          clientId: 'requesting-client',
          clientAuthMethod: 'client_secret_basic',
        } as any,
        { clientId: 'other-client' } as any
      )
    ).toThrowError(
      new errors.InvalidRequest(
        'client is not authorized to revoke the presented token'
      )
    );
  });
});
