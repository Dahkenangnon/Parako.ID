import { describe, expect, it, vi } from 'vitest';

import { getDefaultFullConfig } from '../../../src/config/constants.js';
import createFeatures from '../../../src/oidc/specs/feature.js';

describe('OIDC feature composition', () => {
  it('assembles every provider feature from runtime configuration', () => {
    const config = getDefaultFullConfig();
    const configManager = { getConfig: vi.fn(() => config) };
    const viewResolver = {
      views: {
        auth: {
          oidc: {
            device_flow_code_input: 'device-code-input',
            device_flow_confirm_code: 'device-code-confirm',
            device_flow_success: 'device-flow-success',
            logout: 'logout',
            post_logout_success: 'post-logout-success',
          },
        },
      },
    };
    const oidcUtils = {
      getLocale: vi.fn(() => 'en'),
      getCspNonce: vi.fn(() => 'nonce'),
      translate: vi.fn((key: string) => key),
    };
    const resourceIndicators = { enabled: true, marker: 'resource-policy' };

    const features = createFeatures(
      configManager as never,
      {} as never,
      viewResolver as never,
      oidcUtils as never,
      resourceIndicators
    );

    expect(Object.keys(features)).toEqual([
      'devInteractions',
      'deviceFlow',
      'backchannelLogout',
      'revocation',
      'clientCredentials',
      'userinfo',
      'introspection',
      'resourceIndicators',
      'jwtIntrospection',
      'registration',
      'registrationManagement',
      'rpInitiatedLogout',
      'encryption',
      'jwtResponseModes',
      'jwtUserinfo',
      'requestObjects',
    ]);
    expect(features.resourceIndicators).toBe(resourceIndicators);
    expect(features).toMatchObject({
      encryption: { enabled: config.features.oidc.encryption.enabled },
      jwtResponseModes: {
        enabled: config.features.oidc.jwt_response_modes.enabled,
      },
      jwtUserinfo: { enabled: config.features.oidc.jwt_userinfo.enabled },
      requestObjects: {
        enabled: config.features.oidc.request_objects.enabled,
      },
    });
    expect(features.deviceFlow).toMatchObject({
      enabled: config.features.oidc.device_flow.enabled,
      charset: config.features.oidc.device_flow.charset,
      mask: config.features.oidc.device_flow.mask,
    });
    expect(features.rpInitiatedLogout).toMatchObject({
      enabled: config.features.oidc.rp_initiated_logout.enabled,
    });
  });
});
