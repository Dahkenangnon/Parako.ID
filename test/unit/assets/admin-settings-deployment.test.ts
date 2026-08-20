import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DeploymentSettingsManager,
  initializeDeploymentSettingsPage,
} from '../../../src/assets/js/admin/settings/deployment.js';

interface SubmitEvent {
  preventDefault: ReturnType<typeof vi.fn>;
}

interface FormFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  submit?: (event: SubmitEvent) => void;
}

function setupDom(
  options: {
    allowedOrigins?: string | null;
    devAllowedOrigins?: string | null;
    form?: FormFixture | null;
    trustProxyHops?: string | null;
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
  const values: Record<string, string | null> = {
    'server.allowed_origins':
      options.allowedOrigins === undefined
        ? 'https://rp.test'
        : options.allowedOrigins,
    'server.dev_allowed_origins':
      options.devAllowedOrigins === undefined ? '' : options.devAllowedOrigins,
    'server.trust_proxy_hops':
      options.trustProxyHops === undefined ? '1' : options.trustProxyHops,
  };
  const getElementById = vi.fn((id: string) => {
    const value = values[id];
    return value === null || value === undefined ? null : { value };
  });
  const querySelector = vi.fn(() => form);
  vi.stubGlobal('document', { getElementById, querySelector });

  return {
    getElementById,
    querySelector,
    submit: () => {
      const event = { preventDefault: vi.fn() };
      form?.submit?.(event);
      return event;
    },
  };
}

describe('admin deployment settings', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('is statically importable without a browser document', () => {
    expect(DeploymentSettingsManager).toBeTypeOf('function');
  });

  it('initializes safely when the deployment form is absent', () => {
    setupDom({ form: null });

    expect(() => initializeDeploymentSettingsPage(null)).not.toThrow();
  });

  it.each([
    ['allowed origins are absent', { allowedOrigins: null }],
    ['allowed origins are blank', { allowedOrigins: '' }],
  ])('rejects submission when %s', (_case, options) => {
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const { submit } = setupDom(options);
    initializeDeploymentSettingsPage({ showAlert });

    const event = submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith(
      'Validation Error',
      'Allowed Origins are required.',
      { variant: 'error' }
    );
  });

  it('falls back to the native alert when the dialog service is unavailable', () => {
    const alert = vi.fn();
    vi.stubGlobal('alert', alert);
    const { submit } = setupDom({ allowedOrigins: 'invalid origin' });
    initializeDeploymentSettingsPage(null);

    const event = submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledWith(
      '"invalid origin" is not a valid origin URL.'
    );
  });

  it('does not validate the read-only application URL as a form field', () => {
    const { getElementById, querySelector, submit } = setupDom();
    initializeDeploymentSettingsPage(null);

    const event = submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(getElementById).not.toHaveBeenCalledWith('url');
    expect(querySelector).toHaveBeenCalledWith('#deployment-form');
  });

  it('cancels an invalid native submission before awaiting its dialog', () => {
    const showAlert = vi.fn(() => new Promise<void>(() => {}));
    const { submit } = setupDom({ allowedOrigins: 'not an origin' });
    initializeDeploymentSettingsPage({ showAlert });

    const event = submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it('reports the first invalid allowed origin', () => {
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const { submit } = setupDom({
      allowedOrigins: ' https://rp.test, ,invalid origin,also invalid ',
    });
    initializeDeploymentSettingsPage({ showAlert });

    const event = submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith(
      'Invalid Allowed Origin',
      '"invalid origin" is not a valid origin URL.',
      { variant: 'error' }
    );
  });

  it('reports the first invalid development origin', () => {
    const showAlert = vi.fn().mockResolvedValue(undefined);
    const { submit } = setupDom({
      devAllowedOrigins: 'https://dev-rp.test, bad dev origin',
    });
    initializeDeploymentSettingsPage({ showAlert });

    const event = submit();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(showAlert).toHaveBeenCalledWith(
      'Invalid Dev Allowed Origin',
      '"bad dev origin" is not a valid origin URL.',
      { variant: 'error' }
    );
  });

  it.each([null, '', '   ', 'Infinity', '-1', '11', '1.5', '1x'])(
    'rejects invalid trust-proxy hops %j',
    trustProxyHops => {
      const showAlert = vi.fn().mockResolvedValue(undefined);
      const { submit } = setupDom({ trustProxyHops });
      initializeDeploymentSettingsPage({ showAlert });

      const event = submit();

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(showAlert).toHaveBeenCalledWith(
        'Invalid Trust Proxy Hops',
        'Trust proxy hops must be an integer between 0 and 10.',
        { variant: 'error' }
      );
    }
  );

  it.each([
    ['lower boundary without development origins', '0', ''],
    [
      'upper boundary with development origins',
      '10',
      ' https://dev-one.test, ,https://dev-two.test ',
    ],
  ])('allows the %s', (_case, trustProxyHops, devAllowedOrigins) => {
    const { submit } = setupDom({
      allowedOrigins: ' https://one.test, ,https://two.test ',
      devAllowedOrigins,
      trustProxyHops,
    });
    initializeDeploymentSettingsPage(null);

    const event = submit();

    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
