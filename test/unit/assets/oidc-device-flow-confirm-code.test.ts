import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface InteractiveFixture {
  addEventListener: ReturnType<typeof vi.fn>;
  classList: {
    add: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
  disabled: boolean;
  innerHTML: string;
  listeners: Record<string, (event: EventFixture) => void>;
  querySelector: ReturnType<typeof vi.fn>;
  style: { pointerEvents: string };
}

interface EventFixture {
  persisted?: boolean;
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
}

function makeInteractive(): InteractiveFixture {
  const element: InteractiveFixture = {
    addEventListener: vi.fn(
      (name: string, listener: (event: EventFixture) => void) => {
        element.listeners[name] = listener;
      }
    ),
    classList: { add: vi.fn(), remove: vi.fn() },
    disabled: false,
    innerHTML: '',
    listeners: {},
    querySelector: vi.fn(),
    style: { pointerEvents: '' },
  };
  return element;
}

const defaultConfig = {
  enableLoadingStates: true,
  enableErrorRecovery: true,
  errorRecoveryTimeout: 5000,
  enableBackButtonPrevention: true,
  enableFormResubmissionPrevention: true,
  enableDoubleSubmissionPrevention: true,
  submissionTimeout: 5000,
};

async function loadManager(
  stateData: Record<string, unknown> | string | null = {
    config: defaultConfig,
  },
  options: {
    buttons?: 'both' | 'continue' | 'abort' | 'none';
    form?: InteractiveFixture | null;
    historyReplaceState?: unknown;
    queryError?: Error;
  } = {}
) {
  const continueButton = makeInteractive();
  const abortButton = makeInteractive();
  const form = Object.hasOwn(options, 'form')
    ? (options.form ?? null)
    : makeInteractive();
  const buttons = options.buttons ?? 'both';
  form?.querySelector.mockImplementation((selector: string) => {
    if (selector === 'button[name="abort"]') {
      return buttons === 'both' || buttons === 'abort' ? abortButton : null;
    }
    return buttons === 'both' || buttons === 'continue' ? continueButton : null;
  });
  const state =
    stateData === null
      ? null
      : {
          textContent:
            typeof stateData === 'string'
              ? stateData
              : JSON.stringify(stateData),
        };
  let ready: (() => void) | undefined;
  const windowListeners: Record<string, (event: EventFixture) => void> = {};
  const reload = vi.fn();
  const replaceState =
    options.historyReplaceState === undefined
      ? vi.fn()
      : options.historyReplaceState;
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: () => void) => {
      if (name === 'DOMContentLoaded') ready = listener;
    }),
    getElementById: vi.fn(() => state),
    querySelector: vi.fn(() => {
      if (options.queryError) throw options.queryError;
      return form;
    }),
  });
  vi.stubGlobal('window', {
    addEventListener: vi.fn(
      (name: string, listener: (event: EventFixture) => void) => {
        windowListeners[name] = listener;
      }
    ),
    history: { replaceState },
    location: { href: 'https://issuer.example/confirm', reload },
    setTimeout,
  });
  vi.stubGlobal('alert', vi.fn());

  await import('../../../src/assets/js/auth/oidc/device-flow-confirm-code.js');
  ready?.();
  return {
    abortButton,
    continueButton,
    form,
    reload,
    replaceState,
    windowListeners,
  };
}

function makeEvent(): EventFixture {
  return {
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  };
}

