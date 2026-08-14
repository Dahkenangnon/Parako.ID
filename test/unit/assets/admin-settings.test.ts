import { afterEach, describe, expect, it, vi } from 'vitest';

interface DomEvent {
  key?: string;
  preventDefault?: ReturnType<typeof vi.fn>;
  target?: ElementFixture;
}

type DomListener = (event?: DomEvent) => unknown;

class ClassListFixture {
  private readonly values = new Set<string>();

  public add(...names: string[]): void {
    names.forEach(name => this.values.add(name));
  }

  public contains(name: string): boolean {
    return this.values.has(name);
  }

  public remove(...names: string[]): void {
    names.forEach(name => this.values.delete(name));
  }
}

class ElementFixture {
  public action = '';
  public readonly attributes = new Map<string, string>();
  public readonly children: ElementFixture[] = [];
  public className = '';
  public readonly classList = new ClassListFixture();
  public disabled = false;
  public readonly focus = vi.fn();
  public readonly listeners = new Map<string, DomListener[]>();
  public parentElement: ElementFixture | null = null;
  public readonly queryResults = new Map<string, ElementFixture>();
  public readonly remove = vi.fn(() => {
    this.parentElement = null;
  });
  public readonly style: Record<string, string> = {};
  public readonly submit = vi.fn();
  public textContent = '';
  public type = '';
  public value = '';

  public addEventListener(name: string, listener: DomListener): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public appendChild(child: ElementFixture): ElementFixture {
    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public hasAttribute(name: string): boolean {
    return this.attributes.has(name);
  }

  public querySelector(selector: string): ElementFixture | null {
    return this.queryResults.get(selector) ?? null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public trigger(name: string, event: DomEvent = { target: this }): unknown[] {
    return (
      this.listeners.get(name)?.map(listener => listener.call(this, event)) ??
      []
    );
  }
}

interface DomOptions {
  debugState?: string;
  environment?: string | null;
  lucide?: 'callable' | 'invalid' | 'missing';
  pathname?: string;
}

interface SettingsManagerFixture {
  INACTIVITY_TIMEOUT: number;
  autoRemaskAllSecrets(): void;
  confirmCriticalChange(event: DomEvent): Promise<boolean>;
  debug: boolean;
  getCsrfToken(): string | null;
  log(message: string, data?: unknown): void;
  remaskSecret(fieldId: string): void;
  revealSecret(fieldId: string, fieldPath: string): Promise<void>;
  revealedFields: Set<string>;
  setupInvisibleTextHandlers(field: ElementFixture): void;
  showConfirmDialog(
    title: string,
    message: string,
    confirmText?: string,
    cancelText?: string
  ): Promise<boolean>;
  showError(message: string): void;
  showNotification(title: string, message: string, iconName?: string): void;
  updateButtonContent(
    button: ElementFixture,
    iconName: string,
    text: string,
    iconClass?: string
  ): void;
}

function setupDom(options: DomOptions | string = {}) {
  let ready: (() => void) | undefined;
  const normalized =
    typeof options === 'string' ? { pathname: options } : options;
  const criticalForms: ElementFixture[] = [];
  const documentListeners = new Map<string, DomListener[]>();
  const elements = new Map<string, ElementFixture>();
  const secretButtons: ElementFixture[] = [];
  const body = new ElementFixture();
  const documentElement = new ElementFixture();
  if (normalized.environment)
    documentElement.setAttribute('data-env', normalized.environment);
  if (normalized.debugState !== undefined) {
    const state = new ElementFixture();
    state.textContent = normalized.debugState;
    elements.set('___MAIN_STATE___', state);
  }
  const createIcons = vi.fn();
  const browserWindow: Record<string, unknown> = {
    location: { pathname: normalized.pathname ?? '/admin/settings' },
  };
  if (normalized.lucide === 'callable') browserWindow.lucide = { createIcons };
  if (normalized.lucide === 'invalid') browserWindow.lucide = {};
  vi.useFakeTimers();
  vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: DomListener) => {
      if (name === 'DOMContentLoaded') {
        ready = listener;
        return;
      }
      const listeners = documentListeners.get(name) ?? [];
      listeners.push(listener);
      documentListeners.set(name, listeners);
    }),
    removeEventListener: vi.fn((name: string, listener: DomListener) => {
      const listeners = documentListeners.get(name) ?? [];
      documentListeners.set(
        name,
        listeners.filter(candidate => candidate !== listener)
      );
    }),
    body,
    createElement: vi.fn(() => new ElementFixture()),
    createTextNode: vi.fn((text: string) => {
      const node = new ElementFixture();
      node.textContent = text;
      return node;
    }),
    documentElement,
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
    querySelector: vi.fn((selector: string) =>
      selector === 'input[name="_csrf"]'
        ? (elements.get('_csrf') ?? null)
        : null
    ),
    querySelectorAll: vi.fn((selector: string) => {
      if (selector === 'form[data-confirm-critical-change]') {
        return criticalForms;
      }
      if (selector === 'button[data-secret-input-id][data-secret-field-path]') {
        return secretButtons;
      }
      return [];
    }),
  });
  return {
    body,
    browserWindow,
    createIcons,
    criticalForms,
    documentListeners,
    elements,
    runReady: () => ready?.(),
    secretButtons,
  };
}

