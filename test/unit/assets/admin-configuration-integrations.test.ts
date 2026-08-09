import { afterEach, describe, expect, it, vi } from 'vitest';

interface ButtonFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  click?: (this: ButtonFixture) => Promise<void>;
  disabled: boolean;
  textContent: string;
}

interface ResultFixture {
  classList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  className: string;
  textContent: string;
}

function makeButton(): ButtonFixture {
  const button: ButtonFixture = {
    addEventListener: vi.fn(
      (_name: string, listener: (this: ButtonFixture) => Promise<void>) => {
        button.click = listener;
      }
    ),
    disabled: false,
    textContent: 'Send Test',
  };
  return button;
}

function setupDom(
  options: {
    button?: ButtonFixture | null;
    csrf?: string | null;
    email?: string | null;
    lucide?: { createIcons?: ReturnType<typeof vi.fn> };
    result?: ResultFixture | null;
  } = {}
) {
  let ready: (() => void) | undefined;
  const button = options.button === undefined ? makeButton() : options.button;
  const email =
    options.email === null
      ? null
      : { value: options.email ?? 'user@example.com' };
  const result =
    options.result === undefined
      ? ({
          classList: { add: vi.fn(), remove: vi.fn() },
          className: 'hidden',
          textContent: '',
        } as ResultFixture)
      : options.result;
  vi.stubGlobal('window', { lucide: options.lucide });
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    getElementById: vi.fn((id: string) => {
      if (id === 'send-test-email-button') return button;
      if (id === 'test-email-address') return email;
      if (id === 'test-email-result') return result;
      return null;
    }),
    querySelector: vi.fn(() =>
      options.csrf === null || options.csrf === undefined
        ? null
        : { value: options.csrf }
    ),
  });
  return {
    button,
    result,
    runReady: () => ready?.(),
    click: async () => button?.click?.call(button),
  };
}

describe('admin configuration integrations', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/configuration/integrations.js')
    ).resolves.toBeDefined();
  });

  it('initializes safely when the send button is absent', async () => {
    const { runReady } = setupDom({ button: null });
    await import('../../../src/assets/js/admin/configuration/integrations.js');

    expect(runReady).not.toThrow();
  });

  it.each([
    ['email input', { email: null }],
    ['result element', { result: null }],
  ])('does nothing when the %s is absent', async (_case, options) => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { click, runReady } = setupDom(options);
    await import('../../../src/assets/js/admin/configuration/integrations.js');
    runReady();

    await click();

    expect(fetch).not.toHaveBeenCalled();
  });

  it('shows an inline validation error for a blank email', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { click, result, runReady } = setupDom({ email: '   ' });
    await import('../../../src/assets/js/admin/configuration/integrations.js');
    runReady();

    await click();

    expect(fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      className: 'mt-2 text-sm text-destructive',
      textContent: 'Please enter an email address.',
    });
    expect(result?.classList.remove).toHaveBeenCalledWith('hidden');
  });

  it.each([
    [
      'success response',
      { success: true, message: 'Message sent' },
      'Message sent',
      'mt-2 text-sm text-success',
    ],
    [
      'error response',
      { success: false, error: 'SMTP rejected the message' },
      'SMTP rejected the message',
      'mt-2 text-sm text-destructive',
    ],
    [
      'error response without details',
      { success: false },
      'Failed to send test email',
      'mt-2 text-sm text-destructive',
    ],
  ])(
    'renders a %s and restores the button',
    async (_case, responseData, text, className) => {
      const fetch = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue(responseData),
      });
      vi.stubGlobal('fetch', fetch);
      const createIcons = vi.fn();
      const { button, click, result, runReady } = setupDom({
        csrf: 'csrf-token',
        lucide:
          responseData.success === true
            ? { createIcons }
            : 'error' in responseData && responseData.error
              ? {}
              : undefined,
      });
      await import('../../../src/assets/js/admin/configuration/integrations.js');
      runReady();

      await click();

      expect(fetch).toHaveBeenCalledWith(
        '/admin/configuration/integrations/test-email',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'csrf-token',
          },
          body: JSON.stringify({
            email: 'user@example.com',
            _csrf: 'csrf-token',
          }),
        }
      );
      expect(result).toMatchObject({ className, textContent: text });
      expect(result?.classList.add).toHaveBeenCalledWith('hidden');
      expect(result?.classList.remove).toHaveBeenCalledWith('hidden');
      expect(button).toMatchObject({
        disabled: false,
        textContent: 'Send Test',
      });
      if (responseData.success === true) {
        expect(createIcons).toHaveBeenCalledOnce();
      }
    }
  );

  it('uses an empty CSRF token and renders network errors', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetch);
    const { button, click, result, runReady } = setupDom({ csrf: null });
    await import('../../../src/assets/js/admin/configuration/integrations.js');
    runReady();

    await click();

    expect(fetch).toHaveBeenCalledWith(
      '/admin/configuration/integrations/test-email',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-CSRF-Token': '' }),
        body: JSON.stringify({ email: 'user@example.com', _csrf: '' }),
      })
    );
    expect(result).toMatchObject({
      className: 'mt-2 text-sm text-destructive',
      textContent: 'Network error. Please try again.',
    });
    expect(button).toMatchObject({ disabled: false, textContent: 'Send Test' });
  });
});
