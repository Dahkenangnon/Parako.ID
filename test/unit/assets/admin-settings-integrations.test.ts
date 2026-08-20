import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  IntegrationsSettingsManager,
  initializeIntegrationsSettingsPage,
  registerIntegrationsSettingsEntry,
} from '../../../src/assets/js/admin/settings/integrations.js';

type DomEvent = {
  currentTarget?: unknown;
  key?: string;
  preventDefault?: () => void;
  target?: unknown;
};
type DomListener = (event: DomEvent) => unknown;

class ElementFixture {
  public readonly attributes = new Map<string, string>();
  public readonly children: ElementFixture[] = [];
  public readonly classList = { add: vi.fn(), remove: vi.fn() };
  public className = '';
  public disabled = false;
  public readonly focus = vi.fn();
  public innerHTML = '';
  public parentNode: ElementFixture | null = null;
  public readonly reset = vi.fn();
  public textContent = '';
  public type = '';
  public value = '';
  private readonly listeners = new Map<string, DomListener[]>();

  public constructor(public readonly tagName: string) {}

  public addEventListener(name: string, listener: DomListener): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public appendChild(child: ElementFixture): ElementFixture {
    child.parentNode = this;
    this.children.push(child);
    return child;
  }

  public remove(): void {
    this.parentNode?.removeChild(this);
  }

  public removeChild(child: ElementFixture): ElementFixture {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentNode = null;
    return child;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public trigger(name: string, event: DomEvent = { target: this }): unknown[] {
    return this.listeners.get(name)?.map(listener => listener(event)) ?? [];
  }

  public async triggerAsync(
    name: string,
    event: DomEvent = { target: this }
  ): Promise<void> {
    await Promise.all(
      this.listeners.get(name)?.map(listener => listener(event)) ?? []
    );
  }

  public listenerCount(name: string): number {
    return this.listeners.get(name)?.length ?? 0;
  }
}

function setupDom(
  options: {
    csrf?: string;
    elements?: Record<string, ElementFixture>;
    hasForm?: boolean;
    pathname?: string;
    readyState?: DocumentReadyState;
    withLucide?: boolean;
  } = {}
) {
  const body = new ElementFixture('body');
  const created: ElementFixture[] = [];
  const documentListeners = new Map<string, Set<DomListener>>();
  const form = new ElementFixture('form');
  const resetButton = new ElementFixture('button');
  const testEmailButton = new ElementFixture('button');
  const createIcons = vi.fn();
  const browserWindow: Record<string, unknown> = {
    location: { pathname: options.pathname ?? '/admin/settings/integrations' },
    ...(options.withLucide === false ? {} : { lucide: { createIcons } }),
  };

  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: DomListener) => {
      const listeners = documentListeners.get(name) ?? new Set<DomListener>();
      listeners.add(listener);
      documentListeners.set(name, listeners);
    }),
    body,
    createElement: vi.fn((tagName: string) => {
      const element = new ElementFixture(tagName);
      created.push(element);
      return element;
    }),
    getElementById: vi.fn((id: string) => options.elements?.[id] ?? null),
    querySelector: vi.fn((selector: string) => {
      if (selector === 'form') return options.hasForm === false ? null : form;
      if (selector === 'form[data-integrations-settings]') {
        return options.hasForm === false ? null : form;
      }
      if (selector === 'button[data-integrations-reset]') return resetButton;
      if (selector === 'button[data-integrations-test-email]') {
        return testEmailButton;
      }
      if (selector === 'input[name="_csrf"]') {
        if (options.csrf === undefined) return null;
        const csrfInput = new ElementFixture('input');
        csrfInput.value = options.csrf;
        return csrfInput;
      }
      return null;
    }),
    removeEventListener: vi.fn((name: string, listener: DomListener) => {
      documentListeners.get(name)?.delete(listener);
    }),
    readyState: options.readyState ?? 'complete',
  });

  return {
    body,
    browserWindow,
    createIcons,
    created,
    dispatchDocument: (name: string, event: DomEvent) =>
      documentListeners.get(name)?.forEach(listener => listener(event)),
    documentListeners,
    form,
    resetButton,
    runReady: () =>
      documentListeners
        .get('DOMContentLoaded')
        ?.forEach(listener => listener({})),
    testEmailButton,
  };
}

