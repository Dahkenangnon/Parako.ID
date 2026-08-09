import { describe, expect, it } from 'vitest';

import { TYPES } from '../../../src/di/types.js';

describe('TYPES dependency identifiers', () => {
  it('exposes one stable global symbol keyed by each public identifier name', () => {
    const entries = Object.entries(TYPES);
    const identifiers = entries.map(([, identifier]) => identifier);

    expect(entries.length).toBeGreaterThan(0);
    expect(new Set(identifiers).size).toBe(entries.length);

    for (const [name, identifier] of entries) {
      expect(typeof identifier).toBe('symbol');
      expect(Symbol.keyFor(identifier)).toBe(name);
      expect(Symbol.for(name)).toBe(identifier);
    }
  });
});
