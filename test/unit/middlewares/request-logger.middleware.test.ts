import { describe, expect, it } from 'vitest';
import { redactSensitiveQueryParams } from '../../../src/middlewares/request-logger.middleware.js';

describe('request logger URL redaction', () => {
  it('redacts reset tokens while preserving safe query parameters', () => {
    expect(
      redactSensitiveQueryParams(
        '/auth/reset-password?token=secret-value&locale=fr'
      )
    ).toBe('/auth/reset-password?token=[REDACTED]&locale=fr');
  });

  it('redacts OAuth credentials case-insensitively', () => {
    expect(
      redactSensitiveQueryParams(
        '/callback?code=authorization-code&ACCESS_TOKEN=bearer-token&state=safe-state'
      )
    ).toBe(
      '/callback?code=[REDACTED]&ACCESS_TOKEN=[REDACTED]&state=safe-state'
    );
  });

  it('leaves URLs without sensitive query parameters unchanged', () => {
    expect(redactSensitiveQueryParams('/auth/login?locale=fr')).toBe(
      '/auth/login?locale=fr'
    );
  });
});
