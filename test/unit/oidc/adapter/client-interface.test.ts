import { describe, expect, it } from 'vitest';

import {
  APP_TYPE_PRESETS,
  AUTH_METHODS,
  CLIENT_DEFAULTS,
  clientAuthMethodUsesSecret,
  GRANT_TYPES,
  RESPONSE_TYPES,
  SIGNING_ALGORITHMS,
  SUBJECT_TYPES,
} from '../../../../src/oidc/adapter/client.interface.js';

function valuesAreUnique(options: ReadonlyArray<{ value: string }>): boolean {
  const values = options.map(({ value }) => value);
  return new Set(values).size === values.length;
}

describe('OIDC client metadata contracts', () => {
  it('identifies only client-secret token endpoint authentication methods as secret based', () => {
    expect(clientAuthMethodUsesSecret(undefined)).toBe(true);
    expect(clientAuthMethodUsesSecret('client_secret_basic')).toBe(true);
    expect(clientAuthMethodUsesSecret('client_secret_post')).toBe(true);
    expect(clientAuthMethodUsesSecret('client_secret_jwt')).toBe(true);
    expect(clientAuthMethodUsesSecret('none')).toBe(false);
    expect(clientAuthMethodUsesSecret('private_key_jwt')).toBe(false);
  });

  it('uses conservative defaults for confidential authorization-code clients', () => {
    expect(CLIENT_DEFAULTS).toEqual({
      application_type: 'web',
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['authorization_code'],
      response_types: ['code'],
      active: true,
      require_pkce: false,
      tags: [],
      contacts: [],
      isInternalClient: false,
    });
  });

  it('requires PKCE and no client secret for browser and native public clients', () => {
    for (const preset of [APP_TYPE_PRESETS.spa, APP_TYPE_PRESETS.native]) {
      expect(preset).toMatchObject({
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        require_pkce: true,
        scope: 'openid profile email',
      });
    }
    expect(APP_TYPE_PRESETS.spa.application_type).toBe('web');
    expect(APP_TYPE_PRESETS.native.application_type).toBe('native');
  });

  it('uses non-interactive grants for service, device, and management clients', () => {
    expect(APP_TYPE_PRESETS.m2m).toMatchObject({
      application_type: 'web',
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['client_credentials'],
      response_types: [],
      require_pkce: false,
      scope: '',
    });
    expect(APP_TYPE_PRESETS.device).toMatchObject({
      application_type: 'native',
      token_endpoint_auth_method: 'client_secret_post',
      grant_types: ['urn:ietf:params:oauth:grant-type:device_code'],
      response_types: [],
      require_pkce: false,
      scope: 'openid profile email offline_access',
    });
    expect(APP_TYPE_PRESETS.api_management).toMatchObject({
      application_type: 'web',
      token_endpoint_auth_method: 'client_secret_basic',
      grant_types: ['client_credentials'],
      response_types: [],
      allowedResources: ['urn:parako:api:v1'],
    });
  });

  it('keeps option values unique and recommendations explicit', () => {
    for (const options of [
      SIGNING_ALGORITHMS,
      SUBJECT_TYPES,
      GRANT_TYPES,
      RESPONSE_TYPES,
      AUTH_METHODS,
    ]) {
      expect(valuesAreUnique(options)).toBe(true);
    }

    expect(SIGNING_ALGORITHMS[0]).toEqual({
      value: '',
      label: 'Provider Default (RS256)',
    });
    expect(SUBJECT_TYPES.map(({ value }) => value)).toEqual([
      'public',
      'pairwise',
    ]);
    expect(
      GRANT_TYPES.filter(({ recommended }) => recommended).map(
        ({ value }) => value
      )
    ).toEqual(['authorization_code', 'refresh_token']);
    expect(
      RESPONSE_TYPES.filter(({ recommended }) => recommended).map(
        ({ value }) => value
      )
    ).toEqual(['code']);
    expect(
      AUTH_METHODS.filter(({ recommended }) => recommended).map(
        ({ value }) => value
      )
    ).toEqual(['client_secret_basic']);
  });
});
