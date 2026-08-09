import { afterEach, describe, expect, it, vi } from 'vitest';

class ClassListFixture {
  private readonly values = new Set<string>();
  public readonly add = vi.fn((...tokens: string[]) => {
    tokens.forEach(token => this.values.add(token));
  });
  public readonly remove = vi.fn((...tokens: string[]) => {
    tokens.forEach(token => this.values.delete(token));
  });

  public contains(token: string): boolean {
    return this.values.has(token);
  }
}

class ElementFixture {
  public readonly children: ElementFixture[] = [];
  public readonly classList = new ClassListFixture();
  public readonly listeners = new Map<string, Array<() => unknown>>();
  public className = '';
  public disabled = false;
  public textContent = '';
  public value = '';
  public readonly focus = vi.fn();
  public readonly select = vi.fn();
  private readonly attributes = new Map<string, string>();

  public get firstChild(): ElementFixture | null {
    return this.children[0] ?? null;
  }

  public addEventListener(type: string, listener: () => unknown): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  public appendChild(child: ElementFixture): ElementFixture {
    this.children.push(child);
    return child;
  }

  public removeChild(child: ElementFixture): ElementFixture {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    return child;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  public async trigger(type: string): Promise<void> {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener();
    }
  }
}

const translations = {
  registerButton: 'Register passkey',
  registering: 'Registering',
  saving: 'Saving',
  successTitle: 'Success',
  successMessage: 'Passkey registered',
  errorTitle: 'Error',
  errorNotSecure: 'Secure context required',
  errorNotSupported: 'Passkeys are not supported',
  errorCancelled: 'Registration cancelled',
  errorGeneric: 'Registration failed',
};

function state(overrides: Record<string, unknown> = {}) {
  const overrideConfig =
    (overrides.config as Record<string, unknown> | undefined) ?? {};
  return {
    ...overrides,
    config: {
      apiBasePath: '/api',
      csrfToken: 'csrf-token',
      debug: false,
      registerOptionsUrl: '/webauthn/register/options',
      registerVerifyUrl: '/webauthn/register/verify',
      successRedirectUrl: '/account/passkeys',
      ...overrideConfig,
    },
    translations,
  };
}

function buffer(...bytes: number[]): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function registrationCredential(transports: string[] = ['internal']) {
  return {
    getClientExtensionResults: vi.fn(() => ({ credProps: { rk: true } })),
    id: 'credential-id',
    rawId: buffer(1, 2, 3),
    response: {
      attestationObject: buffer(4, 5),
      clientDataJSON: buffer(6, 7),
      getTransports: vi.fn(() => transports),
    },
    type: 'public-key',
  };
}

function creationOptions() {
  return {
    attestation: 'none',
    authenticatorSelection: { userVerification: 'preferred' },
    challenge: 'AQID',
    excludeCredentials: [
      { id: 'BAUG', transports: ['internal'], type: 'public-key' },
    ],
    extensions: { credProps: true },
    pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    rp: { id: 'id.example.test', name: 'Parako' },
    timeout: 30_000,
    user: {
      displayName: 'Demo User',
      id: 'BwgJ',
      name: 'demo@example.test',
    },
  };
}

interface SetupOptions {
  credentialValue?: unknown;
  debug?: boolean;
  fetchResponses?: Array<{
    body: unknown;
    jsonError?: Error;
    ok?: boolean;
    status?: number;
  }>;
  omitElements?: string[];
  secureContext?: boolean;
  stateText?: string | null;
  successRedirectUrl?: unknown;
  supported?: boolean | 'non-function';
  transports?: string[];
  userAgent?: string;
}

