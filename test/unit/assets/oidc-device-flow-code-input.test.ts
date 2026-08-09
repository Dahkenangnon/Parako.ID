import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ButtonFixture,
  ElementFixture,
  FormFixture,
  InputFixture,
} from './support/otp-manager-fixture.js';

class DeviceCodeContainerFixture extends ElementFixture {
  public children: ElementFixture[] = [];
  private content = '';

  public get innerHTML(): string {
    return this.content;
  }

  public set innerHTML(value: string) {
    this.content = value;
    if (value === '') this.children = [];
  }

  public appendChild(child: ElementFixture): void {
    this.children.push(child);
  }
}

class DeviceCodeInputFixture extends InputFixture {
  public autocomplete = '';
  public className = '';
  public readonly dataset: Record<string, string> = {};
  public inputMode = '';
  public maxLength = 0;
  public type = '';
}

class TextFixture extends ElementFixture {
  public className = '';
  public textContent = '';
}

const defaultConfig = {
  deviceCodeCharset: 'digits',
  deviceCodeMask: '***-*-***',
  enableBackButtonPrevention: false,
  enableDoubleSubmissionPrevention: true,
  enableErrorRecovery: false,
  enableFormResubmissionPrevention: false,
  enableLoadingStates: true,
  errorRecoveryTimeout: 10_000,
  formId: 'device-code-form',
  initialUserCode: '',
  submissionTimeout: 10_000,
};

interface SetupOptions {
  createElementError?: Error;
  hasButton?: boolean;
  hasContainer?: boolean;
  hasForm?: boolean;
  hasHiddenInput?: boolean;
  hasHint?: boolean;
  hasHistoryReplaceState?: boolean;
  hasState?: boolean;
  rawState?: string;
}

function setupDom(state: Record<string, unknown>, options: SetupOptions = {}) {
  vi.useFakeTimers();
  let ready: (() => void) | undefined;
  const windowListeners = new Map<string, (event: unknown) => void>();
  const alert = vi.fn();
  const button = new ButtonFixture();
  const container = new DeviceCodeContainerFixture();
  const createdInputs: DeviceCodeInputFixture[] = [];
  const form = new FormFixture(options.hasButton === false ? null : button);
  const hiddenInput = new InputFixture();
  const hint = new TextFixture();
  const stateElement = {
    textContent: options.rawState ?? JSON.stringify(state),
  };
  const reload = vi.fn();
  const replaceState = vi.fn();

  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.stubGlobal('alert', alert);
  vi.stubGlobal('window', {
    addEventListener: vi.fn(
      (name: string, listener: (event: unknown) => void) => {
        windowListeners.set(name, listener);
      }
    ),
    history: {
      replaceState:
        options.hasHistoryReplaceState === false ? undefined : replaceState,
    },
    location: { href: 'https://issuer.example/device', reload },
    setTimeout,
  });
  vi.stubGlobal('document', {
    addEventListener: vi.fn((_name: string, listener: () => void) => {
      ready = listener;
    }),
    createElement: vi.fn((tagName: string) => {
      if (options.createElementError) throw options.createElementError;
      if (tagName === 'input') {
        const input = new DeviceCodeInputFixture();
        createdInputs.push(input);
        return input;
      }
      return new TextFixture();
    }),
    getElementById: vi.fn((id: string) => {
      if (id === '___OIDC_DEVICE_FLOW_CODE_INPUT_STATE___') {
        return options.hasState === false ? null : stateElement;
      }
      if (id === 'device-code-form') {
        return options.hasForm === false ? null : form;
      }
      if (id === 'device-code-container') {
        return options.hasContainer === false ? null : container;
      }
      if (id === 'user_code') {
        return options.hasHiddenInput === false ? null : hiddenInput;
      }
      if (id === 'code-format-hint') {
        return options.hasHint === false ? null : hint;
      }
      return null;
    }),
  });

  return {
    alert,
    button,
    container,
    createdInputs,
    error,
    form,
    hiddenInput,
    hint,
    log,
    reload,
    replaceState,
    runReady: () => ready?.(),
    triggerWindow: (name: string, event: unknown) =>
      windowListeners.get(name)?.(event),
    warn,
  };
}

