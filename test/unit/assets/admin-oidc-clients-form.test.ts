import { afterEach, describe, expect, it, vi } from 'vitest';

interface DomEvent {
  currentTarget?: ElementFixture;
}

type DomListener = (event: DomEvent) => unknown;

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
  public checked = false;
  public readonly children = new Map<string, ElementFixture>();
  public readonly classList = new ClassListFixture();
  public readonly dataset: Record<string, string> = {};
  public readonly listeners = new Map<string, DomListener[]>();
  public tagName = 'INPUT';
  public textContent = '';
  public value = '';

  public addEventListener(name: string, listener: DomListener): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  public querySelector(selector: string): ElementFixture | null {
    return this.children.get(selector) ?? null;
  }

  public trigger(name: string): void {
    this.listeners
      .get(name)
      ?.forEach(listener => listener.call(this, { currentTarget: this }));
  }
}

interface DomOptions {
  mode?: 'create' | 'edit';
  omitForm?: boolean;
  omitWindow?: boolean;
  stateText?: string;
}

function setupDom(options: DomOptions = {}) {
  let ready: (() => void) | undefined;
  const elements = new Map<string, ElementFixture>();
  const queryResults = new Map<string, ElementFixture[]>();
  const singleResults = new Map<string, ElementFixture>();
  const form = new ElementFixture();
  form.dataset.mode = options.mode ?? 'edit';
  if (!options.omitForm) elements.set('oidc-client-form', form);
  if (options.stateText !== undefined) {
    const state = new ElementFixture();
    state.textContent = options.stateText;
    elements.set('___ADMIN_OIDC_CLIENTS_FORM_STATE___', state);
  }

  const copyToClipboard = vi.fn();
  const browserWindow = { adminOidcClientsManager: { copyToClipboard } };
  if (!options.omitWindow) vi.stubGlobal('window', browserWindow);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, listener: () => void) => {
      if (name === 'DOMContentLoaded') ready = listener;
    }),
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
    querySelector: vi.fn(
      (selector: string) => singleResults.get(selector) ?? null
    ),
    querySelectorAll: vi.fn(
      (selector: string) => queryResults.get(selector) ?? []
    ),
  });

  return {
    browserWindow,
    copyToClipboard,
    elements,
    form,
    queryResults,
    runReady: () => ready?.(),
    singleResults,
  };
}

function addField(
  elements: Map<string, ElementFixture>,
  id: string,
  value = ''
): ElementFixture {
  const element = new ElementFixture();
  element.value = value;
  elements.set(id, element);
  return element;
}

function addPresetControls(dom: ReturnType<typeof setupDom>) {
  const applicationType = addField(dom.elements, 'application_type');
  const authMethod = addField(dom.elements, 'token_endpoint_auth_method');
  const pkce = addField(dom.elements, 'require_pkce');
  const scope = addField(dom.elements, 'scope');
  const preset = addField(dom.elements, 'preset');
  const apiSection = addField(dom.elements, 'management-api-scopes-section');
  const customSection = addField(dom.elements, 'custom-resource-sub-section');
  const managementSection = addField(
    dom.elements,
    'mgmt-api-scope-sub-section'
  );
  const authorizationCode = new ElementFixture();
  authorizationCode.value = 'authorization_code';
  const refreshToken = new ElementFixture();
  refreshToken.value = 'refresh_token';
  const clientCredentials = new ElementFixture();
  clientCredentials.value = 'client_credentials';
  const deviceCode = new ElementFixture();
  deviceCode.value = 'urn:ietf:params:oauth:grant-type:device_code';
  const code = new ElementFixture();
  code.value = 'code';
  dom.queryResults.set('input[name="grant_types"]', [
    authorizationCode,
    refreshToken,
    clientCredentials,
    deviceCode,
  ]);
  dom.queryResults.set('input[name="response_types"]', [code]);
  for (const element of [
    authorizationCode,
    refreshToken,
    clientCredentials,
    deviceCode,
    code,
  ]) {
    const name = element === code ? 'response_types' : 'grant_types';
    dom.singleResults.set(
      `input[name="${name}"][value="${element.value}"]`,
      element
    );
  }

  return {
    apiSection,
    applicationType,
    authMethod,
    authorizationCode,
    clientCredentials,
    code,
    customSection,
    deviceCode,
    managementSection,
    pkce,
    preset,
    refreshToken,
    scope,
  };
}

