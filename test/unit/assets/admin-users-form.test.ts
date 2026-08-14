import { afterEach, describe, expect, it, vi } from 'vitest';

interface DomEvent {
  preventDefault?: ReturnType<typeof vi.fn>;
}

type DomListener = (event: DomEvent) => void;

class ElementFixture {
  public readonly attributes = new Map<string, string>();
  public readonly classList = { add: vi.fn(), remove: vi.fn() };
  public checked = false;
  public className = '';
  public readonly listeners = new Map<string, DomListener[]>();
  public readOnly = false;
  public scrollHeight = 0;
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

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public trigger(name: string, event: DomEvent = {}): void {
    this.listeners.get(name)?.forEach(listener => listener.call(this, event));
  }
}

function setupDom(
  options: {
    isCreateForm?: boolean;
    stateText?: string;
    withDialog?: boolean;
    withEditForm?: boolean;
    withLucide?: boolean;
  } = {}
) {
  let ready: (() => void) | undefined;
  const elements = new Map<string, ElementFixture>();
  const createForm = new ElementFixture();
  const editForm = new ElementFixture();
  const queryResults = new Map<string, ElementFixture[]>();
  const showAlert = vi.fn().mockResolvedValue(undefined);
  const createIcons = vi.fn();
  const browserWindow: Record<string, unknown> = {
    crypto: {
      getRandomValues: vi.fn((values: Uint32Array) => values.fill(0)),
    },
  };
  if (options.withDialog !== false) browserWindow.dialog = { showAlert };
  if (options.withLucide !== false) browserWindow.lucide = { createIcons };
  if (options.isCreateForm !== false)
    elements.set('createUserForm', createForm);
  if (options.stateText !== undefined) {
    const state = new ElementFixture();
    state.textContent = options.stateText;
    elements.set('___ADMIN_USERS_FORM_STATE___', state);
  }

  vi.stubGlobal('window', browserWindow);
  const alert = vi.fn();
  vi.stubGlobal('alert', alert);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: () => void) => {
      if (name === 'DOMContentLoaded') ready = listener;
    }),
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
    querySelector: vi.fn((selector: string) =>
      selector === 'form' &&
      options.isCreateForm === false &&
      options.withEditForm !== false
        ? editForm
        : null
    ),
    querySelectorAll: vi.fn(
      (selector: string) => queryResults.get(selector) ?? []
    ),
  });

  return {
    alert,
    browserWindow,
    createForm,
    createIcons,
    editForm,
    elements,
    queryResults,
    runReady: () => ready?.(),
    showAlert,
  };
}

function setField(
  elements: Map<string, ElementFixture>,
  id: string,
  value: string,
  type = 'text'
): ElementFixture {
  const field = elements.get(id) ?? new ElementFixture();
  field.type = type;
  field.value = value;
  elements.set(id, field);
  return field;
}