describe('OIDC device-flow code input', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('falls back safely when a translation is not a non-blank string', async () => {
    const context = setupDom({
      config: defaultConfig,
      translations: { enterCompleteCode: 42 },
    });

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();
    context.form.trigger('submit');

    expect(context.alert).toHaveBeenCalledWith(
      'Please enter a complete device code in the format: ***-*-***'
    );
  });

  it('clears stale code digits after a shorter paste', async () => {
    const context = setupDom({
      config: { ...defaultConfig, initialUserCode: '123-4-567' },
    });

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();
    context.createdInputs[2].trigger('paste', {
      clipboardData: { getData: vi.fn(() => '9') },
    });

    expect(context.createdInputs.map(input => input.value)).toEqual([
      '1',
      '2',
      '9',
      '',
      '',
      '',
      '',
    ]);
    expect(context.hiddenInput.value).toBe('129-');
  });

  it('renders the configured mask and supports filtering and keyboard navigation', async () => {
    const context = setupDom({
      config: {
        ...defaultConfig,
        deviceCodeCharset: 'base-20',
        deviceCodeMask: '**:**',
        initialUserCode: 'a0:bJ',
      },
    });

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();

    expect(context.createdInputs).toHaveLength(4);
    expect(context.createdInputs.map(input => input.value)).toEqual([
      'A',
      '0',
      'B',
      'J',
    ]);
    expect(context.createdInputs.map(input => input.dataset.index)).toEqual([
      '0',
      '1',
      '2',
      '3',
    ]);
    expect(
      context.createdInputs.every(input => input.inputMode === 'text')
    ).toBe(true);
    expect(context.container.children[2]).toMatchObject({ textContent: ':' });
    expect(context.hint.textContent).toBe(
      'Enter your device code in format: AA:AA'
    );
    expect(context.hiddenInput.value).toBe('A0:BJ');

    context.createdInputs[0].value = 'z1';
    context.createdInputs[0].trigger('input');
    expect(context.createdInputs[0].value).toBe('1');
    expect(context.createdInputs[1].focus).toHaveBeenCalledOnce();

    const left = context.createdInputs[1].trigger('keydown', {
      key: 'ArrowLeft',
    });
    const right = context.createdInputs[1].trigger('keydown', {
      key: 'ArrowRight',
    });
    expect(left.preventDefault).toHaveBeenCalledOnce();
    expect(right.preventDefault).toHaveBeenCalledOnce();
    expect(context.createdInputs[0].focus).toHaveBeenCalledOnce();
    expect(context.createdInputs[2].focus).toHaveBeenCalledOnce();

    context.createdInputs[1].value = '';
    context.createdInputs[1].trigger('keydown', { key: 'Backspace' });
    expect(context.createdInputs[0].value).toBe('');

    context.createdInputs[3].trigger('focus');
    context.createdInputs[3].trigger('blur');
    expect(context.createdInputs[3].classList.add).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
    expect(context.createdInputs[3].classList.remove).toHaveBeenCalledWith(
      'ring-2',
      'ring-primary/20'
    );
  });

  it('prevents duplicate submissions and restores the form after a timeout', async () => {
    const context = setupDom({
      config: {
        ...defaultConfig,
        debug: true,
        initialUserCode: '123-4-567',
        submissionTimeout: 1,
      },
      translations: {
        verifying: 'auth.verifying',
        verifyCode: 'Verify it again',
      },
    });

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();
    const accepted = context.form.trigger('submit');
    const duplicate = context.form.trigger('submit');

    expect(accepted.preventDefault).not.toHaveBeenCalled();
    expect(duplicate.preventDefault).toHaveBeenCalledOnce();
    expect(duplicate.stopPropagation).toHaveBeenCalledOnce();
    expect(context.button.disabled).toBe(true);
    expect(context.button.innerHTML).toContain('Verifying...');
    expect(context.createdInputs.every(input => input.disabled)).toBe(true);
    expect(context.form.style.pointerEvents).toBe('none');

    await vi.advanceTimersByTimeAsync(5_000);

    expect(context.button.disabled).toBe(false);
    expect(context.button.innerHTML).toContain('Verify it again');
    expect(context.createdInputs.every(input => !input.disabled)).toBe(true);
    expect(context.form.style.pointerEvents).toBe('auto');
  });

  it('enables browser protections and recovers a stalled submission', async () => {
    const context = setupDom({
      config: {
        ...defaultConfig,
        enableBackButtonPrevention: true,
        enableErrorRecovery: true,
        enableFormResubmissionPrevention: true,
        enableLoadingStates: false,
        errorRecoveryTimeout: 10,
        initialUserCode: '123-4-567',
      },
      translations: { errorRecovery: 'Try the code again' },
    });

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();

    expect(context.replaceState).toHaveBeenCalledWith(
      null,
      '',
      'https://issuer.example/device'
    );
    context.triggerWindow('pageshow', { persisted: false });
    expect(context.reload).not.toHaveBeenCalled();
    context.triggerWindow('pageshow', { persisted: true });
    expect(context.reload).toHaveBeenCalledOnce();

    context.form.trigger('submit');
    expect(context.button.innerHTML).toBe('Submit');
    await vi.advanceTimersByTimeAsync(100);

    expect(context.alert).toHaveBeenCalledWith('Try the code again');
    expect(context.button.disabled).toBe(false);
    expect(context.createdInputs[0].focus).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(9_900);
    expect(context.alert).toHaveBeenCalledOnce();
    expect(context.button.disabled).toBe(false);
  });

  it('leaves an idle form unchanged when error recovery expires', async () => {
    const context = setupDom({
      config: {
        ...defaultConfig,
        enableErrorRecovery: true,
        errorRecoveryTimeout: 10,
      },
    });

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();
    await vi.advanceTimersByTimeAsync(100);

    expect(context.alert).not.toHaveBeenCalled();
    expect(context.button.disabled).toBe(false);
  });

  it('uses the safe defaults when serialized page state is malformed', async () => {
    const context = setupDom({}, { rawState: '{invalid-json' });

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();

    expect(context.error).toHaveBeenCalledWith(
      '[DeviceFlowCodeInputManager] Failed to initialize:',
      expect.any(SyntaxError)
    );
    expect(context.createdInputs).toHaveLength(7);
    expect(
      context.createdInputs.every(input => input.inputMode === 'numeric')
    ).toBe(true);
    expect(context.hint.textContent).toBe(
      'Enter your device code in format: 000-0-000'
    );
  });

  it('uses the safe defaults when serialized page state is empty', async () => {
    const context = setupDom({}, { rawState: '' });

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();

    expect(context.createdInputs).toHaveLength(7);
    expect(context.hint.textContent).toBe(
      'Enter your device code in format: 000-0-000'
    );
  });

  it('uses the safe defaults when serialized page state is absent', async () => {
    const context = setupDom({}, { hasState: false });

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();

    expect(context.error).toHaveBeenCalledWith(
      '[DeviceFlowCodeInputManager] No configuration data found in DOM'
    );
    expect(context.createdInputs).toHaveLength(7);
  });

  it.each([
    ['form', { hasForm: false }],
    ['submit button', { hasButton: false }],
  ])('stops safely when the required %s is absent', async (_name, options) => {
    const context = setupDom({ config: defaultConfig }, options);

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();

    expect(context.createdInputs).toHaveLength(0);
    expect(context.error).toHaveBeenCalledWith(
      '[DeviceFlowCodeInputManager]',
      'Required form elements not found'
    );
  });

  it('degrades safely when the dynamic code container is absent', async () => {
    const context = setupDom(
      { config: { ...defaultConfig, initialUserCode: '123-4-567' } },
      { hasContainer: false }
    );

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();
    await vi.advanceTimersByTimeAsync(100);
    context.form.trigger('submit');

    expect(context.createdInputs).toHaveLength(0);
    expect(context.alert).toHaveBeenCalledOnce();
  });

  it('degrades safely when the hidden value and format hint are absent', async () => {
    const context = setupDom(
      { config: defaultConfig },
      { hasHiddenInput: false, hasHint: false }
    );

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();
    context.createdInputs[0].value = '1';
    context.createdInputs[0].trigger('input');
    context.createdInputs[1].trigger('paste');
    context.form.trigger('submit');

    expect(context.createdInputs).toHaveLength(7);
    expect(context.alert).toHaveBeenCalledOnce();
  });

  it('continues when form resubmission protection is unsupported', async () => {
    const context = setupDom(
      {
        config: {
          ...defaultConfig,
          debug: true,
          enableFormResubmissionPrevention: true,
        },
      },
      { hasHistoryReplaceState: false }
    );

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();

    expect(context.replaceState).not.toHaveBeenCalled();
    expect(context.warn).toHaveBeenCalledWith(
      '[DeviceFlowCodeInputManager]',
      'History API not supported, form resubmission prevention disabled'
    );
    expect(context.createdInputs).toHaveLength(7);
  });

  it('uses validated defaults when runtime configuration is invalid', async () => {
    const context = setupDom({ config: 'invalid' });

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();

    expect(context.warn).toHaveBeenCalledWith(
      '[DeviceFlowCodeInputManager]',
      'Invalid config provided, using defaults',
      { config: 'invalid' }
    );
    expect(context.createdInputs).toHaveLength(7);
    expect(context.hint.textContent).toBe(
      'Enter your device code in format: 000-0-000'
    );
  });

  it('honors disabled double-submission prevention', async () => {
    const context = setupDom({
      config: {
        ...defaultConfig,
        enableDoubleSubmissionPrevention: false,
        initialUserCode: '123-4-567',
      },
    });

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();
    context.form.trigger('submit');
    const secondSubmit = context.form.trigger('submit');

    expect(secondSubmit.preventDefault).not.toHaveBeenCalled();
    expect(secondSubmit.stopPropagation).not.toHaveBeenCalled();
  });

  it('handles valid input, boundary navigation, incomplete codes, and full paste', async () => {
    const context = setupDom({
      config: { ...defaultConfig, deviceCodeMask: '**' },
    });

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();

    context.createdInputs[0].value = '1';
    context.createdInputs[0].trigger('input');
    expect(context.createdInputs[0].value).toBe('1');

    context.createdInputs[1].value = '2';
    context.createdInputs[1].trigger('input');
    context.createdInputs[0].trigger('keydown', { key: 'Backspace' });
    context.createdInputs[0].trigger('keydown', { key: 'ArrowLeft' });
    context.createdInputs[1].trigger('keydown', { key: 'ArrowRight' });
    context.createdInputs[1].trigger('keydown', { key: 'Enter' });

    context.createdInputs[1].value = '';
    context.createdInputs[1].trigger('input');
    const incompleteSubmit = context.form.trigger('submit');
    expect(context.hiddenInput.value).toBe('1');
    expect(incompleteSubmit.preventDefault).toHaveBeenCalledOnce();

    context.createdInputs[0].trigger('paste', {
      clipboardData: { getData: vi.fn(() => '12') },
    });
    expect(context.hiddenInput.value).toBe('12');
    expect(context.createdInputs[1].focus).toHaveBeenCalled();
  });

  it('normalizes missing and invalid individual configuration values', async () => {
    const context = setupDom({
      config: {
        deviceCodeCharset: 'unsupported',
        deviceCodeMask: '',
        enableBackButtonPrevention: false,
        enableDoubleSubmissionPrevention: false,
        enableErrorRecovery: false,
        enableFormResubmissionPrevention: false,
        enableLoadingStates: false,
        errorRecoveryTimeout: 0,
        formId: '',
        initialUserCode: null,
        submissionTimeout: 0,
      },
      translations: null,
    });

    await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
    context.runReady();

    expect(context.createdInputs).toHaveLength(7);
    expect(
      context.createdInputs.every(input => input.inputMode === 'numeric')
    ).toBe(true);
    expect(context.hint.textContent).toBe(
      'Enter your device code in format: 000-0-000'
    );
  });

  it.each([
    ['malformed', { rawState: '{invalid-json' }],
    ['absent', { hasState: false }],
  ])(
    'contains DOM failure in the %s-state fallback initializer',
    async (_name, options) => {
      const fallbackError = new Error('DOM construction failed');
      const context = setupDom(
        {},
        { ...options, createElementError: fallbackError }
      );

      await import('../../../src/assets/js/auth/oidc/device-flow-code-input.js');
      context.runReady();

      expect(context.error).toHaveBeenCalledWith(
        '[DeviceFlowCodeInputManager] Fallback initialization failed:',
        fallbackError
      );
    }
  );
});
