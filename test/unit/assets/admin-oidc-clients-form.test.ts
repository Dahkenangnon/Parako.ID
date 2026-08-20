import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  initializeAdminOidcClientsForm,
  registerAdminOidcClientsFormEntry,
} from '../../../src/assets/js/admin/oidc-clients/form.js';

const PRESETS = {
  api_management: preset(
    'web',
    'client_secret_basic',
    false,
    ['client_credentials'],
    [],
    ''
  ),
  device: preset(
    'native',
    'client_secret_post',
    false,
    ['urn:ietf:params:oauth:grant-type:device_code'],
    [],
    'openid profile email offline_access'
  ),
  m2m: preset(
    'web',
    'client_secret_basic',
    false,
    ['client_credentials'],
    [],
    ''
  ),
  native: preset(
    'native',
    'none',
    true,
    ['authorization_code', 'refresh_token'],
    ['code'],
    'openid profile email'
  ),
  spa: preset(
    'web',
    'none',
    true,
    ['authorization_code', 'refresh_token'],
    ['code'],
    'openid profile email'
  ),
  web: preset(
    'web',
    'client_secret_basic',
    false,
    ['authorization_code', 'refresh_token'],
    ['code'],
    'openid profile email'
  ),
};

function preset(
  applicationType: string,
  authMethod: string,
  requirePkce: boolean,
  grantTypes: string[],
  responseTypes: string[],
  scope: string
) {
  return {
    application_type: applicationType,
    grant_types: grantTypes,
    require_pkce: requirePkce,
    response_types: responseTypes,
    scope,
    token_endpoint_auth_method: authMethod,
  };
}
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
  omitState?: boolean;
  readyState?: DocumentReadyState;
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
  if (!options.omitState) {
    const state = new ElementFixture();
    state.textContent =
      options.stateText ?? JSON.stringify({ presets: PRESETS });
    elements.set('___ADMIN_OIDC_CLIENTS_FORM_STATE___', state);
  }

  const copyToClipboard = vi.fn();
  const browserWindow: Record<string, unknown> = {};
  vi.stubGlobal('window', browserWindow);
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
    readyState: options.readyState ?? 'complete',
  });

  return {
    browserWindow,
    clipboard: { copy: copyToClipboard },
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
  });

  it('removes stale generated Management API authorization when its scopes are cleared', () => {
    const dom = setupDom();
    const allowedResources = addField(dom.elements, 'allowedResources');
    allowedResources.value = 'https://api.example.test\nurn:parako:api:v1';
    const resourcesScopes = addField(dom.elements, 'resourcesScopes');
    resourcesScopes.value = 'custom:read parako:users:read';
    const managementScope = new ElementFixture();
    managementScope.value = 'parako:users:read';
    dom.queryResults.set('input[name="api_scopes"]', [managementScope]);

    initializeAdminOidcClientsForm(dom.clipboard);
    dom.form.trigger('submit');

    expect(resourcesScopes.value).toBe('custom:read');
    expect(allowedResources.value).toBe('https://api.example.test');
  });

  it('applies the safe web defaults to a new client form', () => {
    const dom = setupDom({ mode: 'create' });
    const controls = addPresetControls(dom);

    initializeAdminOidcClientsForm(dom.clipboard);

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

  it('ignores malformed presets while preserving valid server presets', () => {
    const dom = setupDom({
      mode: 'create',
      stateText: JSON.stringify({
        presets: {
          web: PRESETS.web,
          device: { ...PRESETS.device, grant_types: [42] },
        },
      }),
    });
    const controls = addPresetControls(dom);
    const deviceCard = new ElementFixture();
    deviceCard.dataset.preset = 'device';
    dom.queryResults.set('.quick-start-card', [deviceCard]);

    initializeAdminOidcClientsForm(dom.clipboard);
    deviceCard.trigger('click');

    expect(controls.preset.value).toBe('web');
    expect(controls.applicationType.value).toBe('web');
    expect(controls.authorizationCode.checked).toBe(true);
  });

  it('selects quick-start cards and applies service and device presets', () => {
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

    initializeAdminOidcClientsForm(dom.clipboard);

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

  it('resets edit-form grant defaults when the application type changes', () => {
    const dom = setupDom();
    const controls = addPresetControls(dom);
    controls.applicationType.tagName = 'SELECT';

    initializeAdminOidcClientsForm(dom.clipboard);

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

  it('ignores preset targets that are absent from incomplete create markup', () => {
    const dom = setupDom({ mode: 'create' });
    const grant = new ElementFixture();
    const response = new ElementFixture();
    dom.queryResults.set('input[name="grant_types"]', [grant]);
    dom.queryResults.set('input[name="response_types"]', [response]);

    expect(() => initializeAdminOidcClientsForm(dom.clipboard)).not.toThrow();
    expect(grant.checked).toBe(false);
    expect(response.checked).toBe(false);
  });

  it('ignores missing edit-form checkboxes when applying application defaults', () => {
    const dom = setupDom();
    const controls = addPresetControls(dom);
    controls.applicationType.tagName = 'SELECT';
    dom.singleResults.delete(
      'input[name="grant_types"][value="authorization_code"]'
    );
    dom.singleResults.delete('input[name="response_types"][value="code"]');

    initializeAdminOidcClientsForm(dom.clipboard);
    controls.applicationType.value = 'native';

    expect(() => controls.applicationType.trigger('change')).not.toThrow();
    expect(controls.authorizationCode.checked).toBe(false);
    expect(controls.refreshToken.checked).toBe(true);
    expect(controls.code.checked).toBe(false);
  });

  it('synchronizes Management API visibility when grant types change', () => {
    const dom = setupDom();
    const controls = addPresetControls(dom);
    dom.form.dataset.preset = 'm2m';

    initializeAdminOidcClientsForm(dom.clipboard);
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

  it('hides Management API controls when client credentials is not rendered', () => {
    const dom = setupDom();
    const apiSection = addField(dom.elements, 'management-api-scopes-section');

    initializeAdminOidcClientsForm(dom.clipboard);

    expect(apiSection.classList.contains('hidden')).toBe(true);
  });

  it('deduplicates custom values and merges checked Management API scopes', () => {
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

    initializeAdminOidcClientsForm(dom.clipboard);
    dom.form.trigger('submit');

    expect(resourcesScopes.value).toBe('custom:read parako:users:read');
    expect(allowedResources.value).toBe(
      'https://api.example.test\nurn:parako:api:v1'
    );
  });

  it('submits safely when resource textareas are absent', () => {
    const dom = setupDom();
    const managementScope = new ElementFixture();
    managementScope.value = 'parako:users:read';
    managementScope.checked = true;
    dom.queryResults.set('input[name="api_scopes"]', [managementScope]);

    initializeAdminOidcClientsForm(dom.clipboard);

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

    initializeAdminOidcClientsForm(dom.clipboard);
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

  it('rejects a malformed secret response without revealing it', async () => {
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
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ client_secret: 42 }),
      })
    );

    initializeAdminOidcClientsForm(dom.clipboard);
    toggle.trigger('click');

    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(
        '[AdminOidcClientsFormManager] Failed to reveal secret'
      )
    );
    expect(secret.textContent).toBe('');
    expect(secret.classList.contains('hidden')).toBe(true);
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

    initializeAdminOidcClientsForm(dom.clipboard);
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

  it('does not fetch or copy without the required secret context', () => {
    const dom = setupDom();
    const toggle = addField(dom.elements, 'toggleSensitiveFields');
    const secret = addField(dom.elements, 'client-secret');
    secret.classList.add('hidden');
    addField(dom.elements, 'client-secret-hidden');
    const copy = addField(dom.elements, 'copy-secret');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    initializeAdminOidcClientsForm(dom.clipboard);
    toggle.trigger('click');
    copy.trigger('click');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(dom.copyToClipboard).not.toHaveBeenCalled();
    expect(secret.classList.contains('hidden')).toBe(true);
  });

  it('toggles a preloaded secret with optional controls absent', () => {
    const dom = setupDom();
    const toggle = addField(dom.elements, 'toggleSensitiveFields');
    const secret = addField(dom.elements, 'client-secret');
    secret.textContent = 'preloaded';
    secret.classList.add('hidden');
    addField(dom.elements, 'client-secret-hidden');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    initializeAdminOidcClientsForm(dom.clipboard);
    toggle.trigger('click');
    toggle.trigger('click');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(secret.classList.contains('hidden')).toBe(true);
  });

  it('tolerates incomplete form and secret markup', () => {
    const dom = setupDom({ omitForm: true });
    const toggle = addField(dom.elements, 'toggleSensitiveFields');

    expect(() => initializeAdminOidcClientsForm(dom.clipboard)).not.toThrow();
    expect(() => toggle.trigger('click')).not.toThrow();
  });

  it('uses defaults for absent or empty embedded state', () => {
    const absent = setupDom({ omitState: true });
    expect(() =>
      initializeAdminOidcClientsForm(absent.clipboard)
    ).not.toThrow();

    const empty = setupDom({ stateText: '' });
    expect(() => initializeAdminOidcClientsForm(empty.clipboard)).not.toThrow();
  });

  it('recovers from malformed embedded state', () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const dom = setupDom({ stateText: '{invalid' });

    initializeAdminOidcClientsForm(dom.clipboard);

    expect(error).toHaveBeenCalledWith(
      '[AdminOidcClientsFormManager] Initialization failed:',
      expect.any(SyntaxError)
    );
  });

  it('does not publish a form manager global', () => {
    const dom = setupDom();

    initializeAdminOidcClientsForm(dom.clipboard);

    expect(dom.browserWindow).not.toHaveProperty('AdminOidcClientsFormManager');
  });

  it('defers entry registration until the document is ready', () => {
    const dom = setupDom({ readyState: 'loading' });

    registerAdminOidcClientsFormEntry();

    expect(dom.form.listeners.size).toBe(0);
    expect(dom.runReady).not.toThrow();
    expect(dom.form.listeners.has('submit')).toBe(true);
  });

  it('initializes the entry immediately after document loading', () => {
    const dom = setupDom({ readyState: 'complete' });

    expect(registerAdminOidcClientsFormEntry).not.toThrow();
    expect(dom.form.listeners.has('submit')).toBe(true);
  });
});
