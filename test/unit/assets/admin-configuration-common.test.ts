import { afterEach, describe, expect, it, vi } from 'vitest';

import { initializeAdminConfigurationCommon } from '../../../src/assets/js/admin/configuration/common.js';

interface EventFixture {
  preventDefault: ReturnType<typeof vi.fn>;
  target: ElementFixture;
}

type Listener = (event: EventFixture) => void;

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

  public trigger(name: string): EventFixture {
    const event = { preventDefault: vi.fn(), target: this };
    this.listeners.get(name)?.forEach(listener => listener(event));
    return event;
  }
}

class ButtonFixture extends ElementFixture {
  public disabled = false;
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
    confirmationForms?: ElementFixture[];
    inputs?: Record<string, InputFixture>;
    lucide?: boolean;
    secretButtons?: ButtonFixture[];
  } = {}
) {
  vi.useFakeTimers();
  const activityListeners = new Map<string, Array<() => void>>();
  const appendToBody = vi.fn();
  const createIcons = vi.fn();
  const confirm = vi.fn();
  const createdElements: ElementFixture[] = [];
  const fetch = vi.fn();
  const windowFixture: Record<string, unknown> = {
    confirm,
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
    querySelectorAll: vi.fn((selector: string) =>
      selector === 'form[data-confirm-message]'
        ? (options.confirmationForms ?? [])
        : selector === 'button[data-secret-field-path][data-secret-input-id]'
          ? (options.secretButtons ?? [])
          : []
    ),
  });

  return {
    activityListeners,
    appendToBody,
    createIcons,
    confirm,
    createdElements,
    fetch,
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('requires confirmation before resetting tenant configuration', () => {
    const form = new ElementFixture('form');
    const message =
      'Are you sure you want to reset Application configuration to defaults?';
    form.setAttribute('data-confirm-message', message);
    const { confirm } = setupDom({ confirmationForms: [form] });
    confirm.mockReturnValueOnce(false).mockReturnValueOnce(true);

    initializeAdminConfigurationCommon();

    const cancelled = form.trigger('submit');
    const accepted = form.trigger('submit');

    expect(confirm).toHaveBeenNthCalledWith(1, message);
    expect(cancelled.preventDefault).toHaveBeenCalledOnce();
    expect(accepted.preventDefault).not.toHaveBeenCalled();
  });

  it('reveals and re-masks a secret through its declarative button', async () => {
    const button = new ButtonFixture('button');
    button.setAttribute('data-secret-field-path', 'notifications.apiKey');
    button.setAttribute('data-secret-input-id', 'secret');
    const input = new InputFixture('secret');
    input.parentElement = { querySelector: () => button };
    const { fetch } = setupDom({
      inputs: { secret: input },
      secretButtons: [button],
    });
    fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true, value: 'decrypted' }),
    });

    initializeAdminConfigurationCommon();

    button.trigger('click');
    await flushPromises();
    expect(input.type).toBe('text');
    expect(input.value).toBe('decrypted');

    button.trigger('click');
    expect(input.type).toBe('password');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('ignores malformed declarative secret controls', () => {
    const missingFieldPath = new ButtonFixture('button');
    missingFieldPath.setAttribute('data-secret-input-id', 'secret');
    const missingInputId = new ButtonFixture('button');
    missingInputId.setAttribute(
      'data-secret-field-path',
      'notifications.apiKey'
    );
    const { fetch } = setupDom({
      secretButtons: [missingFieldPath, missingInputId],
    });

    initializeAdminConfigurationCommon();

    missingFieldPath.trigger('click');
    missingInputId.trigger('click');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('is statically importable without browser globals', () => {
    expect(initializeAdminConfigurationCommon).toBeTypeOf('function');
  });

  it('returns its controller and installs inactivity activity listeners', () => {
    const { activityListeners } = setupDom();

    const controller = initializeAdminConfigurationCommon();

    expect(controller.revealTenantSecret).toEqual(expect.any(Function));
    expect(controller.remaskTenantSecret).toEqual(expect.any(Function));
    expect(controller.refreshIcons).toEqual(expect.any(Function));
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

  it('refreshes icons only when the optional icon library is available', () => {
    const withIcons = setupDom();
    const withIconsController = initializeAdminConfigurationCommon();

    withIconsController.refreshIcons();

    expect(withIcons.createIcons).toHaveBeenCalledOnce();
    const withoutIcons = setupDom({ lucide: false });
    const withoutIconsController = initializeAdminConfigurationCommon();

    expect(() => withoutIconsController.refreshIcons()).not.toThrow();
    expect(withoutIcons.createIcons).not.toHaveBeenCalled();
  });

  it.each([
    { csrf: null, input: new InputFixture('secret') },
    { csrf: '', input: new InputFixture('secret') },
    { csrf: 'csrf', input: null },
  ])('does not reveal without its required controls: %#', async scenario => {
    const inputs: Record<string, InputFixture> = {};
    if (scenario.input) inputs.secret = scenario.input;
    const { fetch } = setupDom({
      csrf: scenario.csrf,
      inputs,
    });
    const controller = initializeAdminConfigurationCommon();
    const reveal = controller.revealTenantSecret;
    reveal('notifications.apiKey', 'secret');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not reveal when the secret input has no associated button', () => {
    const input = new InputFixture('secret');
    input.parentElement = { querySelector: () => null };
    const { fetch } = setupDom({ inputs: { secret: input } });
    const controller = initializeAdminConfigurationCommon();

    controller.revealTenantSecret('notifications.apiKey', 'secret');

    expect(fetch).not.toHaveBeenCalled();
  });

  it('reveals, shoulder-protects, and re-masks a secret', async () => {
    const button = new ButtonFixture('button');
    const input = new InputFixture('secret');
    input.setAttribute('data-field-path', 'notifications.apiKey');
    input.parentElement = { querySelector: () => button };
    const { fetch } = setupDom({ inputs: { secret: input } });
    fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true, value: 'decrypted' }),
    });
    const controller = initializeAdminConfigurationCommon();
    const reveal = controller.revealTenantSecret;
    const remask = controller.remaskTenantSecret;

    reveal('notifications.apiKey', 'secret');
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

    input.trigger('blur');
    expect(input.getAttribute('data-invisible-style')).toBe('true');
    expect(input.style.color).toBe('transparent');
    expect(input.style.caretColor).toBe('#f97316');

    input.trigger('focus');
    expect(input.getAttribute('data-invisible-style')).toBeNull();
    expect(input.style.color).toBe('');
    expect(input.style.caretColor).toBe('');

    remask('secret');
    expect(input.type).toBe('password');
    expect(input.getAttribute('data-invisible-style')).toBeNull();

    input.trigger('blur');
    expect(input.getAttribute('data-invisible-style')).toBeNull();

    reveal('notifications.apiKey', 'secret');
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
      const { fetch } = setupDom({ inputs: { secret: input } });
      if (testCase.rejects) {
        fetch.mockRejectedValue(testCase.response);
      } else {
        fetch.mockResolvedValue({
          json: vi.fn().mockResolvedValue(testCase.response),
        });
      }
      const controller = initializeAdminConfigurationCommon();

      controller.revealTenantSecret('notifications.apiKey', 'secret');
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
    const { appendToBody, fetch } = setupDom({
      inputs: { secret: input },
    });
    fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true, value: 'decrypted' }),
    });
    const controller = initializeAdminConfigurationCommon();
    controller.revealTenantSecret('notifications.apiKey', 'secret');
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
    const { activityListeners, fetch } = setupDom({
      inputs: { secret: input },
    });
    fetch.mockResolvedValue({
      json: vi.fn().mockResolvedValue({ success: true, value: 'decrypted' }),
    });
    const controller = initializeAdminConfigurationCommon();
    controller.revealTenantSecret('notifications.apiKey', 'secret');
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
    initializeAdminConfigurationCommon();

    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

    expect(appendToBody).not.toHaveBeenCalled();
  });

  it('re-masks safely when the input or its optional button is absent', () => {
    const input = new InputFixture('secret');
    setupDom({ inputs: { secret: input } });
    const controller = initializeAdminConfigurationCommon();
    const remask = controller.remaskTenantSecret;

    expect(() => remask('missing')).not.toThrow();
    expect(() => remask('secret')).not.toThrow();
    expect(input.type).toBe('password');
  });
});
