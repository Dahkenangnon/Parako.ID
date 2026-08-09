import { vi } from 'vitest';

export interface EventFixture {
  clipboardData?: { getData: ReturnType<typeof vi.fn> };
  key?: string;
  preventDefault: ReturnType<typeof vi.fn>;
  stopPropagation: ReturnType<typeof vi.fn>;
  target?: unknown;
}

export class ElementFixture {
  private readonly classes = new Set<string>();
  public readonly classList = {
    add: vi.fn((...tokens: string[]) =>
      tokens.forEach(token => this.classes.add(token))
    ),
    contains: vi.fn((token: string) => this.classes.has(token)),
    remove: vi.fn((...tokens: string[]) =>
      tokens.forEach(token => this.classes.delete(token))
    ),
  };
  public readonly listeners = new Map<
    string,
    Array<(event: EventFixture) => void>
  >();
  public readonly style = {
    cursor: '',
    opacity: '',
    pointerEvents: '',
  };
  public textContent = '';
  private queryResult: ElementFixture | null = null;

  public addEventListener(
    name: string,
    listener: (event: EventFixture) => void
  ): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public trigger(
    name: string,
    event: Partial<EventFixture> = {}
  ): EventFixture {
    const completeEvent: EventFixture = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target: this,
      ...event,
    };
    this.listeners
      .get(name)
      ?.forEach(listener => listener.call(this, completeEvent));
    return completeEvent;
  }

  public querySelector(_selector: string): ElementFixture | null {
    return this.queryResult;
  }

  public setQueryResult(element: ElementFixture | null): void {
    this.queryResult = element;
  }
}

export class InputFixture extends ElementFixture {
  public disabled = false;
  public readonly focus = vi.fn();
  public value = '';
}

export class ButtonFixture extends ElementFixture {
  public disabled = false;
  public innerHTML = 'Submit';
}

export class FormFixture extends ElementFixture {
  public readonly nativeSubmit = vi.fn();

  public constructor(private readonly button: ButtonFixture | null) {
    super();
  }

  public querySelector(selector: string): ButtonFixture | null {
    return selector === 'button[type="submit"]' ? this.button : null;
  }

  public submit(): void {
    this.nativeSubmit();
  }
}

export const defaultOtpConfig = {
  autoFocus: true,
  codeLength: 6,
  enableBackspace: true,
  enablePaste: true,
  shakeAnimationDuration: 500,
};

export interface SetupOtpDomOptions {
  containerId?: string;
  hasButton?: boolean;
  hasForm?: boolean;
  hasHiddenInput?: boolean;
  hasOtpContainer?: boolean;
  hasState?: boolean;
  inputCount?: number;
  elements?: Record<string, ElementFixture | null>;
  querySelectorError?: Error;
  rawState?: string;
}

export function setupOtpDom(
  stateId: string,
  state: Record<string, unknown>,
  options: SetupOtpDomOptions = {}
) {
  vi.useFakeTimers();
  let ready: (() => void) | undefined;
  const documentListeners = new Map<
    string,
    Array<(event: EventFixture) => void>
  >();
  const alert = vi.fn();
  const button = new ButtonFixture();
  const form = new FormFixture(options.hasButton === false ? null : button);
  const hiddenInput = new InputFixture();
  const otpContainer = new ElementFixture();
  const otpInputs = Array.from(
    { length: options.inputCount ?? 6 },
    () => new InputFixture()
  );
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  vi.stubGlobal('alert', alert);
  vi.stubGlobal('window', { clearInterval, setInterval, setTimeout });
  vi.stubGlobal('document', {
    addEventListener: vi.fn(
      (name: string, listener: (event: EventFixture) => void) => {
        if (name === 'DOMContentLoaded') {
          ready = listener as () => void;
          return;
        }
        const listeners = documentListeners.get(name) ?? [];
        listeners.push(listener);
        documentListeners.set(name, listeners);
      }
    ),
    getElementById: vi.fn((id: string) => {
      if (id === stateId) {
        return options.hasState === false
          ? null
          : { textContent: options.rawState ?? JSON.stringify(state) };
      }
      if (id === 'code') {
        return options.hasHiddenInput === false ? null : hiddenInput;
      }
      if (id === (options.containerId ?? 'otp-container')) {
        return options.hasOtpContainer === false ? null : otpContainer;
      }
      return options.elements?.[id] ?? null;
    }),
    querySelector: vi.fn((selector: string) => {
      if (options.querySelectorError) throw options.querySelectorError;
      return selector === 'form' && options.hasForm !== false ? form : null;
    }),
    querySelectorAll: vi.fn(() => otpInputs),
  });

  return {
    alert,
    button,
    error,
    form,
    hiddenInput,
    log,
    otpContainer,
    otpInputs,
    runReady: () => ready?.(),
    triggerDocument: (
      name: string,
      event: Partial<EventFixture> = {}
    ): EventFixture => {
      const completeEvent: EventFixture = {
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
        ...event,
      };
      documentListeners.get(name)?.forEach(listener => listener(completeEvent));
      return completeEvent;
    },
    warn,
  };
}
