import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface ElementFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  listeners: Record<string, (event: EventFixture) => void>;
  textContent: string;
}

interface EventFixture {
  persisted?: boolean;
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
}

type IntervalScheduler = (
  callback: () => void,
  delay?: number
) => ReturnType<typeof setInterval>;

const defaultConfig = {
  autoCloseDelay: 1,
  enableAutoClose: true,
  enableCountdown: true,
  enableBackButtonPrevention: true,
  enableFormResubmissionPrevention: true,
  enableVisibilityHandling: true,
  errorRecoveryTimeout: 30000,
};

function makeElement(): ElementFixture {
  const element: ElementFixture = {
    addEventListener: vi.fn(
      (name: string, listener: (event: EventFixture) => void) => {
        element.listeners[name] = listener;
      }
    ),
    listeners: {},
    textContent: '',
  };
  return element;
}

async function loadManager(
  config: Record<string, unknown> | string | null = defaultConfig,
  translations: Record<string, unknown> = {},
  options: {
    closeButton?: boolean;
    closeBehavior?: 'normal' | 'throws';
    countdown?: boolean;
    countdownText?: boolean;
    hasState?: boolean;
    historyReplaceState?: unknown;
    openerThrows?: boolean;
    parent?: 'self' | 'popup';
    parentCloseBehavior?: 'normal' | 'throws';
    queryError?: Error;
    rawState?: string;
    setInterval?: IntervalScheduler;
  } = {}
) {
  const countdown = makeElement();
  const countdownText = makeElement();
  const closeButton = makeElement();
  const state =
    options.hasState === false
      ? null
      : {
          textContent:
            options.rawState ?? JSON.stringify({ config, translations }),
        };
  const documentListeners: Record<string, (event?: EventFixture) => void> = {};
  const windowListeners: Record<string, (event: EventFixture) => void> = {};
  let ready: (() => void) | undefined;
  const documentRoot = {
    hidden: false,
    addEventListener: vi.fn(
      (name: string, listener: (event?: EventFixture) => void) => {
        if (name === 'DOMContentLoaded') ready = listener;
        else documentListeners[name] = listener;
      }
    ),
    getElementById: vi.fn((id: string) => {
      if (id === '___OIDC_DEVICE_FLOW_SUCCESS_STATE___') return state;
      if (options.queryError) throw options.queryError;
      if (id === 'countdown')
        return options.countdown === false ? null : countdown;
      if (id === 'countdown-text')
        return options.countdownText === false ? null : countdownText;
      if (id === 'close-window-btn')
        return options.closeButton === false ? null : closeButton;
      return null;
    }),
  };
  const close =
    options.closeBehavior === 'throws'
      ? vi.fn(() => {
          throw new Error('close blocked');
        })
      : vi.fn();
  const parentClose =
    options.parentCloseBehavior === 'throws'
      ? vi.fn(() => {
          throw new Error('parent close blocked');
        })
      : vi.fn();
  const replaceState =
    options.historyReplaceState === undefined
      ? vi.fn()
      : options.historyReplaceState;
  const reload = vi.fn();
  const windowRoot: Record<string, unknown> = {
    addEventListener: vi.fn(
      (name: string, listener: (event: EventFixture) => void) => {
        windowListeners[name] = listener;
      }
    ),
    close,
    closed: false,
    history: { replaceState },
    location: { href: 'https://issuer.example/success', reload },
    setInterval: options.setInterval ?? setInterval,
    setTimeout,
  };
  windowRoot.parent =
    options.parent === 'popup' ? { close: parentClose } : windowRoot;
  if (options.openerThrows) {
    Object.defineProperty(windowRoot, 'opener', {
      get() {
        throw new Error('opener access blocked');
      },
    });
  } else {
    windowRoot.opener = null;
  }
  vi.stubGlobal('document', documentRoot);
  vi.stubGlobal('window', windowRoot);

  await import('../../../src/assets/js/auth/oidc/device-flow-success.js');
  ready?.();
  return {
    close,
    closeButton,
    countdown,
    countdownText,
    documentListeners,
    documentRoot,
    parentClose,
    reload,
    replaceState,
    windowListeners,
    windowRoot,
  };
}

