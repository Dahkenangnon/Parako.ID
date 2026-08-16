import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'jsonc-parser';
import { describe, expect, it } from 'vitest';

const samplePath = fileURLToPath(
  new URL('../../../parako.sample.jsonc', import.meta.url)
);

describe('public configuration sample', () => {
  it('keeps access tokens out of query parameters by default', () => {
    const sample = parse(readFileSync(samplePath, 'utf8'));

    expect(sample.features.oidc.accept_query_param_access_tokens).toBe(false);
  });
});
