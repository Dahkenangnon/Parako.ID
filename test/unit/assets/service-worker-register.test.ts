import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';

import { installServiceWorkerRegistration } from '../../../src/assets/js/sw/register.js';

type LoadListenerRegistrar = (
  type: 'load',
  listener: () => void,
  options: { once: true }
) => void;

interface BrowserFixture {
  addEventListener: Mock<LoadListenerRegistrar>;
  register: ReturnType<typeof vi.fn>;
  windowRoot: {
    PARAKO_DISABLE_SW?: boolean;
    addEventListener: Mock<LoadListenerRegistrar>;
  };
}

function installBrowser(
  readyState: 'complete' | 'loading',
  options: { disabled?: boolean; supported?: boolean; reject?: boolean } = {}
): BrowserFixture {
  const addEventListener = vi.fn<LoadListenerRegistrar>();
  const register = options.reject
    ? vi.fn().mockRejectedValue(new Error('registration failed'))
    : vi.fn().mockResolvedValue({});
  const windowRoot = {
    PARAKO_DISABLE_SW: options.disabled,
    addEventListener,
  };

  vi.stubGlobal('window', windowRoot);
  vi.stubGlobal('document', { readyState });
  vi.stubGlobal(
    'navigator',
    options.supported === false ? {} : { serviceWorker: { register } }
  );

  return { addEventListener, register, windowRoot };
}

describe('service-worker registration bootstrap', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('does not register when explicitly disabled', async () => {
    const fixture = installBrowser('complete', { disabled: true });

    installServiceWorkerRegistration(fixture.windowRoot, document, navigator);

    expect(fixture.register).not.toHaveBeenCalled();
  });

  it('does not register when service workers are unsupported', async () => {
    const fixture = installBrowser('complete', { supported: false });

    installServiceWorkerRegistration(fixture.windowRoot, document, navigator);

    expect(fixture.register).not.toHaveBeenCalled();
  });

  it('registers immediately after the document has loaded', async () => {
    const fixture = installBrowser('complete');

    installServiceWorkerRegistration(fixture.windowRoot, document, navigator);

    expect(fixture.register).toHaveBeenCalledWith('/service-worker.js');
    expect(fixture.addEventListener).not.toHaveBeenCalled();
  });

  it('swallows registration failures so the application remains usable', async () => {
    const fixture = installBrowser('complete', { reject: true });

    installServiceWorkerRegistration(fixture.windowRoot, document, navigator);
    await Promise.resolve();

    expect(fixture.register).toHaveBeenCalledOnce();
  });

  it('defers registration until the one-time window load event', async () => {
    const fixture = installBrowser('loading');

    installServiceWorkerRegistration(fixture.windowRoot, document, navigator);

    expect(fixture.addEventListener).toHaveBeenCalledWith(
      'load',
      expect.any(Function),
      { once: true }
    );
    expect(fixture.register).not.toHaveBeenCalled();

    const listener = fixture.addEventListener.mock.calls[0]?.[1] as () => void;
    listener();
    expect(fixture.register).toHaveBeenCalledWith('/service-worker.js');
  });
});