describe('OIDC device-flow success manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('does not close the window when auto-close is disabled', async () => {
    const { close, countdown, countdownText } = await loadManager({
      ...defaultConfig,
      enableAutoClose: false,
      enableBackButtonPrevention: false,
      enableFormResubmissionPrevention: false,
      enableVisibilityHandling: false,
    });

    vi.advanceTimersByTime(1000);

    expect(close).not.toHaveBeenCalled();
    expect([countdown.textContent, countdownText.textContent]).toContain(
      'Ready to close'
    );
  });

  it('offers a manual-close message when a regular tab cannot auto-close', async () => {
    const { countdown, countdownText } = await loadManager(defaultConfig, {
      readyToClose: 'Close this tab when ready',
    });

    vi.advanceTimersByTime(1100);

    expect([countdown.textContent, countdownText.textContent]).toContain(
      'Close this tab when ready'
    );
  });

  it('preserves a localized terminal message ending with an ellipsis', async () => {
    const { countdown } = await loadManager(
      {
        ...defaultConfig,
        enableAutoClose: false,
        enableBackButtonPrevention: false,
        enableFormResubmissionPrevention: false,
        enableVisibilityHandling: false,
      },
      { readyToClose: 'Fermeture...' }
    );

    vi.advanceTimersByTime(1000);

    expect(countdown.textContent).toBe('Fermeture...');
  });

  it('falls back safely when a translation is not a string', async () => {
    const { countdown } = await loadManager(
      {
        ...defaultConfig,
        enableAutoClose: false,
        enableBackButtonPrevention: false,
        enableFormResubmissionPrevention: false,
        enableVisibilityHandling: false,
      },
      { readyToClose: 42 }
    );

    vi.advanceTimersByTime(1000);

    expect(countdown.textContent).toBe('Ready to close');
  });

  it('normalizes invalid configuration and translation-key placeholders', async () => {
    const invalid = await loadManager('invalid');
    vi.advanceTimersByTime(1000);
    expect(invalid.countdown.textContent).toBe('4');

    vi.resetModules();
    const normalized = await loadManager(
      {
        ...defaultConfig,
        autoCloseDelay: 0,
        enableAutoClose: false,
        errorRecoveryTimeout: 0,
      },
      { readyToClose: 'auth.readyToClose' }
    );
    vi.advanceTimersByTime(5000);
    expect(normalized.countdown.textContent).toBe('Ready to close');

    vi.resetModules();
    const longText =
      'localized.message.that.is.longer.than.the.key.safety.limit';
    const localized = await loadManager(
      {
        ...defaultConfig,
        enableAutoClose: false,
      },
      { readyToClose: longText }
    );
    vi.advanceTimersByTime(1000);
    expect(localized.countdown.textContent).toBe(longText);
  });

  it('counts down, closes once, and ignores repeated close attempts', async () => {
    const { close, closeButton, countdown, countdownText, windowRoot } =
      await loadManager({ ...defaultConfig, autoCloseDelay: 2 });

    vi.advanceTimersByTime(1000);
    expect(countdown.textContent).toBe('1');
    expect(countdownText.textContent).toBe('1');

    vi.advanceTimersByTime(1000);
    expect(close).toHaveBeenCalledOnce();
    windowRoot.closed = true;
    vi.advanceTimersByTime(500);

    const click = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    closeButton.listeners.click?.(click);
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(click.stopPropagation).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it('shows a manual-close message when window.close throws', async () => {
    const { closeButton, countdown, countdownText } = await loadManager(
      { ...defaultConfig, enableCountdown: false },
      { youCanClose: 'Close this page manually' },
      { closeBehavior: 'throws' }
    );

    closeButton.listeners.click?.({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });

    expect(countdown.textContent).toBe('Close this page manually');
    expect(countdownText.textContent).toBe('Close this page manually');
  });

  it('retries close and navigates a regular tab to about:blank', async () => {
    const { close, closeButton, windowRoot } = await loadManager({
      ...defaultConfig,
      enableCountdown: false,
    });

    closeButton.listeners.click?.({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    vi.advanceTimersByTime(100);
    expect(close).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(400);
    expect((windowRoot.location as { href: string }).href).toBe('about:blank');
  });

  it('uses a parent popup close and falls back when parent closing throws', async () => {
    const popup = await loadManager(
      { ...defaultConfig, enableCountdown: false },
      {},
      { parent: 'popup' }
    );
    popup.closeButton.listeners.click?.({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    vi.advanceTimersByTime(500);
    expect(popup.parentClose).toHaveBeenCalledOnce();

    vi.resetModules();
    const blocked = await loadManager(
      { ...defaultConfig, enableCountdown: false },
      {},
      { parent: 'popup', parentCloseBehavior: 'throws' }
    );
    blocked.closeButton.listeners.click?.({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    vi.advanceTimersByTime(500);
    expect((blocked.windowRoot.location as { href: string }).href).toBe(
      'about:blank'
    );
  });

  it('pauses and resumes countdown as page visibility changes', async () => {
    const { countdown, documentListeners, documentRoot } = await loadManager({
      ...defaultConfig,
      autoCloseDelay: 3,
    });
    vi.advanceTimersByTime(1000);
    expect(countdown.textContent).toBe('2');

    documentRoot.hidden = true;
    documentListeners.visibilitychange?.();
    vi.advanceTimersByTime(2000);
    expect(countdown.textContent).toBe('2');

    documentRoot.hidden = false;
    documentListeners.visibilitychange?.();
    vi.advanceTimersByTime(1000);
    expect(countdown.textContent).toBe('1');
  });

  it('does not resume visibility timers after a close attempt', async () => {
    const setIntervalSpy = vi.fn<IntervalScheduler>(setInterval);
    const { closeButton, documentListeners, documentRoot } = await loadManager(
      { ...defaultConfig, autoCloseDelay: 3 },
      {},
      { setInterval: setIntervalSpy }
    );
    expect(setIntervalSpy).toHaveBeenCalledOnce();

    closeButton.listeners.click?.({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    documentRoot.hidden = true;
    documentListeners.visibilitychange?.();
    documentRoot.hidden = false;
    documentListeners.visibilitychange?.();

    expect(setIntervalSpy).toHaveBeenCalledOnce();
  });

  it('uses the backup close timer when interval callbacks do not run', async () => {
    const inertInterval = vi.fn<IntervalScheduler>(
      () => 987 as unknown as ReturnType<typeof setInterval>
    );
    const { close, countdown, windowRoot } = await loadManager(
      defaultConfig,
      {},
      { setInterval: inertInterval }
    );

    vi.advanceTimersByTime(1000);

    expect(close).toHaveBeenCalledOnce();
    expect(countdown.textContent).toBe('');

    windowRoot.closed = true;
    vi.advanceTimersByTime(100);
    expect(close).toHaveBeenCalledOnce();
  });

  it('handles pageshow, history support, and disabled optional behavior', async () => {
    const enabled = await loadManager();
    enabled.windowListeners.pageshow?.({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      persisted: false,
    });
    expect(enabled.reload).not.toHaveBeenCalled();
    enabled.windowListeners.pageshow?.({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      persisted: true,
    });
    expect(enabled.reload).toHaveBeenCalledOnce();
    expect(enabled.replaceState).toHaveBeenCalled();

    vi.resetModules();
    const disabled = await loadManager(
      {
        ...defaultConfig,
        enableCountdown: false,
        enableBackButtonPrevention: false,
        enableFormResubmissionPrevention: false,
        enableVisibilityHandling: false,
      },
      {},
      { historyReplaceState: null }
    );
    expect(disabled.windowListeners.pageshow).toBeUndefined();
    expect(disabled.documentListeners.visibilitychange).toBeUndefined();

    vi.resetModules();
    await loadManager(defaultConfig, {}, { historyReplaceState: null });
  });

  it('shows the recovery message and supports a single countdown element', async () => {
    const onlyText = await loadManager(
      {
        ...defaultConfig,
        enableCountdown: false,
        errorRecoveryTimeout: 5000,
      },
      { errorRecovery: 'Please restart' },
      { countdown: false }
    );

    vi.advanceTimersByTime(5000);
    expect(onlyText.countdownText.textContent).toBe('Please restart');

    vi.resetModules();
    const onlyCountdown = await loadManager(
      {
        ...defaultConfig,
        enableAutoClose: false,
        errorRecoveryTimeout: 5000,
      },
      {},
      { countdownText: false }
    );
    vi.advanceTimersByTime(1000);
    expect(onlyCountdown.countdown.textContent).toBe('Ready to close');

    vi.resetModules();
    const onlyTextCountdown = await loadManager(
      {
        ...defaultConfig,
        autoCloseDelay: 2,
        enableAutoClose: false,
      },
      {},
      { countdown: false }
    );
    vi.advanceTimersByTime(1000);
    expect(onlyTextCountdown.countdownText.textContent).toBe('1');
  });

  it('returns safely without countdown markup and reports bootstrap failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const absent = await loadManager(
      defaultConfig,
      {},
      {
        countdown: false,
        countdownText: false,
      }
    );
    expect(absent.closeButton.listeners.click).toBeUndefined();

    vi.resetModules();
    const noCloseButton = await loadManager(
      { ...defaultConfig, enableAutoClose: false },
      {},
      { closeButton: false }
    );
    expect(noCloseButton.closeButton.listeners.click).toBeUndefined();

    vi.resetModules();
    await loadManager(
      { ...defaultConfig, enableCountdown: false },
      {},
      { openerThrows: true }
    );

    vi.resetModules();
    await loadManager(defaultConfig, {}, { hasState: false });
    expect(errorSpy).toHaveBeenCalledWith(
      '[DeviceFlowSuccessManager] No configuration data found in DOM'
    );

    vi.resetModules();
    await loadManager(defaultConfig, {}, { rawState: '{broken' });
    expect(errorSpy).toHaveBeenCalledWith(
      '[DeviceFlowSuccessManager] Failed to initialize:',
      expect.any(SyntaxError)
    );

    vi.resetModules();
    await loadManager(
      defaultConfig,
      {},
      {
        queryError: new Error('fallback DOM failed'),
        rawState: '{broken',
      }
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[DeviceFlowSuccessManager] Fallback initialization failed:',
      expect.objectContaining({ message: 'fallback DOM failed' })
    );

    vi.resetModules();
    await loadManager(defaultConfig, {}, { rawState: '' });

    vi.resetModules();
    const failure = new Error('DOM failed');
    await loadManager(
      defaultConfig,
      {},
      {
        hasState: false,
        queryError: failure,
      }
    );
    expect(errorSpy).toHaveBeenCalledWith(
      '[DeviceFlowSuccessManager] Fallback initialization failed:',
      failure
    );
  });
});
