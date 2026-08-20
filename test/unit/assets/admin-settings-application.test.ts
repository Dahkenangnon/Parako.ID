import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApplicationSettingsManager,
  initializeApplicationSettingsPage,
} from '../../../src/assets/js/admin/settings/application.js';

interface LocaleFixture {
  checked: boolean;
  value: string;
}

interface HiddenInputFixture {
  name: string;
  type: string;
  value: string;
}

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  appendChild: ReturnType<typeof vi.fn>;
  nativeSubmit: ReturnType<typeof vi.fn>;
  onSubmit?: (event: { preventDefault: ReturnType<typeof vi.fn> }) => void;
  submit: ReturnType<typeof vi.fn>;
}

function makeForm(): FormFixture {
  const nativeSubmit = vi.fn();
  const form: FormFixture = {
    addEventListener: vi.fn(
      (
        _name: string,
        listener: (event: { preventDefault: ReturnType<typeof vi.fn> }) => void
      ) => {
        form.onSubmit = listener;
      }
    ),
    appendChild: vi.fn(),
    nativeSubmit,
    submit: nativeSubmit,
  };
  return form;
}

function setupDom(
  options: {
    defaultLocale?: string | null;
    form?: FormFixture | null;
    locales?: LocaleFixture[];
  } = {}
) {
  const form = options.form === undefined ? makeForm() : options.form;
  const hiddenInput: HiddenInputFixture = { name: '', type: '', value: '' };

  vi.stubGlobal('document', {
    createElement: vi.fn(() => hiddenInput),
    getElementById: vi.fn(() =>
      options.defaultLocale === null
        ? null
        : { value: options.defaultLocale ?? 'en' }
    ),
    querySelector: vi.fn(() => form),
    querySelectorAll: vi.fn(() => options.locales ?? []),
  });

  return {
    form,
    hiddenInput,
    submit: async () => {
      const event = { preventDefault: vi.fn() };
      form?.onSubmit?.(event);
      for (let index = 0; index < 4; index += 1) {
        await Promise.resolve();
      }
      return event;
    },
  };
}

describe('admin application settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is statically importable without a browser document', () => {
    expect(ApplicationSettingsManager).toBeTypeOf('function');
  });

  it('initializes safely when the settings form is absent', () => {
    setupDom({ form: null });

    expect(() => initializeApplicationSettingsPage(null)).not.toThrow();
  });

  it('submits when the optional default-locale select is absent', async () => {
    const { form, submit } = setupDom({
      defaultLocale: null,
    });
    initializeApplicationSettingsPage(null);

    const event = await submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(document.createElement).not.toHaveBeenCalled();
    expect(form?.appendChild).not.toHaveBeenCalled();
    expect(form?.nativeSubmit).toHaveBeenCalledOnce();
  });

  it('rejects a form with no available locale using the configured dialog', async () => {
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const { form, submit } = setupDom();
    initializeApplicationSettingsPage({ showAlert });

    const event = await submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith(
      'Validation Error',
      'Please select at least one available locale.',
      { variant: 'error' }
    );
    expect(form?.nativeSubmit).not.toHaveBeenCalled();
  });

  it('rejects a default locale outside the checked locales using alert', async () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const { form, submit } = setupDom({
      defaultLocale: 'fr',
      locales: [
        { checked: false, value: 'fr' },
        { checked: true, value: 'en' },
      ],
    });
    initializeApplicationSettingsPage(null);

    await submit();

    expect(alert).toHaveBeenCalledWith(
      'Default locale must be included in available locales.'
    );
    expect(form?.nativeSubmit).not.toHaveBeenCalled();
  });

  it('falls back to alert when the dialog service is unavailable', async () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const { submit } = setupDom();
    initializeApplicationSettingsPage(null);

    await submit();

    expect(alert).toHaveBeenCalledWith(
      'Please select at least one available locale.'
    );
  });

  it('submits a valid locale selection without adding bypass fields', async () => {
    const { form, submit } = setupDom({
      defaultLocale: 'fr',
      locales: [
        { checked: false, value: 'de' },
        { checked: true, value: 'en' },
        { checked: true, value: 'fr' },
      ],
    });
    initializeApplicationSettingsPage(null);

    await submit();

    expect(document.createElement).not.toHaveBeenCalled();
    expect(form?.appendChild).not.toHaveBeenCalled();
    expect(form?.nativeSubmit).toHaveBeenCalledOnce();
  });
});
