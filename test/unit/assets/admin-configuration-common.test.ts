import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: { target: ElementFixture }) => void;

class ElementFixture {
  public className = '';
  public readonly children: ElementFixture[] = [];
  public readonly remove = vi.fn();
  public readonly style: Record<string, string> = {};
  public textContent = '';
  private readonly attributes = new Map<string, string>();
  private readonly listeners = new Map<string, Listener[]>();

  constructor(public readonly tagName = 'div') {}

  public addEventListener(name: string, listener: Listener): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public appendChild(child: ElementFixture): ElementFixture {
    this.children.push(child);
    return child;
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public trigger(name: string): void {
    this.listeners.get(name)?.forEach(listener => listener({ target: this }));
  }
}

class ButtonFixture extends ElementFixture {
  public disabled = false;
  public onclick: (() => void) | null = null;
}

class InputFixture extends ElementFixture {
  public readonly focus = vi.fn(() => this.trigger('focus'));
  public parentElement: { querySelector: () => ButtonFixture | null } | null =
    null;
  public type = 'password';
  public value = '';

  constructor(public readonly id: string) {
    super('input');
  }
}

function setupDom(
  options: {
    csrf?: string | null;
    inputs?: Record<string, InputFixture>;
    lucide?: boolean;
  } = {}
) {
  vi.useFakeTimers();
  const activityListeners = new Map<string, Array<() => void>>();
  const appendToBody = vi.fn();
  const createIcons = vi.fn();
  const createdElements: ElementFixture[] = [];
  const fetch = vi.fn();
  const windowFixture: Record<string, unknown> = {
    lucide: options.lucide === false ? undefined : { createIcons },
  };
  const csrf = options.csrf === null ? null : { value: options.csrf ?? 'csrf' };

  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('window', windowFixture);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: () => void) => {
      const listeners = activityListeners.get(name) ?? [];
      listeners.push(listener);
      activityListeners.set(name, listeners);
    }),
    body: { appendChild: appendToBody },
    createElement: vi.fn((tagName: string) => {
      const element = new ElementFixture(tagName);
      createdElements.push(element);
      return element;
    }),
    createTextNode: vi.fn((textContent: string) => {
      const element = new ElementFixture('#text');
      element.textContent = textContent;
      return element;
    }),
    getElementById: vi.fn((id: string) => options.inputs?.[id] ?? null),
    querySelector: vi.fn((selector: string) =>
      selector === 'input[name="_csrf"]' ? csrf : null
    ),
  });

  return {
    activityListeners,
    appendToBody,
    createIcons,
    createdElements,
    fetch,
    windowFixture,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('admin configuration secret controls', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('can be imported when browser globals are unavailable', async () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', undefined);

    await expect(
      import('../../../src/assets/js/admin/configuration/common.js')
    ).resolves.toBeDefined();
  });

  it('installs the public API and inactivity activity listeners', async () => {
    const { activityListeners, windowFixture } = setupDom();

    await import('../../../src/assets/js/admin/configuration/common.js');

    expect(windowFixture.revealTenantSecret).toEqual(expect.any(Function));
    expect(windowFixture.remaskTenantSecret).toEqual(expect.any(Function));
    expect(windowFixture.refreshConfigIcons).toEqual(expect.any(Function));
    expect([...activityListeners.keys()]).toEqual([
      'mousedown',
      'mousemove',
      'keypress',
      'scroll',
      'touchstart',
      'click',
    ]);
    expect(vi.getTimerCount()).toBe(1);
  });

  it('refreshes icons only when the optional icon library is available', async () => {
    const withIcons = setupDom();
    await import('../../../src/assets/js/admin/configuration/common.js');

    (withIcons.windowFixture.refreshConfigIcons as () => void)();

    expect(withIcons.createIcons).toHaveBeenCalledOnce();

    vi.resetModules();
    const withoutIcons = setupDom({ lucide: false });
    await import('../../../src/assets/js/admin/configuration/common.js');

    expect(() =>
      (withoutIcons.windowFixture.refreshConfigIcons as () => void)()
    ).not.toThrow();
    expect(withoutIcons.createIcons).not.toHaveBeenCalled();
  });

  it.each([
    { csrf: null, input: new InputFixture('secret') },
    { csrf: '', input: new InputFixture('secret') },
    { csrf: 'csrf', input: null },
  ])('does not reveal without its required controls: %#', async scenario => {
    const inputs: Record<string, InputFixture> = {};
    if (scenario.input) inputs.secret = scenario.input;
    const { fetch, windowFixture } = setupDom({
      csrf: scenario.csrf,
      inputs,
    });
    await import('../../../src/assets/js/admin/configuration/common.js');

    (
      windowFixture.revealTenantSecret as (
        fieldPath: string,
        inputId: string
      ) => void
    )('notifications.apiKey', 'secret');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not reveal when the secret input has no associated button', async () => {
    const input = new InputFixture('secret');
    input.parentElement = { querySelector: () => null };
    const { fetch, windowFixture } = setupDom({ inputs: { secret: input } });
    await import('../../../src/assets/js/admin/configuration/common.js');

    (
      windowFixture.revealTenantSecret as (
        fieldPath: string,
        inputId: string
      ) => void
    )('notifications.apiKey', 'secret');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('reveals, shoulder-protects, and re-masks a secret', async () => {
    const button = new ButtonFixture('button');
    const input = new InputFixture('secret');
    input.setAttribute('data-field-path', 'notifications.apiKey');
    input.parentElement = { querySelector: () => button };
    const { fetch, windowFixture } = setupDom({ inputs: { secret: input } });
    fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true, value: 'decrypted' }),
    });
    await import('../../../src/assets/js/admin/configuration/common.js');

    (
      windowFixture.revealTenantSecret as (
        fieldPath: string,
        inputId: string
      ) => void
    )('notifications.apiKey', 'secret');
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith('/admin/configuration/reveal-secret', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'csrf',
      },
      body: JSON.stringify({
        fieldPath: 'notifications.apiKey',
        _csrf: 'csrf',
      }),
    });
    expect(input.type).toBe('text');
    expect(input.value).toBe('decrypted');
    expect(input.focus).toHaveBeenCalledOnce();
    expect(button.disabled).toBe(false);
    expect(button.onclick).toEqual(expect.any(Function));

    input.trigger('blur');
    expect(input.getAttribute('data-invisible-style')).toBe('true');
    expect(input.style.color).toBe('transparent');
    expect(input.style.caretColor).toBe('#f97316');

    input.trigger('focus');
    expect(input.getAttribute('data-invisible-style')).toBeNull();
    expect(input.style.color).toBe('');
    expect(input.style.caretColor).toBe('');

    button.onclick?.();
    expect(input.type).toBe('password');
    expect(button.onclick).toEqual(expect.any(Function));
    expect(input.getAttribute('data-invisible-style')).toBeNull();

    input.trigger('blur');
    expect(input.getAttribute('data-invisible-style')).toBeNull();

    button.onclick?.();
    await flushPromises();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(input.type).toBe('text');
  });

  it.each([
    { response: { success: false }, rejects: false },
    { response: { success: true }, rejects: false },
    { response: new Error('network unavailable'), rejects: true },
  ])(
    'restores the reveal button after an unsuccessful request: %#',
    async testCase => {
      const button = new ButtonFixture('button');
      const input = new InputFixture('secret');
      input.parentElement = { querySelector: () => button };
      const { fetch, windowFixture } = setupDom({ inputs: { secret: input } });
      if (testCase.rejects) {
        fetch.mockRejectedValue(testCase.response);
      } else {
        fetch.mockResolvedValue({
          json: vi.fn().mockResolvedValue(testCase.response),
        });
      }
      await import('../../../src/assets/js/admin/configuration/common.js');

      (
        windowFixture.revealTenantSecret as (
          fieldPath: string,
          inputId: string
        ) => void
      )('notifications.apiKey', 'secret');
      await flushPromises();

      expect(input.type).toBe('password');
      expect(button.disabled).toBe(false);
      expect(
        button.children.some(
          child => child.getAttribute('data-lucide') === 'eye'
        )
      ).toBe(true);
    }
  );

  it('auto-masks revealed secrets after inactivity and removes its notice', async () => {
    const button = new ButtonFixture('button');
    const input = new InputFixture('secret');
    input.parentElement = { querySelector: () => button };
    const { appendToBody, fetch, windowFixture } = setupDom({
      inputs: { secret: input },
    });
    fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true, value: 'decrypted' }),
    });
    await import('../../../src/assets/js/admin/configuration/common.js');
    (
      windowFixture.revealTenantSecret as (
        fieldPath: string,
        inputId: string
      ) => void
    )('notifications.apiKey', 'secret');
    await flushPromises();

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(input.type).toBe('password');
    expect(appendToBody).toHaveBeenCalledOnce();
    const notification = appendToBody.mock.calls[0]?.[0] as ElementFixture;
    expect(notification.className).toContain('fixed top-4 right-4');
    expect(
      notification.children[0]?.children[0]?.getAttribute('data-lucide')
    ).toBe('shield-alert');
    expect(
      notification.children[0]?.children[1]?.children[0]?.textContent
    ).toBe('Secrets Auto-Masked');

    await vi.advanceTimersByTimeAsync(5000);
    expect(notification.remove).toHaveBeenCalledOnce();
  });

  it('resets the auto-mask deadline when user activity is observed', async () => {
    const button = new ButtonFixture('button');
    const input = new InputFixture('secret');
    input.parentElement = { querySelector: () => button };
    const { activityListeners, fetch, windowFixture } = setupDom({
      inputs: { secret: input },
    });
    fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true, value: 'decrypted' }),
    });
    await import('../../../src/assets/js/admin/configuration/common.js');
    (
      windowFixture.revealTenantSecret as (
        fieldPath: string,
        inputId: string
      ) => void
    )('notifications.apiKey', 'secret');
    await flushPromises();

    await vi.advanceTimersByTimeAsync(119_000);
    activityListeners.get('click')?.[0]?.();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(input.type).toBe('text');

    await vi.advanceTimersByTimeAsync(118_000);
    expect(input.type).toBe('password');
  });

  it('does not notify when inactivity expires without revealed secrets', async () => {
    const { appendToBody } = setupDom();
    await import('../../../src/assets/js/admin/configuration/common.js');

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(appendToBody).not.toHaveBeenCalled();
  });

  it('re-masks safely when the input or its optional button is absent', async () => {
    const input = new InputFixture('secret');
    const { windowFixture } = setupDom({ inputs: { secret: input } });
    await import('../../../src/assets/js/admin/configuration/common.js');
    const remask = windowFixture.remaskTenantSecret as (
      inputId: string
    ) => void;

    expect(() => remask('missing')).not.toThrow();
    expect(() => remask('secret')).not.toThrow();
    expect(input.type).toBe('password');
  });
});
