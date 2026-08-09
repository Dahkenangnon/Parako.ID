import { afterEach, describe, expect, it, vi } from 'vitest';

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
    dialog?: { showAlert?: ReturnType<typeof vi.fn> };
    form?: FormFixture | null;
    locales?: LocaleFixture[];
  } = {}
) {
  let ready: (() => void) | undefined;
  const form = options.form === undefined ? makeForm() : options.form;
  const hiddenInput: HiddenInputFixture = { name: '', type: '', value: '' };
  vi.stubGlobal('window', { dialog: options.dialog });
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
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
    runReady: () => ready?.(),
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
    vi.resetModules();
  });

  it('can be imported when the document is unavailable', async () => {
    vi.stubGlobal('document', undefined);

    await expect(
      import('../../../src/assets/js/admin/settings/application.js')
    ).resolves.toBeDefined();
  });

  it('initializes safely when the settings form is absent', async () => {
    const { runReady } = setupDom({ form: null });
    await import('../../../src/assets/js/admin/settings/application.js');

    expect(runReady).not.toThrow();
  });

  it('submits when the optional default-locale select is absent', async () => {
    const { form, hiddenInput, runReady, submit } = setupDom({
      defaultLocale: null,
    });
    await import('../../../src/assets/js/admin/settings/application.js');
    runReady();

    const event = await submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(hiddenInput).toEqual({
      name: '_validated',
      type: 'hidden',
      value: '1',
    });
    expect(form?.appendChild).toHaveBeenCalledWith(hiddenInput);
    expect(form?.nativeSubmit).toHaveBeenCalledOnce();
  });

  it('rejects a form with no available locale using the configured dialog', async () => {
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const { form, runReady, submit } = setupDom({ dialog: { showAlert } });
    await import('../../../src/assets/js/admin/settings/application.js');
    runReady();

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
    const { form, runReady, submit } = setupDom({
      defaultLocale: 'fr',
      locales: [
        { checked: false, value: 'fr' },
        { checked: true, value: 'en' },
      ],
    });
    await import('../../../src/assets/js/admin/settings/application.js');
    runReady();

    await submit();

    expect(alert).toHaveBeenCalledWith(
      'Default locale must be included in available locales.'
    );
    expect(form?.nativeSubmit).not.toHaveBeenCalled();
  });

  it('falls back to alert when dialog has no showAlert method', async () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const { runReady, submit } = setupDom({ dialog: {} });
    await import('../../../src/assets/js/admin/settings/application.js');
    runReady();

    await submit();

    expect(alert).toHaveBeenCalledWith(
      'Please select at least one available locale.'
    );
  });

  it('appends the validation bypass and submits a valid locale selection', async () => {
    const { form, hiddenInput, runReady, submit } = setupDom({
      defaultLocale: 'fr',
      locales: [
        { checked: false, value: 'de' },
        { checked: true, value: 'en' },
        { checked: true, value: 'fr' },
      ],
    });
    await import('../../../src/assets/js/admin/settings/application.js');
    runReady();

    await submit();

    expect(form?.appendChild).toHaveBeenCalledWith(hiddenInput);
    expect(form?.nativeSubmit).toHaveBeenCalledOnce();
  });
});
