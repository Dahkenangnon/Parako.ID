import { describe, expect, it } from 'vitest';

import { mongoFixtureDocumentId } from '../../../e2e/support/parako-instance.mjs';

describe('Parako disposable instance support', () => {
  it('uses the logical Mongo document ID for the default tenant', () => {
    expect(mongoFixtureDocumentId('default', 'client-a')).toBe('client-a');
  });

  it('prefixes Mongo document IDs for non-default tenant isolation', () => {
    expect(mongoFixtureDocumentId('tenant-a', 'client-a')).toBe(
      '8:tenant-a:client-a'
    );
  });
});