function makeValidIntegrationElements(): Record<string, ElementFixture> {
  const ids = [
    'integrations.email.smtp_host',
    'integrations.email.smtp_port',
    'integrations.email.smtp_username',
    'integrations.email.smtp_password',
    'integrations.email.from',
    'integrations.urls.website',
    'integrations.urls.contact',
    'integrations.urls.privacy_policy',
    'integrations.urls.terms_of_service',
  ];
  return Object.fromEntries(
    ids.map(id => {
      const input = new ElementFixture('input');
      input.value = id.endsWith('smtp_port') ? '587' : 'configured';
      return [id, input];
    })
  );
}

describe('admin integrations settings manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('can be constructed when browser globals are unavailable', () => {
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('window', undefined);

    expect(() => new IntegrationsSettingsManager()).not.toThrow();
  });

  it('binds form, reset, and test-email actions without inline-handler globals', () => {
    const context = setupDom();

    initializeIntegrationsSettingsPage();

    expect(context.form.listenerCount('submit')).toBe(1);
    expect(context.resetButton.listenerCount('click')).toBe(1);
    expect(context.testEmailButton.listenerCount('click')).toBe(1);
    expect(context.browserWindow).not.toHaveProperty('resetForm');
    expect(context.browserWindow).not.toHaveProperty('testEmail');
  });

  it('guards the route and registers immediately or after DOM readiness', () => {
    const lookalike = setupDom({
      pathname: '/admin/settings/integrations-preview',
    });
    expect(initializeIntegrationsSettingsPage()).toBeNull();
    expect(lookalike.form.listenerCount('submit')).toBe(0);

    const loading = setupDom({ readyState: 'loading' });
    registerIntegrationsSettingsEntry();
    expect(loading.form.listenerCount('submit')).toBe(0);
    loading.runReady();
    expect(loading.form.listenerCount('submit')).toBe(1);

    const complete = setupDom({ readyState: 'complete' });
    registerIntegrationsSettingsEntry();
    expect(complete.form.listenerCount('submit')).toBe(1);
  });

  it('prevents native submission before validation and then requests critical-change confirmation', async () => {
    const elements = makeValidIntegrationElements();
    const confirmCriticalChange = vi.fn().mockResolvedValue(false);
    const context = setupDom({ elements, withLucide: false });
    initializeIntegrationsSettingsPage(confirmCriticalChange);
    const event = { preventDefault: vi.fn(), target: context.form };

    const pending = Promise.all(context.form.trigger('submit', event));
    const duplicate = context.form.trigger('submit', {
      preventDefault: vi.fn(),
      target: context.form,
    });

    expect(event.preventDefault).toHaveBeenCalledOnce();
    await Promise.all([pending, ...duplicate]);
    expect(confirmCriticalChange).toHaveBeenCalledOnce();
    expect(confirmCriticalChange).toHaveBeenCalledWith(event);
  });

  it('contains critical-change confirmation failures', async () => {
    const context = setupDom({
      elements: makeValidIntegrationElements(),
      withLucide: false,
    });
    const failure = new Error('confirmation failed');
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    initializeIntegrationsSettingsPage(vi.fn().mockRejectedValue(failure));

    await context.form.triggerAsync('submit', {
      preventDefault: vi.fn(),
      target: context.form,
    });

    expect(error).toHaveBeenCalledWith(
      'Failed to confirm integrations settings change',
      failure
    );
    expect(
      context.created.some(element => element.textContent === 'Unable to Save')
    ).toBe(true);
  });

  it('exposes reset confirmation as an accessible dialog and Escape cancels it', async () => {
    const context = setupDom();
    initializeIntegrationsSettingsPage();

    const pending = Promise.all(context.resetButton.trigger('click'));
    const dialog = context.created.find(
      element => element.attributes.get('role') === 'dialog'
    );
    const cancel = context.created.find(
      element =>
        element.tagName === 'button' && element.textContent === 'Cancel'
    );

    expect(dialog?.attributes.get('aria-modal')).toBe('true');
    expect(dialog?.attributes.get('aria-labelledby')).toBeTruthy();
    expect(dialog?.attributes.get('aria-describedby')).toBeTruthy();
    expect(cancel?.focus).toHaveBeenCalledOnce();

    context.dispatchDocument('keydown', { key: 'Escape' });
    await pending;

    expect(context.form.reset).not.toHaveBeenCalled();
    expect(context.body.children).toHaveLength(0);
    expect(context.documentListeners.get('keydown')?.size ?? 0).toBe(0);
  });

  it('removes the dialog keyboard listener when reset is cancelled', async () => {
    const { body, created, documentListeners, form, resetButton } = setupDom();
    initializeIntegrationsSettingsPage();

    const result = Promise.all(resetButton.trigger('click'));
    const cancel = created.find(
      element =>
        element.tagName === 'button' && element.textContent === 'Cancel'
    );
    cancel?.trigger('click');
    cancel?.trigger('click');
    await result;

    expect(form.reset).not.toHaveBeenCalled();
    expect(body.children).toHaveLength(0);
    expect(documentListeners.get('keydown')?.size ?? 0).toBe(0);
  });

  it('keeps loading feedback on the test-email button when its icon is clicked', async () => {
    const emailInput = new ElementFixture('input');
    emailInput.value = 'person@example.com';
    const context = setupDom({
      csrf: 'csrf-token',
      elements: { 'test-email': emailInput },
    });
    const button = context.testEmailButton;
    button.innerHTML = '<i>send</i>Send Test';
    const icon = new ElementFixture('i');
    button.appendChild(icon);
    let resolveFetch!: (response: { json: () => Promise<unknown> }) => void;
    const fetch = vi.fn().mockReturnValue(
      new Promise(resolve => {
        resolveFetch = resolve;
      })
    );
    vi.stubGlobal('fetch', fetch);
    initializeIntegrationsSettingsPage();

    const result = Promise.all(
      button.trigger('click', { currentTarget: button, target: icon })
    );
    const confirm = context.created.find(
      element =>
        element.tagName === 'button' && element.textContent === 'Yes, Send Test'
    );
    confirm?.trigger('click');
    await Promise.resolve();

    expect(button.disabled).toBe(true);
    expect(button.innerHTML).toContain('Sending...');
    expect(icon.disabled).toBe(false);

    resolveFetch({
      json: vi.fn().mockResolvedValue({ success: true }),
    });
    await result;

    expect(fetch).toHaveBeenCalledWith(
      '/admin/settings/integrations/test-email',
      expect.objectContaining({
        body: JSON.stringify({ email: 'person@example.com' }),
        headers: expect.objectContaining({ 'X-CSRF-Token': 'csrf-token' }),
      })
    );
    expect(button).toMatchObject({
      disabled: false,
      innerHTML: '<i>send</i>Send Test',
    });
    expect(icon.innerHTML).toBe('');
  });

  it('rejects a whitespace-only test email before confirmation', async () => {
    const emailInput = new ElementFixture('input');
    emailInput.value = '   ';
    const context = setupDom({
      elements: { 'test-email': emailInput },
      withLucide: false,
    });
    const button = context.testEmailButton;
    initializeIntegrationsSettingsPage();

    const result = Promise.all(
      button.trigger('click', { currentTarget: null, target: button })
    );
    await result;

    expect(emailInput.focus).toHaveBeenCalledOnce();
    expect(
      context.created.some(element => element.textContent === 'Email Required')
    ).toBe(true);
    expect(
      context.created.some(element => element.textContent === 'Send Test Email')
    ).toBe(false);
  });

  it.each([
    {
      missingId: 'integrations.email.smtp_host',
      expected:
        'All email configuration fields are required. Please fill in all fields.',
    },
    {
      missingId: 'integrations.urls.website',
      expected:
        'All URL configuration fields are required. Please fill in all fields.',
    },
    { missingId: null, expected: null },
  ])(
    'validates integration settings before native submission: $missingId',
    async ({ expected, missingId }) => {
      const elements = makeValidIntegrationElements();
      if (missingId) elements[missingId].value = '';
      const context = setupDom({ elements, withLucide: false });
      const confirmCriticalChange = vi.fn().mockResolvedValue(false);
      initializeIntegrationsSettingsPage(confirmCriticalChange);
      const event = { preventDefault: vi.fn(), target: context.form };

      await context.form.triggerAsync('submit', event);

      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(confirmCriticalChange).toHaveBeenCalledTimes(expected ? 0 : 1);
      if (expected) {
        expect(
          context.created.some(element => element.textContent === expected)
        ).toBe(true);
      }
    }
  );

  it('initializes safely when the settings form is absent', () => {
    const context = setupDom({ hasForm: false });

    expect(initializeIntegrationsSettingsPage).not.toThrow();
    expect(context.form.listenerCount('submit')).toBe(0);
    expect(context.browserWindow).not.toHaveProperty('resetForm');
    expect(context.browserWindow).not.toHaveProperty('testEmail');
  });

  it('resets after confirmation and supports manual and timed notification dismissal', async () => {
    vi.useFakeTimers();
    const context = setupDom();
    initializeIntegrationsSettingsPage();

    const firstReset = Promise.all(context.resetButton.trigger('click'));
    context.created
      .find(
        element =>
          element.tagName === 'button' &&
          element.textContent === 'Yes, Reset Form'
      )
      ?.trigger('click');
    await firstReset;

    expect(context.form.reset).toHaveBeenCalledOnce();
    expect(context.documentListeners.get('keydown')?.size ?? 0).toBe(0);
    expect(
      context.created.some(element => element.textContent === 'Form Reset')
    ).toBe(true);
    const close = context.created.find(
      element =>
        element.tagName === 'button' &&
        element.children.some(
          child => child.attributes.get('data-lucide') === 'x'
        )
    );
    close?.trigger('click');
    expect(context.body.children).toHaveLength(0);

    const secondReset = Promise.all(context.resetButton.trigger('click'));
    const resetButtons = context.created.filter(
      element =>
        element.tagName === 'button' &&
        element.textContent === 'Yes, Reset Form'
    );
    resetButtons.at(-1)?.trigger('click');
    await secondReset;
    expect(context.body.children).toHaveLength(1);

    vi.advanceTimersByTime(5000);
    expect(context.body.children).toHaveLength(0);
  });

  it('cancels test-email confirmation through backdrop and Escape only', async () => {
    const emailInput = new ElementFixture('input');
    emailInput.value = 'person@example.com';
    const context = setupDom({
      elements: { 'test-email': emailInput },
      withLucide: false,
    });
    const button = context.testEmailButton;
    initializeIntegrationsSettingsPage();

    const backdropResult = Promise.all(
      button.trigger('click', { currentTarget: button, target: button })
    );
    const backdrop = context.body.children[0];
    backdrop.trigger('click', { target: backdrop.children[0] });
    expect(context.body.children).toHaveLength(1);
    backdrop.trigger('click', { target: backdrop });
    await backdropResult;
    expect(context.body.children).toHaveLength(0);

    const escapeResult = Promise.all(
      button.trigger('click', { currentTarget: button, target: button })
    );
    context.dispatchDocument('keydown', { key: 'Enter' });
    expect(context.body.children).toHaveLength(1);
    context.dispatchDocument('keydown', { key: 'Escape' });
    await escapeResult;
    expect(context.body.children).toHaveLength(0);
    expect(context.documentListeners.get('keydown')?.size ?? 0).toBe(0);
  });

  it.each([
    {
      data: { error: 'SMTP rejected the message', success: false },
      expected: 'SMTP rejected the message',
    },
    {
      data: { success: false },
      expected:
        'Failed to send test email. Please check your SMTP configuration.',
    },
  ])(
    'reports rejected test-email responses: $expected',
    async ({ data, expected }) => {
      const emailInput = new ElementFixture('input');
      emailInput.value = 'person@example.com';
      const context = setupDom({
        elements: { 'test-email': emailInput },
        withLucide: false,
      });
      const button = context.testEmailButton;
      button.innerHTML = 'Send Test';
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue(data),
        })
      );
      initializeIntegrationsSettingsPage();

      const result = Promise.all(
        button.trigger('click', { currentTarget: button, target: button })
      );
      context.created
        .find(
          element =>
            element.tagName === 'button' &&
            element.textContent === 'Yes, Send Test'
        )
        ?.trigger('click');
      await result;

      expect(
        context.created.some(element => element.textContent === expected)
      ).toBe(true);
      expect(button).toMatchObject({
        disabled: false,
        innerHTML: 'Send Test',
      });
    }
  );

  it.each([
    {
      error: new Error('offline'),
      expected: 'Failed to send test email: offline',
    },
    {
      error: 'offline',
      expected: 'Failed to send test email: Unknown error',
    },
  ])(
    'reports test-email request failures: $expected',
    async ({ error, expected }) => {
      const emailInput = new ElementFixture('input');
      emailInput.value = 'person@example.com';
      const context = setupDom({
        elements: { 'test-email': emailInput },
        withLucide: false,
      });
      const button = context.testEmailButton;
      button.innerHTML = 'Send Test';
      const fetch = vi.fn().mockRejectedValue(error);
      vi.stubGlobal('fetch', fetch);
      initializeIntegrationsSettingsPage();

      const result = Promise.all(
        button.trigger('click', { currentTarget: button, target: button })
      );
      context.created
        .find(
          element =>
            element.tagName === 'button' &&
            element.textContent === 'Yes, Send Test'
        )
        ?.trigger('click');
      await result;

      expect(fetch).toHaveBeenCalledWith(
        '/admin/settings/integrations/test-email',
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-CSRF-Token': '' }),
        })
      );
      expect(
        context.created.some(element => element.textContent === expected)
      ).toBe(true);
      expect(button).toMatchObject({ disabled: false, innerHTML: 'Send Test' });
    }
  );
});
