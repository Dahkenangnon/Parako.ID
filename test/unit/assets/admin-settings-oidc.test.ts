import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  OidcSettingsManager,
  initializeOidcSettingsPage,
} from '../../../src/assets/js/admin/settings/oidc.js';

interface SubmitEvent {
  preventDefault: ReturnType<typeof vi.fn>;
}

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  submit?: (event: SubmitEvent) => void;
}

function setupDom(
  options: {
    form?: FormFixture | null;
    issuer?: string | null;
    path?: string | null;
  } = {}
) {
  const form =
    options.form === undefined
      ? ({
          addEventListener: vi.fn(
            (_name: string, listener: (event: SubmitEvent) => void) => {
              form!.submit = listener;
            }
          ),
        } as FormFixture)
      : options.form;
  const elements = {
    'oidc.issuer':
      options.issuer === null
        ? null
        : { value: options.issuer ?? 'https://idp.test' },
    'oidc.path':
      options.path === null ? null : { value: options.path ?? '/oidc' },
  };
  vi.stubGlobal('document', {
    getElementById: vi.fn((id: keyof typeof elements) => elements[id] ?? null),
    querySelector: vi.fn(() => form),
  });

  return {
    submit: () => {
      const event = { preventDefault: vi.fn() };
      form?.submit?.(event);
      return event;
    },
  };
}

describe('admin OIDC settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is statically importable without a browser document', () => {
    expect(OidcSettingsManager).toBeTypeOf('function');
  });

  it('initializes safely when the settings form is absent', () => {
    setupDom({ form: null });

    expect(() => initializeOidcSettingsPage(null)).not.toThrow();
  });

  it.each([
    ['both inputs are absent', null, null],
    ['the issuer is blank', '', '/oidc'],
    ['the path is absent', 'https://idp.test', null],
    ['the path is blank', 'https://idp.test', ''],
  ])('rejects submission when %s', (_case, issuer, path) => {
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const { submit } = setupDom({ issuer, path });
    initializeOidcSettingsPage({ showAlert });

    const event = submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith(
      'Validation Error',
      'Issuer URL and OIDC path are required fields.',
      { variant: 'error' }
    );
  });

  it('rejects an invalid issuer using the native alert fallback', () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const { submit } = setupDom({ issuer: 'not a URL' });
    initializeOidcSettingsPage(null);

    const event = submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith('Please enter a valid issuer URL.');
  });

  it('cancels invalid submission before an asynchronous dialog resolves', () => {
    const showAlert = vi.fn(() => new Promise<void>(() => {}));
    const { submit } = setupDom({ issuer: '' });
    initializeOidcSettingsPage({ showAlert });

    const event = submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('allows a valid issuer and path to submit', () => {
    const { submit } = setupDom({
      issuer: 'https://idp.test/oidc/v1',
      path: '/oidc/v1',
    });
    initializeOidcSettingsPage(null);

    const event = submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('allows submission when the issuer is computed and only the editable path is present', () => {
    const { submit } = setupDom({
      issuer: null,
      path: '/oidc/v1',
    });
    initializeOidcSettingsPage(null);

    const event = submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
