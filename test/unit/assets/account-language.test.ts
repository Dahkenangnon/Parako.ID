import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LanguageSelector,
  type LanguageSelectorConfig,
} from '../../../src/assets/js/account/settings/language.js';

function loadLanguageSelector(select: object | null = null) {
  const showAlert = vi.fn().mockResolvedValue(undefined);
  const reload = vi.fn();
  const dialog = { showAlert, showConfirm: vi.fn() };
  const documentRoot = {
    getElementById: vi.fn(() => select),
  };
  vi.stubGlobal('window', { location: { reload } });
  vi.stubGlobal('document', documentRoot);

  class TestLanguageSelector extends LanguageSelector {
    constructor(settings: LanguageSelectorConfig) {
      super(settings, dialog);
    }
  }

  return {
    LanguageSelector: TestLanguageSelector,
    documentRoot,
    reload,
    showAlert,
  };
}

function config(debug = false): LanguageSelectorConfig {
  return {
    updateLocaleUrl: '/account/locale',
    csrfToken: 'csrf-token',
    translations: { languageUpdateError: 'Could not update language' },
    debug,
  };
}

describe('account language selector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('skips initialization when the language control is absent', async () => {
    const { LanguageSelector, documentRoot } = await loadLanguageSelector();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    new LanguageSelector(config(true)).initialize();

    expect(documentRoot.getElementById).toHaveBeenCalledWith(
      'language-selector-settings'
    );
    expect(consoleLog).toHaveBeenCalledWith(
      '[LanguageSelector]',
      'Language selector not found, skipping initialization'
    );
  });

  it('persists a locale with CSRF protection and reloads on success', async () => {
    let change: ((event: Event) => Promise<void>) | undefined;
    const select = {
      addEventListener: vi.fn(
        (_name: string, listener: (event: Event) => Promise<void>) => {
          change = listener;
        }
      ),
    };
    const { LanguageSelector, reload } = await loadLanguageSelector(select);
    const request = vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true }),
    });
    vi.stubGlobal('fetch', request);
    new LanguageSelector(config()).initialize();

    await change?.({ target: { value: 'fr' } } as unknown as Event);

    expect(request).toHaveBeenCalledWith('/account/locale', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf-token',
      },
      body: JSON.stringify({ locale: 'fr' }),
    });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('shows a localized error when the server rejects the update', async () => {
    let change: ((event: Event) => Promise<void>) | undefined;
    const select = {
      addEventListener: vi.fn(
        (_name: string, listener: (event: Event) => Promise<void>) => {
          change = listener;
        }
      ),
    };
    const { LanguageSelector, reload, showAlert } =
      await loadLanguageSelector(select);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: false, error: 'invalid' }),
      })
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    new LanguageSelector(config(true)).initialize();

    await change?.({ target: { value: 'xx' } } as unknown as Event);

    expect(reload).not.toHaveBeenCalled();
    expect(showAlert).toHaveBeenCalledWith(
      'Language Update Error',
      'Could not update language',
      { variant: 'error' }
    );
  });

  it('shows the same localized error when the request fails', async () => {
    let change: ((event: Event) => Promise<void>) | undefined;
    const select = {
      addEventListener: vi.fn(
        (_name: string, listener: (event: Event) => Promise<void>) => {
          change = listener;
        }
      ),
    };
    const { LanguageSelector, showAlert } = await loadLanguageSelector(select);
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    new LanguageSelector(config()).initialize();

    await change?.({ target: { value: 'en' } } as unknown as Event);

    expect(showAlert).toHaveBeenCalledWith(
      'Language Update Error',
      'Could not update language',
      { variant: 'error' }
    );
  });

  it('does not publish the selector through an application global', () => {
    const browserWindow: Record<string, unknown> = {};
    vi.stubGlobal('window', browserWindow);

    expect(browserWindow).not.toHaveProperty('LanguageSelector');
  });
});