async function setup(options: SetupOptions = {}) {
  vi.useFakeTimers();
  vi.resetModules();
  let ready: (() => unknown) | undefined;
  const elements = new Map<string, ElementFixture>();
  const stateElement = new ElementFixture();
  stateElement.textContent =
    options.stateText === undefined
      ? JSON.stringify(
          state({
            config: {
              debug: options.debug ?? false,
              successRedirectUrl:
                options.successRedirectUrl ?? '/account/passkeys',
            },
          })
        )
      : (options.stateText ?? '');
  if (options.stateText !== null) {
    elements.set('___WEBAUTHN_REGISTER_STATE___', stateElement);
  }
  for (const id of [
    'webauthn-status',
    'webauthn-register-btn',
    'register-btn-text',
    'webauthn-save-btn',
    'friendly-name-section',
    'friendly_name',
  ]) {
    if (!options.omitElements?.includes(id)) {
      elements.set(id, new ElementFixture());
    }
  }

  const documentFixture = {
    addEventListener: vi.fn((type: string, listener: () => unknown) => {
      if (type === 'DOMContentLoaded') ready = listener;
    }),
    createElement: vi.fn(() => new ElementFixture()),
    createElementNS: vi.fn(() => new ElementFixture()),
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
  };
  const location = {
    href: 'https://id.example.test/account/passkeys/register',
    origin: 'https://id.example.test',
  };
  const createCredential = vi
    .fn()
    .mockResolvedValue(
      Object.prototype.hasOwnProperty.call(options, 'credentialValue')
        ? options.credentialValue
        : registrationCredential(options.transports)
    );
  const fetchMock = vi.fn();
  for (const response of options.fetchResponses ?? [
    { body: { ok: true, options: creationOptions() } },
    { body: { ok: true } },
  ]) {
    fetchMock.mockResolvedValueOnce({
      json: response.jsonError
        ? vi.fn().mockRejectedValue(response.jsonError)
        : vi.fn().mockResolvedValue(response.body),
      ok: response.ok ?? true,
      status: response.status ?? 200,
    });
  }

  vi.stubGlobal('document', documentFixture);
  vi.stubGlobal('window', {
    PublicKeyCredential:
      options.supported === false
        ? undefined
        : options.supported === 'non-function'
          ? {}
          : function PublicKeyCredential() {},
    isSecureContext: options.secureContext ?? true,
    location,
  });
  vi.stubGlobal('navigator', {
    credentials: { create: createCredential },
    userAgent: options.userAgent ?? 'Mozilla/5.0 (X11; Linux x86_64)',
  });
  vi.stubGlobal('fetch', fetchMock);

  await import('../../../src/assets/js/webauthn/register.js');
  await ready?.();

  return { createCredential, elements, fetchMock, location };
}

function renderedText(element: ElementFixture | undefined): string[] {
  if (!element) return [];
  return [
    ...(element.textContent ? [element.textContent] : []),
    ...element.children.flatMap(child => renderedText(child)),
  ];
}