describe('OIDC device-flow confirmation code manager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('allows the first continue and abort submissions to reach the server', async () => {
    const { abortButton, continueButton, form } = await loadManager();

    const continueClick = makeEvent();
    const firstSubmit = makeEvent();
    continueButton.listeners.click?.(continueClick);
    form!.listeners.submit?.(firstSubmit);

    expect(continueClick.preventDefault).not.toHaveBeenCalled();
    expect(firstSubmit.preventDefault).not.toHaveBeenCalled();

    vi.runAllTimers();

    const abortClick = makeEvent();
    const abortSubmit = makeEvent();
    abortButton.listeners.click?.(abortClick);
    form!.listeners.submit?.(abortSubmit);

    expect(abortClick.preventDefault).not.toHaveBeenCalled();
    expect(abortSubmit.preventDefault).not.toHaveBeenCalled();
    expect(abortButton.disabled).toBe(false);
  });

  it('preserves localized loading labels that end with an ellipsis', async () => {
    const { continueButton } = await loadManager({
      config: defaultConfig,
      translations: { processing: 'Traitement...' },
    });

    continueButton.listeners.click?.(makeEvent());

    expect(continueButton.innerHTML).toContain('Traitement...');
    expect(continueButton.innerHTML).not.toContain('Processing...');
  });

  it('blocks duplicate submits and clicks, then recovers the form', async () => {
    const { abortButton, continueButton, form } = await loadManager();
    expect(form).not.toBeNull();
    const firstSubmit = makeEvent();
    const duplicateSubmit = makeEvent();
    form?.listeners.submit?.(firstSubmit);
    form?.listeners.submit?.(duplicateSubmit);

    expect(firstSubmit.preventDefault).not.toHaveBeenCalled();
    expect(duplicateSubmit.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateSubmit.stopPropagation).toHaveBeenCalledOnce();

    const duplicateClick = makeEvent();
    continueButton.listeners.click?.(duplicateClick);
    expect(duplicateClick.preventDefault).toHaveBeenCalledOnce();
    expect(duplicateClick.stopPropagation).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(0);
    expect(continueButton.disabled).toBe(true);
    expect(abortButton.disabled).toBe(true);
    expect(form?.style.pointerEvents).toBe('none');

    vi.advanceTimersByTime(5000);
    expect(continueButton.disabled).toBe(false);
    expect(abortButton.disabled).toBe(false);
    expect(form?.style.pointerEvents).toBe('auto');
    expect(alert).toHaveBeenCalledWith('Session timed out. Please try again.');
  });

  it('honors disabled behavior flags and absent optional buttons', async () => {
    const config = {
      ...defaultConfig,
      enableLoadingStates: false,
      enableErrorRecovery: false,
      enableBackButtonPrevention: false,
      enableFormResubmissionPrevention: false,
      enableDoubleSubmissionPrevention: false,
    };
    const { abortButton, continueButton, form, windowListeners } =
      await loadManager({ config });

    expect(form?.listeners.submit).toBeUndefined();
    expect(continueButton.listeners.click).toBeUndefined();
    expect(abortButton.listeners.click).toBeUndefined();
    expect(windowListeners.pageshow).toBeUndefined();

    vi.resetModules();
    const buttonlessForm = makeInteractive();
    await loadManager(
      { config: defaultConfig },
      { form: buttonlessForm, buttons: 'none' }
    );
  });

  it('handles missing forms and unsupported history safely', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { replaceState } = await loadManager(
      { config: defaultConfig },
      { form: null, historyReplaceState: null }
    );

    expect(replaceState).toBeNull();
    expect(errorSpy).toHaveBeenCalledWith(
      '[DeviceFlowConfirmCodeManager]',
      'Required form element not found'
    );

    vi.resetModules();
    await loadManager({ config: defaultConfig }, { historyReplaceState: null });
  });

  it('reloads only persisted back-forward-cache pages', async () => {
    const { reload, windowListeners } = await loadManager();

    windowListeners.pageshow?.({ ...makeEvent(), persisted: false });
    expect(reload).not.toHaveBeenCalled();
    windowListeners.pageshow?.({ ...makeEvent(), persisted: true });
    expect(reload).toHaveBeenCalledOnce();
  });

  it('normalizes invalid config and recognizes genuine translation keys', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { continueButton } = await loadManager({
      config: null,
      translations: {
        processing: 'auth.processing',
        continue: '',
      },
    });

    continueButton.listeners.click?.(makeEvent());

    expect(continueButton.innerHTML).toContain('Processing...');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('normalizes timeouts, debug mode, and non-string translations', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const config = {
      ...defaultConfig,
      debug: true,
      errorRecoveryTimeout: 0,
      submissionTimeout: 0,
    };
    const { continueButton, replaceState } = await loadManager({
      config,
      translations: { processing: 42 },
    });

    continueButton.listeners.click?.(makeEvent());

    expect(continueButton.innerHTML).toContain('42');
    expect(logSpy).toHaveBeenCalled();
    expect(replaceState).toHaveBeenCalled();

    vi.resetModules();
    await loadManager({ config: 'invalid' });
  });

  it('supports single-button markup and submission-timeout recovery', async () => {
    const config = {
      ...defaultConfig,
      errorRecoveryTimeout: 10000,
      submissionTimeout: 5000,
    };
    const onlyContinue = await loadManager({ config }, { buttons: 'continue' });
    onlyContinue.form?.listeners.submit?.(makeEvent());
    vi.advanceTimersByTime(5000);
    expect(onlyContinue.continueButton.disabled).toBe(false);

    vi.resetModules();
    const onlyAbort = await loadManager({ config }, { buttons: 'abort' });
    onlyAbort.form?.listeners.submit?.(makeEvent());
    const duplicateAbort = makeEvent();
    onlyAbort.abortButton.listeners.click?.(duplicateAbort);
    expect(duplicateAbort.preventDefault).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    expect(onlyAbort.abortButton.disabled).toBe(false);
  });

  it('leaves an idle form unchanged when recovery time elapses', async () => {
    const { form } = await loadManager();
    vi.advanceTimersByTime(5000);
    expect(form?.style.pointerEvents).toBe('');
    expect(alert).not.toHaveBeenCalled();
  });

  it('uses default bootstrap data for missing or malformed page state', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const missing = await loadManager(null);
    expect(missing.form?.listeners.submit).toEqual(expect.any(Function));
    expect(errorSpy).toHaveBeenCalledWith(
      '[DeviceFlowConfirmCodeManager] No configuration data found in DOM'
    );

    vi.resetModules();
    const malformed = await loadManager('{broken');
    expect(malformed.form?.listeners.submit).toEqual(expect.any(Function));
    expect(errorSpy).toHaveBeenCalledWith(
      '[DeviceFlowConfirmCodeManager] Failed to initialize:',
      expect.any(SyntaxError)
    );

    vi.resetModules();
    const empty = await loadManager('');
    expect(empty.form?.listeners.submit).toEqual(expect.any(Function));
  });

  it('reports fallback initialization failures', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = new Error('DOM unavailable');

    await loadManager(null, { queryError: failure });

    expect(errorSpy).toHaveBeenCalledWith(
      '[DeviceFlowConfirmCodeManager] Fallback initialization failed:',
      failure
    );

    vi.resetModules();
    await loadManager('{broken', { queryError: failure });
    expect(errorSpy).toHaveBeenCalledWith(
      '[DeviceFlowConfirmCodeManager] Fallback initialization failed:',
      failure
    );
  });
});