describe('admin OIDC clients form manager', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('removes stale generated Management API authorization when its scopes are cleared', async () => {
    const dom = setupDom();
    const allowedResources = addField(dom.elements, 'allowedResources');
    allowedResources.value = 'https://api.example.test\nurn:parako:api:v1';
    const resourcesScopes = addField(dom.elements, 'resourcesScopes');
    resourcesScopes.value = 'custom:read parako:users:read';
    const managementScope = new ElementFixture();
    managementScope.value = 'parako:users:read';
    dom.queryResults.set('input[name="api_scopes"]', [managementScope]);

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();
    dom.form.trigger('submit');

    expect(resourcesScopes.value).toBe('custom:read');
    expect(allowedResources.value).toBe('https://api.example.test');
  });

  it('applies the safe web defaults to a new client form', async () => {
    const dom = setupDom({ mode: 'create' });
    const controls = addPresetControls(dom);

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();

    expect(controls.applicationType.value).toBe('web');
    expect(controls.preset.value).toBe('web');
    expect(controls.authMethod.value).toBe('client_secret_basic');
    expect(controls.pkce.checked).toBe(false);
    expect(controls.scope.value).toBe('openid profile email');
    expect(controls.authorizationCode.checked).toBe(true);
    expect(controls.refreshToken.checked).toBe(true);
    expect(controls.code.checked).toBe(true);
    expect(controls.clientCredentials.checked).toBe(false);
    expect(controls.apiSection.classList.contains('hidden')).toBe(true);
    expect(controls.customSection.classList.contains('hidden')).toBe(false);
    expect(controls.managementSection.classList.contains('hidden')).toBe(false);
  });

  it('selects quick-start cards and applies service and device presets', async () => {
    const dom = setupDom({ mode: 'create' });
    const controls = addPresetControls(dom);
    const blankCard = new ElementFixture();
    const m2mCard = new ElementFixture();
    m2mCard.dataset.preset = 'm2m';
    const m2mCheck = new ElementFixture();
    const m2mRadio = new ElementFixture();
    m2mCard.children.set('.quick-start-check', m2mCheck);
    m2mCard.children.set('input[type="radio"]', m2mRadio);
    const managementCard = new ElementFixture();
    managementCard.dataset.preset = 'api_management';
    const deviceCard = new ElementFixture();
    deviceCard.dataset.preset = 'device';
    const unknownCard = new ElementFixture();
    unknownCard.dataset.preset = 'unknown';
    dom.queryResults.set('.quick-start-card', [
      blankCard,
      m2mCard,
      managementCard,
      deviceCard,
      unknownCard,
    ]);

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();

    blankCard.trigger('click');
    expect(controls.preset.value).toBe('web');

    m2mCard.trigger('click');
    expect(m2mRadio.checked).toBe(true);
    expect(m2mCheck.classList.contains('hidden')).toBe(false);
    expect(m2mCard.classList.contains('border-primary')).toBe(true);
    expect(controls.clientCredentials.checked).toBe(true);
    expect(controls.customSection.classList.contains('hidden')).toBe(false);
    expect(controls.managementSection.classList.contains('hidden')).toBe(true);

    managementCard.trigger('click');
    expect(controls.preset.value).toBe('api_management');
    expect(controls.customSection.classList.contains('hidden')).toBe(true);
    expect(controls.managementSection.classList.contains('hidden')).toBe(false);

    deviceCard.trigger('click');
    expect(controls.applicationType.value).toBe('native');
    expect(controls.authMethod.value).toBe('client_secret_post');
    expect(controls.deviceCode.checked).toBe(true);
    expect(controls.scope.value).toContain('offline_access');

    unknownCard.trigger('click');
    expect(controls.preset.value).toBe('device');
  });

  it('resets edit-form grant defaults when the application type changes', async () => {
    const dom = setupDom();
    const controls = addPresetControls(dom);
    controls.applicationType.tagName = 'SELECT';

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();

    controls.applicationType.value = 'native';
    controls.applicationType.trigger('change');
    expect(controls.authorizationCode.checked).toBe(true);
    expect(controls.refreshToken.checked).toBe(true);
    expect(controls.code.checked).toBe(true);

    controls.applicationType.value = 'unsupported';
    controls.applicationType.trigger('change');
    expect(controls.authorizationCode.checked).toBe(false);
    expect(controls.refreshToken.checked).toBe(false);
    expect(controls.code.checked).toBe(false);
  });

  it('ignores preset targets that are absent from incomplete create markup', async () => {
    const dom = setupDom({ mode: 'create' });
    const grant = new ElementFixture();
    const response = new ElementFixture();
    dom.queryResults.set('input[name="grant_types"]', [grant]);
    dom.queryResults.set('input[name="response_types"]', [response]);

    await import('../../../src/assets/js/admin/oidc-clients/form.js');

    expect(dom.runReady).not.toThrow();
    expect(grant.checked).toBe(false);
    expect(response.checked).toBe(false);
  });

  it('ignores missing edit-form checkboxes when applying application defaults', async () => {
    const dom = setupDom();
    const controls = addPresetControls(dom);
    controls.applicationType.tagName = 'SELECT';
    dom.singleResults.delete(
      'input[name="grant_types"][value="authorization_code"]'
    );
    dom.singleResults.delete('input[name="response_types"][value="code"]');

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();
    controls.applicationType.value = 'native';

    expect(() => controls.applicationType.trigger('change')).not.toThrow();
    expect(controls.authorizationCode.checked).toBe(false);
    expect(controls.refreshToken.checked).toBe(true);
    expect(controls.code.checked).toBe(false);
  });

  it('synchronizes Management API visibility when grant types change', async () => {
    const dom = setupDom();
    const controls = addPresetControls(dom);
    dom.form.dataset.preset = 'm2m';

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();
    expect(controls.apiSection.classList.contains('hidden')).toBe(true);

    controls.clientCredentials.checked = true;
    controls.clientCredentials.trigger('change');
    expect(controls.apiSection.classList.contains('hidden')).toBe(false);
    expect(controls.customSection.classList.contains('hidden')).toBe(false);
    expect(controls.managementSection.classList.contains('hidden')).toBe(true);

    controls.clientCredentials.checked = false;
    controls.clientCredentials.trigger('change');
    expect(controls.apiSection.classList.contains('hidden')).toBe(true);
  });

  it('hides Management API controls when client credentials is not rendered', async () => {
    const dom = setupDom();
    const apiSection = addField(dom.elements, 'management-api-scopes-section');

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();

    expect(apiSection.classList.contains('hidden')).toBe(true);
  });

  it('deduplicates custom values and merges checked Management API scopes', async () => {
    const dom = setupDom();
    const allowedResources = addField(dom.elements, 'allowedResources');
    allowedResources.value =
      'https://api.example.test\nhttps://api.example.test\nurn:parako:api:v1';
    const resourcesScopes = addField(dom.elements, 'resourcesScopes');
    resourcesScopes.value = 'custom:read custom:read parako:old';
    const usersRead = new ElementFixture();
    usersRead.value = 'parako:users:read';
    usersRead.checked = true;
    const usersReadDuplicate = new ElementFixture();
    usersReadDuplicate.value = 'parako:users:read';
    usersReadDuplicate.checked = true;
    const usersWrite = new ElementFixture();
    usersWrite.value = 'parako:users:write';
    dom.queryResults.set('input[name="api_scopes"]', [
      usersRead,
      usersReadDuplicate,
      usersWrite,
    ]);

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();
    dom.form.trigger('submit');

    expect(resourcesScopes.value).toBe('custom:read parako:users:read');
    expect(allowedResources.value).toBe(
      'https://api.example.test\nurn:parako:api:v1'
    );
  });

  it('submits safely when resource textareas are absent', async () => {
    const dom = setupDom();
    const managementScope = new ElementFixture();
    managementScope.value = 'parako:users:read';
    managementScope.checked = true;
    dom.queryResults.set('input[name="api_scopes"]', [managementScope]);

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();

    expect(() => dom.form.trigger('submit')).not.toThrow();
  });

  it('fetches, reveals, copies, and hides a client secret', async () => {
    const dom = setupDom({
      stateText: JSON.stringify({
        csrfToken: 'csrf-token',
        translations: {
          showSensitiveData: 'Reveal',
          hideSensitiveData: 'Conceal',
        },
      }),
    });
    const toggle = addField(dom.elements, 'toggleSensitiveFields');
    const secret = addField(dom.elements, 'client-secret');
    secret.classList.add('hidden');
    const hiddenSecret = addField(dom.elements, 'client-secret-hidden');
    const copy = addField(dom.elements, 'copy-secret');
    copy.classList.add('hidden');
    const toggleText = addField(dom.elements, 'toggleText');
    const client = new ElementFixture();
    client.dataset.clientId = 'client-123';
    dom.singleResults.set('[data-client-id]', client);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ client_secret: 'secret-value' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();
    toggle.trigger('click');

    await vi.waitFor(() => expect(secret.textContent).toBe('secret-value'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/admin/oidc-clients/client-123/reveal-secret',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-token',
        },
      }
    );
    expect(secret.classList.contains('hidden')).toBe(false);
    expect(hiddenSecret.classList.contains('hidden')).toBe(true);
    expect(copy.classList.contains('hidden')).toBe(false);
    expect(toggleText.textContent).toBe('Conceal');

    copy.trigger('click');
    expect(dom.copyToClipboard).toHaveBeenCalledWith('secret-value', copy);

    toggle.trigger('click');
    expect(secret.classList.contains('hidden')).toBe(true);
    expect(hiddenSecret.classList.contains('hidden')).toBe(false);
    expect(copy.classList.contains('hidden')).toBe(true);
    expect(toggleText.textContent).toBe('Reveal');
  });

  it('contains failed secret reveal requests without exposing the field', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const dom = setupDom();
    const toggle = addField(dom.elements, 'toggleSensitiveFields');
    const secret = addField(dom.elements, 'client-secret');
    secret.classList.add('hidden');
    addField(dom.elements, 'client-secret-hidden');
    const client = new ElementFixture();
    client.dataset.clientId = 'client-123';
    dom.singleResults.set('[data-client-id]', client);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockRejectedValueOnce(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();
    toggle.trigger('click');
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        '[AdminOidcClientsFormManager] Failed to reveal secret'
      )
    );
    toggle.trigger('click');
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        '[AdminOidcClientsFormManager] Error fetching secret:',
        expect.any(Error)
      )
    );
    expect(secret.classList.contains('hidden')).toBe(true);
  });

  it('does not fetch or copy without the required secret context', async () => {
    const dom = setupDom();
    const toggle = addField(dom.elements, 'toggleSensitiveFields');
    const secret = addField(dom.elements, 'client-secret');
    secret.classList.add('hidden');
    addField(dom.elements, 'client-secret-hidden');
    const copy = addField(dom.elements, 'copy-secret');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();
    toggle.trigger('click');
    copy.trigger('click');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(dom.copyToClipboard).not.toHaveBeenCalled();
    expect(secret.classList.contains('hidden')).toBe(true);
  });

  it('toggles a preloaded secret with optional controls absent', async () => {
    const dom = setupDom();
    const toggle = addField(dom.elements, 'toggleSensitiveFields');
    const secret = addField(dom.elements, 'client-secret');
    secret.textContent = 'preloaded';
    secret.classList.add('hidden');
    addField(dom.elements, 'client-secret-hidden');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();
    toggle.trigger('click');
    toggle.trigger('click');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(secret.classList.contains('hidden')).toBe(true);
  });

  it('tolerates incomplete form and secret markup', async () => {
    const dom = setupDom({ omitForm: true });
    const toggle = addField(dom.elements, 'toggleSensitiveFields');

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    expect(dom.runReady).not.toThrow();
    expect(() => toggle.trigger('click')).not.toThrow();
  });

  it('uses defaults for absent or empty embedded state', async () => {
    const absent = setupDom();
    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    expect(absent.runReady).not.toThrow();
    expect(absent.browserWindow).toHaveProperty('AdminOidcClientsFormManager');

    vi.resetModules();
    vi.unstubAllGlobals();
    const empty = setupDom({ stateText: '' });
    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    expect(empty.runReady).not.toThrow();
  });

  it('recovers from malformed embedded state', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const dom = setupDom({ stateText: '{invalid' });

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    dom.runReady();

    expect(error).toHaveBeenCalledWith(
      '[AdminOidcClientsFormManager] Initialization failed:',
      expect.any(SyntaxError)
    );
  });

  it('does not publish the manager when no browser window exists', async () => {
    const dom = setupDom({ omitWindow: true });

    await import('../../../src/assets/js/admin/oidc-clients/form.js');
    expect(dom.runReady).not.toThrow();
  });
});