describe('WebAuthn registration browser flow', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('rejects a protocol-relative post-registration redirect', async () => {
    const context = await setup({
      successRedirectUrl: '//attacker.example/steal',
    });

    await context.elements.get('webauthn-register-btn')!.trigger('click');
    expect(context.elements.get('friendly_name')?.value).toBe('Linux Device');
    await context.elements.get('webauthn-save-btn')!.trigger('click');
    await vi.advanceTimersByTimeAsync(1500);

    expect(context.location.href).toBe(
      'https://id.example.test/account/passkeys/register'
    );
  });

  it('reports missing and malformed bootstrap state', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const missing = await setup({ stateText: null });
    expect(error).toHaveBeenCalledWith(
      '[WebAuthn Register] State element not found'
    );
    expect(
      missing.elements.get('webauthn-register-btn')?.listeners.get('click')
    ).toBeUndefined();

    error.mockClear();
    await setup({ stateText: '{malformed' });
    expect(error).toHaveBeenCalledWith(
      '[WebAuthn Register] Failed to initialize:',
      expect.any(SyntaxError)
    );

    error.mockClear();
    await setup({ stateText: '' });
    expect(error).toHaveBeenCalledWith(
      '[WebAuthn Register] Failed to initialize:',
      expect.any(TypeError)
    );
  });

  it.each([
    [{ secureContext: false }, 'Secure context required'],
    [{ supported: false }, 'Passkeys are not supported'],
  ])('blocks unavailable browser capability %#', async (options, message) => {
    const context = await setup(options);
    expect(context.elements.get('webauthn-register-btn')?.disabled).toBe(true);
    expect(renderedText(context.elements.get('webauthn-status'))).toEqual(
      expect.arrayContaining(['Error', message])
    );
  });

  it('serializes and saves a new passkey before a same-origin redirect', async () => {
    const context = await setup({ successRedirectUrl: '/account/passkeys' });
    const input = context.elements.get('friendly_name')!;

    await context.elements.get('webauthn-register-btn')!.trigger('click');
    input.value = '  Work laptop  ';
    await context.elements.get('webauthn-save-btn')!.trigger('click');

    expect(context.createCredential).toHaveBeenCalledWith({
      publicKey: expect.objectContaining({
        challenge: expect.any(ArrayBuffer),
        excludeCredentials: [
          expect.objectContaining({ id: expect.any(ArrayBuffer) }),
        ],
        user: expect.objectContaining({ id: expect.any(ArrayBuffer) }),
      }),
    });
    const saveRequest = context.fetchMock.mock.calls[1]![1];
    expect(JSON.parse(saveRequest.body)).toEqual({
      credential: {
        clientExtensionResults: { credProps: { rk: true } },
        id: 'credential-id',
        rawId: 'AQID',
        response: {
          attestationObject: 'BAU',
          clientDataJSON: 'Bgc',
          transports: ['internal'],
        },
        type: 'public-key',
      },
      friendly_name: 'Work laptop',
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(context.location.href).toBe('/account/passkeys');
  });

  it('does not accept a successful JSON body from a failed save response', async () => {
    const context = await setup({
      fetchResponses: [
        { body: { ok: true, options: creationOptions() } },
        { body: { ok: true }, ok: false, status: 502 },
      ],
    });

    await context.elements.get('webauthn-register-btn')!.trigger('click');
    await context.elements.get('webauthn-save-btn')!.trigger('click');
    await vi.advanceTimersByTimeAsync(1500);

    expect(context.location.href).toBe(
      'https://id.example.test/account/passkeys/register'
    );
    expect(renderedText(context.elements.get('webauthn-status'))).toEqual(
      expect.arrayContaining(['Error', 'HTTP 502'])
    );
  });

  it('binds safely when optional controls are absent', async () => {
    const context = await setup({
      omitElements: [
        'webauthn-status',
        'webauthn-register-btn',
        'register-btn-text',
        'webauthn-save-btn',
        'friendly-name-section',
        'friendly_name',
      ],
    });

    expect(context.fetchMock).not.toHaveBeenCalled();

    const insecure = await setup({
      omitElements: ['webauthn-register-btn', 'webauthn-status'],
      secureContext: false,
    });
    expect(insecure.fetchMock).not.toHaveBeenCalled();

    const unsupported = await setup({
      omitElements: ['webauthn-register-btn', 'webauthn-status'],
      supported: 'non-function',
    });
    expect(unsupported.fetchMock).not.toHaveBeenCalled();

    const partial = await setup({
      omitElements: [
        'webauthn-status',
        'register-btn-text',
        'webauthn-save-btn',
        'friendly-name-section',
        'friendly_name',
      ],
    });
    await partial.elements.get('webauthn-register-btn')!.trigger('click');
    expect(partial.createCredential).toHaveBeenCalledOnce();

    const noStatus = await setup({ omitElements: ['webauthn-status'] });
    await noStatus.elements.get('webauthn-register-btn')!.trigger('click');
    await noStatus.elements.get('webauthn-save-btn')!.trigger('click');
    expect(noStatus.fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['Mozilla/5.0 (iPhone)', ['internal'], 'iPhone'],
    ['Mozilla/5.0 (iPad)', ['internal'], 'iPad'],
    ['Mozilla/5.0 (Macintosh)', ['internal'], 'Mac Touch ID'],
    ['Mozilla/5.0 (Mac OS X)', ['internal'], 'Mac Touch ID'],
    ['Mozilla/5.0 (Windows NT 10.0)', ['internal'], 'Windows Hello'],
    ['Mozilla/5.0 (Android)', ['internal'], 'Android Device'],
    ['Unknown Browser', ['internal'], 'Passkey'],
    ['Unknown Browser', ['usb'], 'Security Key'],
  ])(
    'detects the friendly device name for %s',
    async (userAgent, transports, expected) => {
      const context = await setup({ transports, userAgent });

      await context.elements.get('webauthn-register-btn')!.trigger('click');

      const input = context.elements.get('friendly_name')!;
      expect(input.value).toBe(expected);
      expect(input.select).toHaveBeenCalledOnce();
      expect(input.focus).toHaveBeenCalledOnce();
    }
  );

  it('handles absent authenticator transports and friendly-name controls', async () => {
    const credential = registrationCredential();
    delete (credential.response as { getTransports?: unknown }).getTransports;
    const context = await setup({
      credentialValue: credential,
      omitElements: [
        'friendly-name-section',
        'friendly_name',
        'webauthn-register-btn',
        'webauthn-save-btn',
        'register-btn-text',
      ],
    });

    expect(context.fetchMock).not.toHaveBeenCalled();

    const saveContext = await setup({ credentialValue: credential });
    await saveContext.elements.get('webauthn-register-btn')!.trigger('click');
    await saveContext.elements.get('webauthn-save-btn')!.trigger('click');
    const body = JSON.parse(saveContext.fetchMock.mock.calls[1]![1].body);
    expect(body.credential.response.transports).toEqual([]);
    expect(body.friendly_name).toBe('Linux Device');
  });

  it.each([
    [{ body: { error: 'Options denied', ok: false } }, 'Options denied'],
    [{ body: { ok: false } }, 'Failed to get registration options'],
    [{ body: { ok: true } }, 'Failed to get registration options'],
    [
      { body: { error: 'Upstream unavailable' }, ok: false, status: 503 },
      'Upstream unavailable',
    ],
    [{ body: {}, ok: false, status: 503 }, 'HTTP 503'],
    [
      {
        body: {},
        jsonError: new Error('invalid JSON'),
        ok: false,
        status: 503,
      },
      'HTTP 503',
    ],
  ])('reports registration option failure %#', async (response, expected) => {
    const context = await setup({ fetchResponses: [response] });

    await context.elements.get('webauthn-register-btn')!.trigger('click');

    expect(renderedText(context.elements.get('webauthn-status'))).toEqual(
      expect.arrayContaining(['Error', expected])
    );
    expect(context.elements.get('webauthn-register-btn')?.disabled).toBe(false);
    expect(context.elements.get('register-btn-text')?.textContent).toBe(
      'Register passkey'
    );
  });

  it.each([
    [null, 'No credential returned from authenticator'],
    [
      Object.assign(new Error('cancelled'), { name: 'NotAllowedError' }),
      'Registration cancelled',
    ],
    [
      Object.assign(new Error('unsupported'), { name: 'NotSupportedError' }),
      'Passkeys are not supported',
    ],
    [new Error('Authenticator broke'), 'Authenticator broke'],
    [Object.assign(new Error(''), { message: '' }), 'Registration failed'],
  ])('reports authenticator failure %#', async (failure, expected) => {
    const context = await setup({
      credentialValue: failure instanceof Error ? undefined : failure,
    });
    if (failure instanceof Error) {
      context.createCredential.mockRejectedValueOnce(failure);
    }

    await context.elements.get('webauthn-register-btn')!.trigger('click');

    expect(renderedText(context.elements.get('webauthn-status'))).toEqual(
      expect.arrayContaining(['Error', expected])
    );
  });

  it('uses the generic message for a non-Error rejection', async () => {
    const context = await setup();
    context.fetchMock.mockReset();
    context.fetchMock.mockRejectedValueOnce({ reason: 'unknown' });

    await context.elements.get('webauthn-register-btn')!.trigger('click');

    expect(renderedText(context.elements.get('webauthn-status'))).toEqual(
      expect.arrayContaining(['Error', 'Registration failed'])
    );
  });

  it('ignores duplicate registration and save actions while processing', async () => {
    const context = await setup();
    let releaseOptions: ((value: unknown) => void) | undefined;
    context.fetchMock.mockReset();
    context.fetchMock.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseOptions = resolve;
        })
    );

    const register = context.elements
      .get('webauthn-register-btn')!
      .trigger('click');
    await context.elements.get('webauthn-register-btn')!.trigger('click');
    expect(context.fetchMock).toHaveBeenCalledTimes(1);
    releaseOptions?.({
      json: vi.fn().mockResolvedValue({ ok: true, options: creationOptions() }),
      ok: true,
      status: 200,
    });
    await register;

    let releaseVerify: ((value: unknown) => void) | undefined;
    context.fetchMock.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseVerify = resolve;
        })
    );
    const save = context.elements.get('webauthn-save-btn')!.trigger('click');
    await context.elements.get('webauthn-save-btn')!.trigger('click');
    expect(context.fetchMock).toHaveBeenCalledTimes(2);
    releaseVerify?.({
      json: vi.fn().mockResolvedValue({ ok: true }),
      ok: true,
      status: 200,
    });
    await save;
  });

  it('ignores save before a credential exists', async () => {
    const context = await setup();
    await context.elements.get('webauthn-save-btn')!.trigger('click');
    expect(context.fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      { body: { error: 'Verification denied', ok: false } },
      'Verification denied',
    ],
    [{ body: { ok: false } }, 'Failed to verify registration'],
    [
      {
        body: { error: 'Gateway failed', ok: false, status: 502 },
        ok: false,
        status: 502,
      },
      'Gateway failed',
    ],
    [{ body: { ok: false }, jsonError: new Error('bad JSON') }, 'bad JSON'],
  ])(
    'reports registration verification failure %#',
    async (verify, expected) => {
      const context = await setup({
        fetchResponses: [
          { body: { ok: true, options: creationOptions() } },
          verify,
        ],
      });

      await context.elements.get('webauthn-register-btn')!.trigger('click');
      await context.elements.get('webauthn-save-btn')!.trigger('click');

      expect(renderedText(context.elements.get('webauthn-status'))).toEqual(
        expect.arrayContaining(['Error', expected])
      );
      expect(context.elements.get('webauthn-save-btn')).toMatchObject({
        disabled: false,
        textContent: 'Register passkey',
      });
    }
  );

  it('omits a blank friendly name and replaces the existing status content', async () => {
    const context = await setup();
    const status = context.elements.get('webauthn-status')!;
    status.appendChild(new ElementFixture());

    await context.elements.get('webauthn-register-btn')!.trigger('click');
    context.elements.get('friendly_name')!.value = '   ';
    await context.elements.get('webauthn-save-btn')!.trigger('click');

    const body = JSON.parse(context.fetchMock.mock.calls[1]![1].body);
    expect(body).not.toHaveProperty('friendly_name');
    expect(status.children).toHaveLength(1);
    expect(renderedText(status)).toEqual(
      expect.arrayContaining(['Success', 'Passkey registered'])
    );
  });

  it.each([
    '',
    'javascript:alert(1)',
    'https://attacker.example/steal',
    'http://[',
  ])('does not redirect to invalid target %j', async successRedirectUrl => {
    const context = await setup({ successRedirectUrl });
    await context.elements.get('webauthn-register-btn')!.trigger('click');
    await context.elements.get('webauthn-save-btn')!.trigger('click');
    await vi.advanceTimersByTimeAsync(1500);
    expect(context.location.href).toBe(
      'https://id.example.test/account/passkeys/register'
    );
  });

  it('logs initialization and protocol progress only in debug mode', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const context = await setup({ debug: true });
    await context.elements.get('webauthn-register-btn')!.trigger('click');
    await context.elements.get('webauthn-save-btn')!.trigger('click');

    expect(log).toHaveBeenCalledWith(
      '[WebAuthn Register] WebAuthn Register Manager initialized',
      ''
    );
    expect(log).toHaveBeenCalledWith(
      '[WebAuthn Register] Registration verified',
      { ok: true }
    );
  });
});
