/**
 * Verifies the CORS schema and form-data migration in src/utils/settings.helper.ts.
 *
 * The runtime CORS layer is wired in src/app.ts and the cors package handles the
 * Vary: Origin emission. These tests focus on:
 *   - Zod schema accepting the new shape (string[]) and rejecting the old one (string).
 *   - The form-submission migrator splitting comma-separated strings into URL arrays.
 *   - The wildcard "*" being normalised to "no origin permitted" rather than
 *     silently passing through, since wildcard + credentials is forbidden by
 *     the Fetch spec.
 *     https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors/CORSNotSupportingCredentials
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AppConfigSchema } from '../../../src/config/schemas/schema.js';
import { convertDeploymentFormData } from '../../../src/utils/settings.helper.js';

const deploymentServerSchema = (AppConfigSchema as unknown as z.ZodObject<any>)
  .shape.deployment.shape.server;

describe('deployment.server schema — CORS realignment', () => {
  it('accepts a list of valid origin URLs', () => {
    const result = deploymentServerSchema.safeParse({
      allowed_origins: ['https://example.com', 'https://api.example.com:443'],
      dev_allowed_origins: ['http://localhost:9007'],
      trust_proxy_hops: 1,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a string in place of the array', () => {
    const result = deploymentServerSchema.safeParse({
      allowed_origins: 'https://example.com',
      dev_allowed_origins: [],
      trust_proxy_hops: 1,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid origin URLs in the allowlist', () => {
    const result = deploymentServerSchema.safeParse({
      allowed_origins: ['not a url'],
      dev_allowed_origins: [],
      trust_proxy_hops: 1,
    });
    expect(result.success).toBe(false);
  });

  it('defaults trust_proxy_hops to 1 and clamps via min/max', () => {
    const ok = deploymentServerSchema.safeParse({
      allowed_origins: [],
      dev_allowed_origins: [],
    });
    expect(ok.success).toBe(true);
    if (ok.success) {
      expect(ok.data.trust_proxy_hops).toBe(1);
    }

    const negative = deploymentServerSchema.safeParse({
      allowed_origins: [],
      dev_allowed_origins: [],
      trust_proxy_hops: -1,
    });
    expect(negative.success).toBe(false);

    const tooHigh = deploymentServerSchema.safeParse({
      allowed_origins: [],
      dev_allowed_origins: [],
      trust_proxy_hops: 99,
    });
    expect(tooHigh.success).toBe(false);
  });
});

describe('convertDeploymentFormData — backwards-compat migration', () => {
  it('splits a comma-separated allowed_origins string into an array', () => {
    const converted = convertDeploymentFormData({
      server: {
        allowed_origins: 'https://a.com, https://b.com',
        dev_allowed_origins: 'http://localhost:9007',
        trust_proxy_hops: '2',
      },
    });

    expect(converted.server.allowed_origins).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
    expect(converted.server.dev_allowed_origins).toEqual([
      'http://localhost:9007',
    ]);
    expect(converted.server.trust_proxy_hops).toBe(2);
  });

  it('normalises the legacy wildcard "*" to an empty array', () => {
    const converted = convertDeploymentFormData({
      server: { allowed_origins: '*' },
    });
    expect(converted.server.allowed_origins).toEqual([]);
  });

  it('migrates legacy proxy: boolean → trust_proxy_hops', () => {
    const enabled = convertDeploymentFormData({
      server: { proxy: true },
    });
    expect(enabled.server.trust_proxy_hops).toBe(1);
    expect(enabled.server.proxy).toBeUndefined();

    const disabled = convertDeploymentFormData({
      server: { proxy: false },
    });
    expect(disabled.server.trust_proxy_hops).toBe(0);
    expect(disabled.server.proxy).toBeUndefined();
  });

  it('passes pre-array values through unchanged', () => {
    const converted = convertDeploymentFormData({
      server: {
        allowed_origins: ['https://a.com'],
        dev_allowed_origins: ['http://localhost:5173'],
        trust_proxy_hops: 1,
      },
    });
    expect(converted.server.allowed_origins).toEqual(['https://a.com']);
    expect(converted.server.dev_allowed_origins).toEqual([
      'http://localhost:5173',
    ]);
    expect(converted.server.trust_proxy_hops).toBe(1);
  });
});