async function loadManager(dom: ReturnType<typeof setupDom>) {
  await import('../../../src/assets/js/admin/settings.js');
  dom.runReady();
  return dom.browserWindow
    .adminSettingsManager as unknown as SettingsManagerFixture;
}

function addFieldWithButton(dom: ReturnType<typeof setupDom>, id: string) {
  const parent = new ElementFixture();
  const field = new ElementFixture();
  const button = new ElementFixture();
  field.parentElement = parent;
  parent.queryResults.set('button', button);
  dom.elements.set(id, field);
  return { button, field, parent };
}

describe('admin settings manager', () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('does not initialize on a lookalike route outside the settings boundary', async () => {
    const dom = setupDom('/admin/settings-preview');

    await import('../../../src/assets/js/admin/settings.js');
    dom.runReady();

    expect(dom.browserWindow).not.toHaveProperty('adminSettingsManager');
  });

  it('initializes on nested settings routes and enables debug logging from page state', async () => {
    const dom = setupDom({
      debugState: JSON.stringify({ debug: true }),
      pathname: '/admin/settings/security',
    });
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const manager = await loadManager(dom);

    manager.log('safe event', { field: 'security' });

    expect(manager.debug).toBe(true);
    expect(consoleLog).toHaveBeenCalledWith('[AdminSettings]', 'safe event', {
      field: 'security',
    });
    expect(dom.documentListeners.size).toBe(6);
  });

  it('uses development debug fallback only when page state is malformed', async () => {
    const dom = setupDom({
      debugState: '{invalid',
      environment: 'development',
    });
    const manager = await loadManager(dom);

    expect(manager.debug).toBe(true);
  });

  it('keeps debug logging disabled without an explicit debug signal', async () => {
    const dom = setupDom();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const manager = await loadManager(dom);

    manager.log('ignored');

    expect(manager.debug).toBe(false);
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it('accepts the exact settings route and empty page state defaults', async () => {
    const dom = setupDom({ debugState: '', pathname: '/admin/settings' });
    const manager = await loadManager(dom);

    expect(manager.debug).toBe(false);
    expect(dom.browserWindow).toHaveProperty('adminSettingsManager');
  });

  it('auto-remasks secrets after the documented two minutes of inactivity', async () => {
    const manager = await loadManager(setupDom());

    expect(manager.INACTIVITY_TIMEOUT).toBe(2 * 60 * 1000);
  });

  it('resets and runs the inactivity timer in response to browser activity', async () => {
    const dom = setupDom();
    const manager = await loadManager(dom);
    const remask = vi
      .spyOn(manager, 'autoRemaskAllSecrets')
      .mockImplementation(() => {});

    dom.documentListeners.get('mousedown')?.[0]?.();
    vi.advanceTimersByTime(2 * 60 * 1000);

    expect(remask).toHaveBeenCalledOnce();
  });

  it('auto-remasks every revealed field and shows an inactivity notification', async () => {
    const dom = setupDom();
    const manager = await loadManager(dom);
    const first = addFieldWithButton(dom, 'first');
    const second = addFieldWithButton(dom, 'second');
    first.field.setAttribute('data-masked-value', '******');
    second.field.setAttribute('data-masked-value', '********');
    manager.revealedFields.add('first');
    manager.revealedFields.add('second');
    const notification = vi
      .spyOn(manager, 'showNotification')
      .mockImplementation(() => {});

    manager.autoRemaskAllSecrets();

    expect(first.field.value).toBe('******');
    expect(second.field.value).toBe('********');
    expect(manager.revealedFields.size).toBe(0);
    expect(notification).toHaveBeenCalledWith(
      'Secrets Auto-Masked',
      expect.stringContaining('automatically masked'),
      'shield-alert'
    );
  });

  it('does nothing when the inactivity timer finds no revealed fields', async () => {
    const manager = await loadManager(setupDom());
    const notification = vi
      .spyOn(manager, 'showNotification')
      .mockImplementation(() => {});

    manager.autoRemaskAllSecrets();

    expect(notification).not.toHaveBeenCalled();
  });

  it.each(['callable', 'invalid', 'missing'] as const)(
    'renders and expires notifications with %s lucide integration',
    async lucide => {
      const dom = setupDom({ lucide });
      const manager = await loadManager(dom);

      manager.showNotification('Protected', 'The secret was masked.');

      const notification = dom.body.children.at(-1);
      expect(notification?.className).toContain('bg-amber-500');
      expect(
        notification?.children[0]?.children[1]?.children[0]?.textContent
      ).toBe('Protected');
      expect(dom.createIcons).toHaveBeenCalledTimes(
        lucide === 'callable' ? 1 : 0
      );

      vi.advanceTimersByTime(5000);
      expect(notification?.remove).toHaveBeenCalledOnce();
    }
  );

  it('hides revealed text outside focus and restores visibility while focused', async () => {
    const manager = await loadManager(setupDom());
    const field = new ElementFixture();

    manager.setupInvisibleTextHandlers(field);
    field.trigger('blur');

    expect(field.getAttribute('data-invisible-style')).toBe('true');
    expect(field.style.color).toBe('transparent');
    expect(field.style.caretColor).toBe('#f97316');

    field.trigger('focus');
    expect(field.hasAttribute('data-invisible-style')).toBe(false);
    expect(field.style.color).toBe('');

    field.setAttribute('readonly', 'readonly');
    field.trigger('blur');
    expect(field.hasAttribute('data-invisible-style')).toBe(false);

    field.trigger('focus');
    expect(field.hasAttribute('data-invisible-style')).toBe(false);
  });

  it('reads the CSRF token when present and otherwise returns null', async () => {
    const dom = setupDom();
    const manager = await loadManager(dom);

    expect(manager.getCsrfToken()).toBeNull();

    const csrf = new ElementFixture();
    csrf.value = 'csrf-token';
    dom.elements.set('_csrf', csrf);
    expect(manager.getCsrfToken()).toBe('csrf-token');
  });

  it('updates button content safely and initializes icons when available', async () => {
    const dom = setupDom({ lucide: 'callable' });
    const manager = await loadManager(dom);
    const button = new ElementFixture();
    button.textContent = 'old';

    manager.updateButtonContent(button, 'loader-2', 'Loading...', 'spin');

    expect(button.textContent).toBe('');
    expect(button.children[0]?.getAttribute('data-lucide')).toBe('loader-2');
    expect(button.children[0]?.className).toBe('spin');
    expect(button.children[1]?.textContent).toBe(' Loading...');
    expect(dom.createIcons).toHaveBeenCalledOnce();
  });

  it.each([
    ['cancel', false],
    ['confirm', true],
    ['backdrop', false],
  ] as const)(
    'resolves confirmation through the %s action',
    async (action, expected) => {
      const dom = setupDom({ lucide: 'callable' });
      const manager = await loadManager(dom);
      const result = manager.showConfirmDialog('Warning', 'Proceed?');
      const backdrop = dom.body.children.at(-1)!;
      const modal = backdrop.children[0]!;
      const footer = modal.children[2]!;

      if (action === 'cancel') footer.children[0]!.trigger('click');
      if (action === 'confirm') footer.children[1]!.trigger('click');
      if (action === 'backdrop')
        backdrop.trigger('click', { target: backdrop });

      await expect(result).resolves.toBe(expected);
      expect(backdrop.remove).toHaveBeenCalledOnce();
      expect(dom.createIcons).toHaveBeenCalledOnce();
    }
  );

  it('ignores clicks inside the confirmation modal', async () => {
    const dom = setupDom();
    const manager = await loadManager(dom);
    const result = manager.showConfirmDialog('Warning', 'Proceed?');
    const backdrop = dom.body.children.at(-1)!;
    const modal = backdrop.children[0]!;

    backdrop.trigger('click', { target: modal });
    expect(backdrop.remove).not.toHaveBeenCalled();

    const cancel = modal.children[2]!.children[0]!;
    cancel.trigger('click');
    await expect(result).resolves.toBe(false);
  });

  it('exposes confirmation semantics and cancels safely with Escape', async () => {
    const dom = setupDom();
    const manager = await loadManager(dom);
    const result = manager.showConfirmDialog('Warning', 'Proceed?');
    const backdrop = dom.body.children.at(-1)!;
    const modal = backdrop.children[0]!;
    const title = modal.children[0]!.children[1]!;
    const message = modal.children[1]!.children[0]!;
    const cancel = modal.children[2]!.children[0]!;

    expect(modal.getAttribute('role')).toBe('dialog');
    expect(modal.getAttribute('aria-modal')).toBe('true');
    expect(modal.getAttribute('aria-labelledby')).toBe(
      title.getAttribute('id')
    );
    expect(modal.getAttribute('aria-describedby')).toBe(
      message.getAttribute('id')
    );
    expect(cancel.focus).toHaveBeenCalledOnce();

    dom.documentListeners.get('keydown')?.[0]?.({ key: 'Escape' });

    await expect(result).resolves.toBe(false);
    expect(backdrop.remove).toHaveBeenCalledOnce();
    expect(dom.documentListeners.get('keydown')).toHaveLength(0);
  });

  it('renders dismissible error messages and removes them after five seconds', async () => {
    const dom = setupDom({ lucide: 'callable' });
    const manager = await loadManager(dom);

    manager.showError('<unsafe>');

    const error = dom.body.children.at(-1)!;
    const flex = error.children[0]!;
    expect(flex.children[1]?.children[1]?.textContent).toBe('<unsafe>');
    flex.children[2]!.trigger('click');
    expect(error.remove).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(5000);
    expect(error.remove).toHaveBeenCalledTimes(2);
    expect(dom.createIcons).toHaveBeenCalledOnce();
  });

  it('renders errors without an icon library', async () => {
    const dom = setupDom({ lucide: 'missing' });
    const manager = await loadManager(dom);

    manager.showError('Unavailable');

    expect(dom.body.children.at(-1)?.className).toContain('bg-destructive');
    expect(dom.createIcons).not.toHaveBeenCalled();
  });

  it.each([
    ['', 'security.jwt'],
    ['jwt', ''],
  ])('rejects invalid reveal parameters', async (fieldId, fieldPath) => {
    const manager = await loadManager(setupDom());
    const showError = vi
      .spyOn(manager, 'showError')
      .mockImplementation(() => {});

    await manager.revealSecret(fieldId, fieldPath);

    expect(showError).toHaveBeenCalledWith('Invalid field parameters');
  });

  it('stops reveal when the administrator cancels', async () => {
    const manager = await loadManager(setupDom());
    vi.spyOn(manager, 'showConfirmDialog').mockResolvedValue(false);
    const showError = vi
      .spyOn(manager, 'showError')
      .mockImplementation(() => {});

    await manager.revealSecret('jwt', 'security.jwt');

    expect(showError).not.toHaveBeenCalled();
  });

  it('reports missing reveal elements and missing CSRF independently', async () => {
    const dom = setupDom();
    const manager = await loadManager(dom);
    vi.spyOn(manager, 'showConfirmDialog').mockResolvedValue(true);
    const showError = vi
      .spyOn(manager, 'showError')
      .mockImplementation(() => {});

    await manager.revealSecret('missing', 'security.jwt');
    expect(showError).toHaveBeenLastCalledWith(
      'Could not find field or button element'
    );

    addFieldWithButton(dom, 'jwt');
    await manager.revealSecret('jwt', 'security.jwt');
    expect(showError).toHaveBeenLastCalledWith(
      'CSRF token not found. Please refresh the page.'
    );
  });

  it.each([
    ['scalar', 'unmasked-secret', 'unmasked-secret'],
    ['array', ['first', 'second'], 'first\nsecond'],
  ] as const)(
    'reveals a %s secret and supports re-masking it',
    async (_kind, value, expected) => {
      const dom = setupDom({ lucide: 'callable' });
      const manager = await loadManager(dom);
      vi.spyOn(manager, 'showConfirmDialog').mockResolvedValue(true);
      const { button, field } = addFieldWithButton(dom, 'jwt');
      field.value = '********';
      field.classList.add('bg-muted');
      field.setAttribute('readonly', 'readonly');
      field.setAttribute('data-field-path', 'security.jwt');
      const csrf = new ElementFixture();
      csrf.value = 'csrf-token';
      dom.elements.set('_csrf', csrf);
      const fetchMock = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true, value }),
        ok: true,
        status: 200,
      });
      vi.stubGlobal('fetch', fetchMock);

      await manager.revealSecret('jwt', 'security.jwt');

      expect(fetchMock).toHaveBeenCalledWith('/admin/settings/reveal-secret', {
        body: JSON.stringify({ fieldPath: 'security.jwt' }),
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-token',
        },
        method: 'POST',
      });
      expect(field.getAttribute('data-masked-value')).toBe('********');
      expect(field.value).toBe(expected);
      expect(field.hasAttribute('readonly')).toBe(false);
      expect(field.classList.contains('bg-background')).toBe(true);
      expect(field.classList.contains('border-orange-400')).toBe(true);
      expect(field.focus).toHaveBeenCalledOnce();
      expect(manager.revealedFields.has('jwt')).toBe(true);
      expect(button.disabled).toBe(false);

      manager.remaskSecret('jwt');
      expect(field.value).toBe('********');
      expect(field.getAttribute('readonly')).toBe('readonly');
      expect(manager.revealedFields.has('jwt')).toBe(false);
    }
  );

  it.each([
    ['429', 'Too many requests'],
    ['Too many requests', 'Too many requests'],
    ['403', 'permission denied'],
    ['Invalid field', 'permission denied'],
    ['401', 'Session expired'],
    ['server failure', 'Please try again'],
  ])('maps reveal error %s to a safe user message', async (error, expected) => {
    const dom = setupDom();
    const manager = await loadManager(dom);
    vi.spyOn(manager, 'showConfirmDialog').mockResolvedValue(true);
    const { button } = addFieldWithButton(dom, 'jwt');
    const csrf = new ElementFixture();
    csrf.value = 'csrf-token';
    dom.elements.set('_csrf', csrf);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ error, success: false }),
        ok: false,
        status: 400,
      })
    );
    const showError = vi
      .spyOn(manager, 'showError')
      .mockImplementation(() => {});

    await manager.revealSecret('jwt', 'security.jwt');

    expect(showError).toHaveBeenCalledWith(expect.stringContaining(expected));
    expect(button.disabled).toBe(false);
  });

  it('handles missing response values and non-Error failures safely', async () => {
    const dom = setupDom();
    const manager = await loadManager(dom);
    vi.spyOn(manager, 'showConfirmDialog').mockResolvedValue(true);
    addFieldWithButton(dom, 'jwt');
    const csrf = new ElementFixture();
    csrf.value = 'csrf-token';
    dom.elements.set('_csrf', csrf);
    const showError = vi
      .spyOn(manager, 'showError')
      .mockImplementation(() => {});

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: true }),
        ok: true,
        status: 200,
      })
    );
    await manager.revealSecret('jwt', 'security.jwt');
    expect(showError).toHaveBeenLastCalledWith(
      expect.stringContaining('Please try again')
    );

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('network failure'));
    await manager.revealSecret('jwt', 'security.jwt');
    expect(showError).toHaveBeenLastCalledWith(
      expect.stringContaining('Please try again')
    );
  });

  it('falls back to the response status when reveal error details are absent', async () => {
    const dom = setupDom();
    const manager = await loadManager(dom);
    vi.spyOn(manager, 'showConfirmDialog').mockResolvedValue(true);
    addFieldWithButton(dom, 'jwt');
    const csrf = new ElementFixture();
    csrf.value = 'csrf-token';
    dom.elements.set('_csrf', csrf);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({ success: false }),
        ok: false,
        status: 503,
      })
    );
    const showError = vi
      .spyOn(manager, 'showError')
      .mockImplementation(() => {});

    await manager.revealSecret('jwt', 'security.jwt');

    expect(showError).toHaveBeenCalledWith(
      expect.stringContaining('Please try again')
    );
  });

  it('validates remask parameters and missing elements', async () => {
    const manager = await loadManager(setupDom());
    const showError = vi
      .spyOn(manager, 'showError')
      .mockImplementation(() => {});

    manager.remaskSecret('');
    manager.remaskSecret('missing');

    expect(showError).toHaveBeenNthCalledWith(1, 'Invalid field parameter');
    expect(showError).toHaveBeenNthCalledWith(
      2,
      'Could not find field or button element'
    );
  });

  it('toggles declarative secret controls without replacing click handlers', async () => {
    const dom = setupDom();
    const { button } = addFieldWithButton(dom, 'jwt');
    button.setAttribute('data-secret-input-id', 'jwt');
    button.setAttribute('data-secret-field-path', 'security.jwt');
    dom.secretButtons.push(button);
    const manager = await loadManager(dom);
    const reveal = vi.spyOn(manager, 'revealSecret').mockResolvedValue();
    const remask = vi
      .spyOn(manager, 'remaskSecret')
      .mockImplementation(() => {});

    await Promise.all(button.trigger('click'));
    expect(reveal).toHaveBeenCalledWith('jwt', 'security.jwt');
    expect(remask).not.toHaveBeenCalled();

    manager.revealedFields.add('jwt');
    await Promise.all(button.trigger('click'));
    expect(remask).toHaveBeenCalledWith('jwt');
    expect(button.listeners.get('click')).toHaveLength(1);
  });

  it.each([
    ['/settings/security/secrets', 'Security Secrets'],
    ['/settings/security/mfa', 'MFA Configuration'],
    ['/settings/security/sessions', 'Session Configuration'],
    ['/settings/security/protection', 'Protection Configuration'],
    ['/settings/security', 'Authentication Configuration'],
    ['/settings/oidc', 'OIDC Configuration'],
    ['/settings/integrations', 'Integrations Configuration'],
    ['/settings/other', 'Configuration'],
  ])('confirms critical changes for %s', async (action, title) => {
    const manager = await loadManager(setupDom());
    const form = new ElementFixture();
    form.action = action;
    const warnings = new ElementFixture();
    warnings.value = JSON.stringify(['Review deployment']);
    form.queryResults.set('input[name="validation_warnings"]', warnings);
    const event = { preventDefault: vi.fn(), target: form };
    const confirm = vi
      .spyOn(manager, 'showConfirmDialog')
      .mockResolvedValue(true);

    await expect(manager.confirmCriticalChange(event)).resolves.toBe(true);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(confirm).toHaveBeenCalledWith(
      `Confirm ${title} Changes`,
      expect.stringContaining('Review deployment'),
      'Yes, Save Changes',
      'Cancel'
    );
    expect(form.submit).toHaveBeenCalledOnce();
  });

  it.each(['{invalid', JSON.stringify({ warning: 'not an array' })])(
    'ignores unusable server validation warnings: %s',
    async value => {
      const manager = await loadManager(setupDom());
      const form = new ElementFixture();
      form.action = '/settings/other';
      const warnings = new ElementFixture();
      warnings.value = value;
      form.queryResults.set('input[name="validation_warnings"]', warnings);
      const confirm = vi
        .spyOn(manager, 'showConfirmDialog')
        .mockResolvedValue(false);

      await expect(
        manager.confirmCriticalChange({ preventDefault: vi.fn(), target: form })
      ).resolves.toBe(false);

      expect(confirm).toHaveBeenCalledWith(
        'Confirm Configuration Changes',
        expect.not.stringContaining('Server Validation Warnings:'),
        'Yes, Save Changes',
        'Cancel'
      );
      expect(form.submit).not.toHaveBeenCalled();
    }
  );

  it.each([undefined, ''])(
    'handles an absent or empty validation warnings field: %s',
    async value => {
      const manager = await loadManager(setupDom());
      const form = new ElementFixture();
      form.action = '';
      if (value !== undefined) {
        const warnings = new ElementFixture();
        warnings.value = value;
        form.queryResults.set('input[name="validation_warnings"]', warnings);
      }
      vi.spyOn(manager, 'showConfirmDialog').mockResolvedValue(false);

      await expect(
        manager.confirmCriticalChange({ preventDefault: vi.fn(), target: form })
      ).resolves.toBe(false);

      expect(form.submit).not.toHaveBeenCalled();
    }
  );

  it('binds critical forms without exposing inline-handler globals', async () => {
    const dom = setupDom();
    const form = new ElementFixture();
    dom.criticalForms.push(form);
    const manager = await loadManager(dom);
    const confirm = vi
      .spyOn(manager, 'confirmCriticalChange')
      .mockResolvedValue(true);
    const event = { preventDefault: vi.fn(), target: form };

    await Promise.all(form.trigger('submit', event));

    expect(confirm).toHaveBeenCalledWith(event);
    expect(dom.browserWindow).not.toHaveProperty('revealSecret');
    expect(dom.browserWindow).not.toHaveProperty('remaskSecret');
    expect(dom.browserWindow).not.toHaveProperty('confirmCriticalChange');
  });
});
