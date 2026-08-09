import { describe, expect, it } from 'vitest';

import { getEnvironmentDefaults } from '../../../src/observability/logs/constants.js';

describe('logger environment defaults', () => {
  it.each(['development', 'production', 'staging', 'test'])(
    'redacts every OAuth token credential in %s',
    environment => {
      const defaults = getEnvironmentDefaults(environment);

      expect(defaults.security.logging.redaction.paths).toEqual(
        expect.arrayContaining([
          'token.access_token',
          'token.refresh_token',
          'token.authorization_code',
          'token.id_token',
          'token.device_code',
        ])
      );
    }
  );
});
