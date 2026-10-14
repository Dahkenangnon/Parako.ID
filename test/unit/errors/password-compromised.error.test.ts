import { describe, expect, it } from 'vitest';
import { PasswordCompromisedError } from '../../../src/errors/password-compromised.error.js';

describe('PasswordCompromisedError', () => {
  it.each([
    [1, '1 known data breach'],
    [42, '42 known data breaches'],
  ])('formats the breach count for %i occurrence(s)', (count, message) => {
    const error = new PasswordCompromisedError(count);

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PasswordCompromisedError');
    expect(error.breachCount).toBe(count);
    expect(error.message).toContain(message);
  });
});
