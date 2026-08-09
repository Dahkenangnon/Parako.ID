import { afterEach, describe, expect, it, vi } from 'vitest';

interface InputFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  getAttribute: ReturnType<typeof vi.fn>;
  listener?: (this: InputFixture) => void;
  reportValidity: ReturnType<typeof vi.fn>;
  setCustomValidity: ReturnType<typeof vi.fn>;
  value: string;
}

function makeInput(value: string, max: string | null): InputFixture {
  const input: InputFixture = {
    addEventListener: vi.fn(
      (_name: string, listener: (this: InputFixture) => void) => {
        input.listener = listener;
      }
    ),
    getAttribute: vi.fn((name: string) => (name === 'max' ? max : null)),
    reportValidity: vi.fn(),
    setCustomValidity: vi.fn(),
    value,
  };
  return input;
}

describe('admin OIDC TTL validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/configuration/oidc-ttl.js')
    ).resolves.toBeDefined();
  });

  it.each([
    ['empty values', '', '100', '', false],
    ['missing maxima', '5', null, '', false],
    ['invalid numbers', 'invalid', '100', 'Must be at least 1 second', true],
    ['values below one', '0', '100', 'Must be at least 1 second', true],
    [
      'values above the maximum',
      '101',
      '100',
      'Cannot exceed the system limit of 100 seconds',
      true,
    ],
    ['valid values', '100', '100', '', false],
  ])('handles %s', async (_case, value, max, message, reports) => {
    const input = makeInput(value, max);
    vi.stubGlobal('document', {
      querySelectorAll: vi.fn(() => [input]),
    });

    await import('../../../src/assets/js/admin/configuration/oidc-ttl.js');
    input.listener?.call(input);

    expect(input.setCustomValidity).toHaveBeenCalledWith(message);
    if (reports) {
      expect(input.reportValidity).toHaveBeenCalledOnce();
    } else {
      expect(input.reportValidity).not.toHaveBeenCalled();
    }
  });
});