describe('admin users form manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.resetModules();
  });

  it('cancels create-form submission before asynchronous validation', async () => {
    const { createForm, runReady, showAlert } = setupDom();
    await import('../../../src/assets/js/admin/users/form.js');
    runReady();
    const event = { preventDefault: vi.fn() };

    createForm.trigger('submit', event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(showAlert).toHaveBeenCalledOnce());
  });

  it('wires CSP-safe password toggles and refreshes icons when available', async () => {
    const { createIcons, elements, queryResults, runReady } = setupDom();
    const password = setField(elements, 'password', '', 'password');
    const icon = new ElementFixture();
    elements.set('password_icon', icon);
    const button = new ElementFixture();
    button.setAttribute('data-password-toggle', 'password');
    const missingTargetButton = new ElementFixture();
    missingTargetButton.setAttribute('data-password-toggle', 'missing');
    const buttonWithoutTarget = new ElementFixture();
    queryResults.set('[data-password-toggle]', [
      button,
      missingTargetButton,
      buttonWithoutTarget,
    ]);
    await import('../../../src/assets/js/admin/users/form.js');
    runReady();

    const click = { preventDefault: vi.fn() };
    button.trigger('click', click);
    expect(click.preventDefault).toHaveBeenCalledOnce();
    expect(password.type).toBe('text');
    expect(icon.attributes.get('data-lucide')).toBe('eye-off');

    button.trigger('click', { preventDefault: vi.fn() });
    expect(password.type).toBe('password');
    expect(icon.attributes.get('data-lucide')).toBe('eye');
    expect(createIcons).toHaveBeenCalledTimes(2);

    expect(() =>
      missingTargetButton.trigger('click', { preventDefault: vi.fn() })
    ).not.toThrow();
    expect(buttonWithoutTarget.listeners.get('click')).toBeUndefined();

    elements.delete('password_icon');
    expect(() =>
      button.trigger('click', { preventDefault: vi.fn() })
    ).not.toThrow();
  });

  it('changes icon attributes safely without a callable Lucide runtime', async () => {
    const { browserWindow, elements, queryResults, runReady } = setupDom({
      withLucide: false,
    });
    (browserWindow as { lucide?: unknown }).lucide = {};
    setField(elements, 'password', '', 'password');
    const icon = new ElementFixture();
    const button = new ElementFixture();
    button.setAttribute('data-password-toggle', 'password');
    elements.set('password_icon', icon);
    queryResults.set('[data-password-toggle]', [button]);
    await import('../../../src/assets/js/admin/users/form.js');
    runReady();

    expect(() =>
      button.trigger('click', { preventDefault: vi.fn() })
    ).not.toThrow();
    expect(icon.attributes.get('data-lucide')).toBe('eye-off');
  });

  it('generates, reveals, hides, and clears a secure password', async () => {
    vi.useFakeTimers();
    const { elements, runReady } = setupDom({
      withLucide: false,
    });
    const checkbox = setField(elements, 'generatePassword', '');
    const password = setField(elements, 'password', '', 'password');
    const confirm = setField(elements, 'confirm_password', '', 'password');
    const indicator = new ElementFixture();
    const matchText = new ElementFixture();
    elements.set('password_match_indicator', indicator);
    elements.set('password_match_text', matchText);
    await import('../../../src/assets/js/admin/users/form.js');
    runReady();

    checkbox.checked = true;
    checkbox.trigger('change');
    expect(password.value).toHaveLength(12);
    expect(password.value).toBe(confirm.value);
    expect(password.readOnly).toBe(true);
    expect(confirm.readOnly).toBe(true);
    expect(password.type).toBe('text');
    expect(matchText.textContent).toContain('Passwords match');

    vi.advanceTimersByTime(3000);
    expect(password.type).toBe('password');
    expect(confirm.type).toBe('password');

    checkbox.checked = false;
    checkbox.trigger('change');
    expect(password.value).toBe('');
    expect(confirm.value).toBe('');
    expect(password.readOnly).toBe(false);
    expect(confirm.readOnly).toBe(false);
    expect(indicator.classList.add).toHaveBeenCalledWith('hidden');
  });

  it('updates password-match feedback for empty, matching, and mismatched values', async () => {
    const { elements, runReady } = setupDom();
    const password = setField(elements, 'password', 'Strong1!', 'password');
    const confirm = setField(elements, 'confirm_password', '', 'password');
    const indicator = new ElementFixture();
    const matchText = new ElementFixture();
    elements.set('password_match_indicator', indicator);
    elements.set('password_match_text', matchText);
    await import('../../../src/assets/js/admin/users/form.js');
    runReady();

    confirm.trigger('input');
    expect(indicator.classList.add).toHaveBeenCalledWith('hidden');

    confirm.value = 'different';
    password.trigger('input');
    expect(matchText.textContent).toContain('Passwords do not match');
    expect(matchText.className).toContain('text-red-600');

    confirm.value = password.value;
    confirm.trigger('input');
    expect(matchText.textContent).toContain('Passwords match');
    expect(matchText.className).toContain('text-green-600');

    elements.delete('password_match_text');
    expect(() => confirm.trigger('input')).not.toThrow();
  });

  it('validates every create-form rule and submits only valid data', async () => {
    const { createForm, elements, runReady, showAlert } = setupDom({
      stateText: JSON.stringify({
        translations: { requiredFields: 'All fields are mandatory' },
      }),
    });
    const email = setField(elements, 'email', '');
    const givenName = setField(elements, 'given_name', 'Maria');
    const familyName = setField(elements, 'family_name', 'Doe');
    const password = setField(elements, 'password', 'Strong1!');
    const confirm = setField(elements, 'confirm_password', 'Strong1!');
    await import('../../../src/assets/js/admin/users/form.js');
    runReady();

    const submit = async () => {
      const before = showAlert.mock.calls.length;
      const event = { preventDefault: vi.fn() };
      createForm.trigger('submit', event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      await vi.waitFor(() =>
        expect(
          showAlert.mock.calls.length > before ||
            createForm.submit.mock.calls.length > 0
        ).toBe(true)
      );
    };

    for (const field of [email, givenName, familyName, password, confirm]) {
      const previous = field.value;
      field.value = '';
      await submit();
      field.value =
        previous || (field === email ? 'maria@example.com' : 'value');
    }
    expect(showAlert).toHaveBeenCalledWith(
      'Validation Error',
      'All fields are mandatory',
      { variant: 'error' }
    );

    email.value = 'invalid';
    password.value = confirm.value = 'Strong1!';
    await submit();
    expect(showAlert).toHaveBeenLastCalledWith(
      'Invalid Email',
      'Please enter a valid email address',
      { variant: 'error' }
    );

    email.value = 'maria@example.com';
    password.value = confirm.value = 'Short1!';
    await submit();
    expect(showAlert).toHaveBeenLastCalledWith(
      'Invalid Password',
      'Password must be at least 8 characters long',
      { variant: 'error' }
    );

    password.value = 'Strong1!';
    confirm.value = 'Different1!';
    await submit();
    expect(showAlert).toHaveBeenLastCalledWith(
      'Password Mismatch',
      'Passwords do not match',
      { variant: 'error' }
    );

    for (const weakPassword of [
      'lowercase1!',
      'UPPERCASE1!',
      'NoNumber!',
      'NoSpecial1',
    ]) {
      password.value = confirm.value = weakPassword;
      await submit();
      expect(showAlert).toHaveBeenLastCalledWith(
        'Weak Password',
        expect.any(String),
        { variant: 'error' }
      );
    }

    password.value = confirm.value = 'Strong1!';
    await submit();
    await vi.waitFor(() => expect(createForm.submit).toHaveBeenCalledOnce());
  });

  it('validates edit forms synchronously and permits valid optional passwords', async () => {
    const { editForm, elements, runReady, showAlert } = setupDom({
      isCreateForm: false,
    });
    const email = setField(elements, 'email', 'maria@example.com');
    const givenName = setField(elements, 'given_name', 'Maria');
    const familyName = setField(elements, 'family_name', 'Doe');
    const newPassword = setField(elements, 'new_password', '');
    await import('../../../src/assets/js/admin/users/form.js');
    runReady();

    const submit = async () => {
      const event = { preventDefault: vi.fn() };
      editForm.trigger('submit', event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      await Promise.resolve();
    };

    for (const field of [email, givenName, familyName]) {
      const previous = field.value;
      field.value = '';
      await submit();
      field.value = previous;
    }
    email.value = 'invalid';
    await submit();
    email.value = 'maria@example.com';
    newPassword.value = 'short';
    await submit();
    expect(showAlert).toHaveBeenCalledTimes(5);

    newPassword.value = '';
    await submit();
    await vi.waitFor(() => expect(editForm.submit).toHaveBeenCalledOnce());
    newPassword.value = 'Strong1!';
    await submit();
    await vi.waitFor(() => expect(editForm.submit).toHaveBeenCalledTimes(2));
  });

  it('falls back to alert and auto-resizes textareas', async () => {
    const { alert, createForm, queryResults, runReady } = setupDom({
      withDialog: false,
    });
    const textarea = new ElementFixture();
    textarea.scrollHeight = 240;
    queryResults.set('textarea', [textarea]);
    await import('../../../src/assets/js/admin/users/form.js');
    runReady();

    createForm.trigger('submit', { preventDefault: vi.fn() });
    await vi.waitFor(() => expect(alert).toHaveBeenCalledOnce());

    textarea.trigger('input');
    expect(textarea.style.height).toBe('240px');
  });

  it('recovers from malformed state with the detected form type', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const { runReady } = setupDom({ stateText: '{invalid' });
    await import('../../../src/assets/js/admin/users/form.js');

    runReady();

    expect(error).toHaveBeenCalledWith(
      '[AdminUsersFormManager] Initialization failed:',
      expect.any(SyntaxError)
    );
  });

  it('tolerates incomplete generation and form markup', async () => {
    const first = setupDom();
    const checkbox = setField(first.elements, 'generatePassword', '');
    await import('../../../src/assets/js/admin/users/form.js');
    first.runReady();
    checkbox.checked = true;
    expect(() => checkbox.trigger('change')).not.toThrow();

    vi.resetModules();
    vi.unstubAllGlobals();
    const createOverride = setupDom({
      isCreateForm: false,
      stateText: '{"isCreateForm":true}',
      withEditForm: false,
    });
    await import('../../../src/assets/js/admin/users/form.js');
    expect(createOverride.runReady).not.toThrow();

    vi.resetModules();
    vi.unstubAllGlobals();
    const missingEdit = setupDom({
      isCreateForm: false,
      withEditForm: false,
    });
    await import('../../../src/assets/js/admin/users/form.js');
    expect(missingEdit.runReady).not.toThrow();
  });

  it('uses default configuration when embedded state is empty', async () => {
    const { createForm, runReady, showAlert } = setupDom({ stateText: '' });
    await import('../../../src/assets/js/admin/users/form.js');

    runReady();
    createForm.trigger('submit', { preventDefault: vi.fn() });
    await vi.waitFor(() =>
      expect(showAlert).toHaveBeenCalledWith(
        'Validation Error',
        'Please fill in all required fields',
        { variant: 'error' }
      )
    );
  });
});
