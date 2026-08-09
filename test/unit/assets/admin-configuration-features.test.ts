import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (this: ElementFixture) => void;

interface ElementFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  checked: boolean;
  classList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  getAttribute: ReturnType<typeof vi.fn>;
  listener?: Listener;
  reportValidity: ReturnType<typeof vi.fn>;
  setCustomValidity: ReturnType<typeof vi.fn>;
  value: string;
}

function makeElement(
  options: {
    checked?: boolean;
    providerId?: string | null;
    value?: string;
  } = {}
): ElementFixture {
  const element: ElementFixture = {
    addEventListener: vi.fn(
      (_name: string, listener: Listener) => (element.listener = listener)
    ),
    checked: options.checked ?? false,
    classList: { add: vi.fn(), remove: vi.fn() },
    getAttribute: vi.fn((name: string) =>
      name === 'data-provider-toggle' ? (options.providerId ?? null) : null
    ),
    reportValidity: vi.fn(),
    setCustomValidity: vi.fn(),
    value: options.value ?? '',
  };
  return element;
}

function setupDom(
  toggles: ElementFixture[],
  elements: Record<string, ElementFixture> = {}
) {
  const getElementById = vi.fn((id: string) => elements[id] ?? null);
  vi.stubGlobal('document', {
    getElementById,
    querySelectorAll: vi.fn(() => toggles),
  });
  return { getElementById };
}

describe('admin configuration feature controls', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/configuration/features.js')
    ).resolves.toBeDefined();
  });

  it('ignores provider toggles without an identifier', async () => {
    const toggle = makeElement();
    const { getElementById } = setupDom([toggle]);

    await import('../../../src/assets/js/admin/configuration/features.js');
    toggle.listener?.call(toggle);

    expect(getElementById).toHaveBeenCalledWith('options_max_providers');
    expect(getElementById).toHaveBeenCalledTimes(1);
  });

  it('ignores provider toggles whose credential panel is absent', async () => {
    const toggle = makeElement({ providerId: 'github' });
    const { getElementById } = setupDom([toggle]);

    await import('../../../src/assets/js/admin/configuration/features.js');
    toggle.listener?.call(toggle);

    expect(getElementById).toHaveBeenCalledWith('creds-github');
  });

  it.each([
    [true, 'remove'],
    [false, 'add'],
  ] as const)(
    '%s provider toggles update credential visibility',
    async (checked, method) => {
      const toggle = makeElement({ checked, providerId: 'github' });
      const panel = makeElement();
      setupDom([toggle], { 'creds-github': panel });

      await import('../../../src/assets/js/admin/configuration/features.js');
      toggle.listener?.call(toggle);

      expect(panel.classList[method]).toHaveBeenCalledWith('hidden');
    }
  );

  it('does not install maximum validation when the field is absent', async () => {
    setupDom([]);

    await expect(
      import('../../../src/assets/js/admin/configuration/features.js')
    ).resolves.toBeDefined();
  });

  it.each([
    ['empty values', '', '', false],
    ['invalid numbers', 'invalid', 'Must be between 1 and 10', true],
    ['values below one', '0', 'Must be between 1 and 10', true],
    ['values above ten', '11', 'Must be between 1 and 10', true],
    ['the lower boundary', '1', '', false],
    ['the upper boundary', '10', '', false],
  ])(
    'handles %s for maximum providers',
    async (_case, value, message, reports) => {
      const maximum = makeElement({ value });
      setupDom([], { options_max_providers: maximum });

      await import('../../../src/assets/js/admin/configuration/features.js');
      maximum.listener?.call(maximum);

      expect(maximum.setCustomValidity).toHaveBeenCalledWith(message);
      if (reports) {
        expect(maximum.reportValidity).toHaveBeenCalledOnce();
      } else {
        expect(maximum.reportValidity).not.toHaveBeenCalled();
      }
    }
  );
});
