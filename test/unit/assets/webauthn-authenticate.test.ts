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
  public readonly listeners = new Map<
    string,
    Array<(event: Record<string, unknown>) => unknown>
  >();
  public className = '';
  public disabled = false;
  public textContent = '';
  private readonly attributes = new Map<string, string>();

  public get firstChild(): ElementFixture | null {
    return this.children[0] ?? null;
  }

  public addEventListener(
    type: string,
    listener: (event: Record<string, unknown>) => unknown
  ): void {
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

  public getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  public async trigger(type: string): Promise<void> {
    for (const listener of this.listeners.get(type) ?? []) {
      await listener({ target: this });
    }
  }
}

const translations = {
  authenticateButton: 'Authenticate',
  authenticating: 'Authenticating',
  successTitle: 'Success',
  successMessage: 'Authenticated',
  errorTitle: 'Error',
  errorNotSecure: 'Secure context required',
  errorNotSupported: 'Passkeys are not supported',
  errorCancelled: 'Authentication cancelled',
  errorNoCredentials: 'No credentials',
  errorGeneric: 'Authentication failed',
  errorTimeout: 'Session expired',
};

function state(overrides: Record<string, unknown> = {}) {
  const overrideConfig =
    (overrides.config as Record<string, unknown> | undefined) ?? {};
  const overrideTranslations =
    (overrides.translations as Record<string, unknown> | undefined) ?? {};
  return {
    ...overrides,
    config: {
      autoTrigger: false,
      csrfToken: 'csrf-token',
      debug: false,
      optionsUrl: '/webauthn/authenticate/options',
      timerDuration: 60,
      verifyUrl: '/webauthn/authenticate/verify',
      ...overrideConfig,
    },
    translations: { ...translations, ...overrideTranslations },
  };
}

function buffer(...bytes: number[]): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function credential() {
  return {
    getClientExtensionResults: vi.fn(() => ({ appid: false })),
    id: 'credential-id',
    rawId: buffer(1, 2, 3),
    response: {
      authenticatorData: buffer(4, 5),
      clientDataJSON: buffer(6, 7),
      signature: buffer(8, 9),
      userHandle: buffer(10),
    },
    type: 'public-key',
  };
}

interface SetupOptions {
  credentialValue?: unknown;
  fetchResponses?: Array<{
    body: unknown;
    jsonError?: Error;
    ok?: boolean;
    status?: number;
  }>;
  omitElements?: string[];
  secureContext?: boolean;
  stateText?: string | null;
  supported?: boolean;
}

async function setup(options: SetupOptions = {}) {
  vi.useFakeTimers();
  vi.resetModules();
  let ready: (() => unknown) | undefined;
  const elements = new Map<string, ElementFixture>();
  const stateElement = new ElementFixture();
  stateElement.textContent =
    options.stateText === undefined
      ? JSON.stringify(state())
      : (options.stateText ?? '');
  if (options.stateText !== null) {
    elements.set('___WEBAUTHN_AUTH_STATE___', stateElement);
  }

  for (const id of [
    'webauthn-status',
    'webauthn-auth-btn',
    'auth-btn-text',
    'timer',
    'try-another-method',
  ]) {
    if (!options.omitElements?.includes(id)) {
      elements.set(id, new ElementFixture());
    }
  }

  const created: ElementFixture[] = [];
  const documentFixture = {
    addEventListener: vi.fn((type: string, listener: () => unknown) => {
      if (type === 'DOMContentLoaded') ready = listener;
    }),
    createElement: vi.fn(() => {
      const element = new ElementFixture();
      created.push(element);
      return element;
    }),
    createElementNS: vi.fn(() => {
      const element = new ElementFixture();
      created.push(element);
      return element;
    }),
    getElementById: vi.fn((id: string) => elements.get(id) ?? null),
  };

  const location = {
    href: 'https://id.example.test/oidc/v1/interaction/uid',
    origin: 'https://id.example.test',
  };
  const windowFixture = {
    PublicKeyCredential:
      options.supported === false
        ? undefined
        : function PublicKeyCredential() {},
    isSecureContext: options.secureContext ?? true,
    location,
  };
  const getCredential = vi
    .fn()
    .mockResolvedValue(
      Object.prototype.hasOwnProperty.call(options, 'credentialValue')
        ? options.credentialValue
        : credential()
    );
  const fetchMock = vi.fn();
  for (const response of options.fetchResponses ?? []) {
    fetchMock.mockResolvedValueOnce({
      json: response.jsonError
        ? vi.fn().mockRejectedValue(response.jsonError)
        : vi.fn().mockResolvedValue(response.body),
      ok: response.ok ?? true,
      status: response.status ?? 200,
    });
  }

  vi.stubGlobal('document', documentFixture);
  vi.stubGlobal('window', windowFixture);
  vi.stubGlobal('navigator', { credentials: { get: getCredential } });
  vi.stubGlobal('fetch', fetchMock);

  await import('../../../src/assets/js/webauthn/authenticate.js');
  await ready?.();

  return {
    authButton: elements.get('webauthn-auth-btn'),
    created,
    elements,
    fetchMock,
    getCredential,
    location,
  };
}

function renderedText(element: ElementFixture | undefined): string[] {
  if (!element) return [];
  return [
    ...(element.textContent ? [element.textContent] : []),
    ...element.children.flatMap(child => renderedText(child)),
  ];
}

function successfulResponses(redirectUrl?: string) {
  return [
    {
      body: {
        ok: true,
        options: {
          allowCredentials: [
            {
              id: 'BAUG',
              transports: ['internal'],
              type: 'public-key',
            },
          ],
          challenge: 'AQID',
          extensions: { appid: 'https://id.example.test' },
          rpId: 'id.example.test',
          timeout: 30_000,
          userVerification: 'required',
        },
      },
    },
    { body: { ok: true, redirectUrl } },
  ];
}

function authenticationOptions(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    allowCredentials: [{ id: 'BAUG', type: 'public-key' }],
    challenge: 'AQID',
    ...overrides,
  };
}

function expectStatus(
  context: Awaited<ReturnType<typeof setup>>,
  message: string
) {
  expect(renderedText(context.elements.get('webauthn-status'))).toEqual(
    expect.arrayContaining(['Error', message])
  );
  expect(context.elements.get('auth-btn-text')?.textContent).toBe(
    'Authenticate'
  );
}

describe('WebAuthn authentication browser flow', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('rejects a protocol-relative post-authentication redirect', async () => {
    const context = await setup({
      fetchResponses: [
        {
          body: {
            ok: true,
            options: {
              allowCredentials: [{ id: 'BAUG', type: 'public-key' }],
              challenge: 'AQID',
            },
          },
        },
        { body: { ok: true, redirectUrl: '//attacker.example/steal' } },
      ],
    });

    await context.authButton!.trigger('click');
    await vi.advanceTimersByTimeAsync(1000);

    expect(context.location.href).toBe(
      'https://id.example.test/oidc/v1/interaction/uid'
    );
    expect(context.elements.get('webauthn-status')?.className).toContain(
      'border-green-500'
    );
  });

  it('reports a missing state element without starting the manager', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const context = await setup({ stateText: null });

    expect(error).toHaveBeenCalledWith(
      '[WebAuthn Auth] State element not found'
    );
    expect(context.authButton?.listeners.get('click')).toBeUndefined();
  });

  it('reports malformed state without leaving a partially initialized manager', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const context = await setup({ stateText: '{malformed' });

    expect(error).toHaveBeenCalledWith(
      '[WebAuthn Auth] Failed to initialize:',
      expect.any(SyntaxError)
    );
    expect(context.authButton?.listeners.get('click')).toBeUndefined();
  });

  it('blocks passkey authentication outside a secure context', async () => {
    const context = await setup({ secureContext: false });
    const status = context.elements.get('webauthn-status');

    expect(context.authButton?.disabled).toBe(true);
    expect(context.authButton?.listeners.get('click')).toBeUndefined();
    expect(renderedText(status)).toEqual(
      expect.arrayContaining(['Error', 'Secure context required'])
    );
    expect(status?.classList.contains('hidden')).toBe(false);
  });

  it('handles an insecure context when the authentication button is absent', async () => {
    const context = await setup({
      omitElements: ['webauthn-auth-btn'],
      secureContext: false,
    });

    expect(renderedText(context.elements.get('webauthn-status'))).toEqual(
      expect.arrayContaining(['Secure context required'])
    );
  });

  it('blocks passkey authentication when the browser lacks WebAuthn', async () => {
    const context = await setup({ supported: false });

    expect(context.authButton?.disabled).toBe(true);
    expect(renderedText(context.elements.get('webauthn-status'))).toEqual(
      expect.arrayContaining(['Error', 'Passkeys are not supported'])
    );
  });

  it('handles unsupported WebAuthn when the authentication button is absent', async () => {
    const context = await setup({
      omitElements: ['webauthn-auth-btn'],
      supported: false,
    });

    expect(renderedText(context.elements.get('webauthn-status'))).toEqual(
      expect.arrayContaining(['Passkeys are not supported'])
    );
  });

  it('expires the interaction timer and disables authentication', async () => {
    const context = await setup({
      stateText: JSON.stringify(state({ config: { timerDuration: 2 } })),
    });
    const timer = context.elements.get('timer');
    expect(timer?.textContent).toBe('0:02');

    await vi.advanceTimersByTimeAsync(1000);
    expect(timer?.textContent).toBe('0:01');
    await vi.advanceTimersByTimeAsync(1000);

    expect(context.authButton?.disabled).toBe(true);
    expect(renderedText(context.elements.get('webauthn-status'))).toEqual(
      expect.arrayContaining(['Error', 'Session expired'])
    );
  });

  it('routes alternate-method selection back into the OIDC interaction', async () => {
    const context = await setup({
      stateText: JSON.stringify(
        state({
          config: {
            isOidcFlow: true,
            oidcPath: '/oidc/v1',
            uid: 'interaction-uid',
          },
        })
      ),
    });

    await context.elements.get('try-another-method')!.trigger('click');

    expect(context.location.href).toBe(
      '/oidc/v1/interaction/interaction-uid/mfa/select'
    );
  });

  it.each([
    [undefined, '/auth/login'],
    ['/login-again', '/login-again'],
  ])(
    'routes regular alternate-method selection to %s',
    async (loginUrl, expected) => {
      const context = await setup({
        stateText: JSON.stringify(state({ config: { loginUrl } })),
      });

      await context.elements.get('try-another-method')!.trigger('click');

      expect(context.location.href).toBe(expected);
    }
  );

  it('serializes the assertion and follows a same-origin redirect', async () => {
    const context = await setup({
      fetchResponses: successfulResponses('/account'),
    });

    await context.authButton!.trigger('click');

    expect(context.fetchMock).toHaveBeenNthCalledWith(
      1,
      '/webauthn/authenticate/options',
      {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-Token': 'csrf-token',
        },
        method: 'POST',
      }
    );
    expect(context.getCredential).toHaveBeenCalledWith({
      publicKey: expect.objectContaining({
        allowCredentials: [
          expect.objectContaining({
            id: expect.any(ArrayBuffer),
            transports: ['internal'],
            type: 'public-key',
          }),
        ],
        challenge: expect.any(ArrayBuffer),
        extensions: { appid: 'https://id.example.test' },
        rpId: 'id.example.test',
        timeout: 30_000,
        userVerification: 'required',
      }),
    });
    const verifyRequest = context.fetchMock.mock.calls[1]![1];
    expect(JSON.parse(verifyRequest.body)).toEqual({
      credential: {
        clientExtensionResults: { appid: false },
        id: 'credential-id',
        rawId: 'AQID',
        response: {
          authenticatorData: 'BAU',
          clientDataJSON: 'Bgc',
          signature: 'CAk',
          userHandle: 'Cg',
        },
        type: 'public-key',
      },
    });
    expect(context.elements.get('auth-btn-text')?.textContent).toBe(
      'Authenticating'
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(context.location.href).toBe('/account');
  });

  it('ignores a second authentication request while one is in progress', async () => {
    let resolveOptions!: (value: unknown) => void;
    const optionsPromise = new Promise(resolve => {
      resolveOptions = resolve;
    });
    const context = await setup();
    context.fetchMock.mockReturnValueOnce(optionsPromise);
    const listener = context.authButton!.listeners.get('click')![0]!;

    const first = listener({ target: context.authButton });
    await listener({ target: context.authButton });
    expect(context.fetchMock).toHaveBeenCalledTimes(1);

    resolveOptions({
      json: vi.fn().mockResolvedValue({ error: 'Stopped', ok: false }),
      ok: true,
      status: 200,
    });
    await first;
  });

  it('auto-triggers authentication when configured', async () => {
    const context = await setup({
      fetchResponses: successfulResponses(),
      stateText: JSON.stringify(state({ config: { autoTrigger: true } })),
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(context.fetchMock).toHaveBeenCalledTimes(2);
    expect(context.getCredential).toHaveBeenCalledOnce();
  });

  it('tolerates every optional control being absent', async () => {
    const context = await setup({
      omitElements: [
        'webauthn-status',
        'webauthn-auth-btn',
        'auth-btn-text',
        'timer',
        'try-another-method',
      ],
      stateText: JSON.stringify(state({ config: { timerDuration: 1 } })),
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(context.fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ error: 'Options denied', ok: false }, 'Options denied'],
    [{ ok: false }, 'Failed to get authentication options'],
    [
      {
        ok: true,
        options: authenticationOptions({ allowCredentials: undefined }),
      },
      'No credentials',
    ],
    [
      { ok: true, options: authenticationOptions({ allowCredentials: [] }) },
      'No credentials',
    ],
  ])('reports an invalid options payload %#', async (body, expectedMessage) => {
    const context = await setup({ fetchResponses: [{ body }] });

    await context.authButton!.trigger('click');

    expectStatus(context, expectedMessage);
    expect(context.getCredential).not.toHaveBeenCalled();
  });

  it.each([
    [{ error: 'Options unavailable' }, undefined, 'Options unavailable'],
    [{}, undefined, 'HTTP 503'],
    [{}, new Error('invalid JSON'), 'HTTP 503'],
  ])(
    'reports an options endpoint HTTP failure %#',
    async (body, jsonError, expectedMessage) => {
      const context = await setup({
        fetchResponses: [{ body, jsonError, ok: false, status: 503 }],
      });

      await context.authButton!.trigger('click');

      expectStatus(context, expectedMessage);
    }
  );

  it('reports an authenticator that returns no credential', async () => {
    const context = await setup({
      credentialValue: null,
      fetchResponses: [
        { body: { ok: true, options: authenticationOptions() } },
      ],
    });

    await context.authButton!.trigger('click');

    expectStatus(context, 'No credential returned from authenticator');
  });

  it.each([
    ['NotAllowedError', 'Authentication cancelled'],
    ['NotSupportedError', 'Passkeys are not supported'],
    ['UnknownError', 'Authenticator unavailable'],
  ])('maps the authenticator %s failure', async (name, expectedMessage) => {
    const context = await setup({
      fetchResponses: [
        { body: { ok: true, options: authenticationOptions() } },
      ],
    });
    const error = new Error('Authenticator unavailable');
    error.name = name;
    context.getCredential.mockRejectedValue(error);

    await context.authButton!.trigger('click');

    expectStatus(context, expectedMessage);
  });

  it('uses the generic message for a non-Error authenticator rejection', async () => {
    const context = await setup({
      fetchResponses: [
        { body: { ok: true, options: authenticationOptions() } },
      ],
    });
    context.getCredential.mockRejectedValue({ reason: 'device failed' });

    await context.authButton!.trigger('click');

    expectStatus(context, 'Authentication failed');
  });

  it('uses the generic message for an Error with no message', async () => {
    const context = await setup({
      fetchResponses: [
        { body: { ok: true, options: authenticationOptions() } },
      ],
    });
    context.getCredential.mockRejectedValue(new Error());

    await context.authButton!.trigger('click');

    expectStatus(context, 'Authentication failed');
  });

  it.each([
    [{ error: 'Assertion rejected', ok: false }, 'Assertion rejected'],
    [{ ok: false }, 'Authentication verification failed'],
  ])(
    'reports an invalid verification payload %#',
    async (body, expectedMessage) => {
      const context = await setup({
        fetchResponses: [
          { body: { ok: true, options: authenticationOptions() } },
          { body },
        ],
      });

      await context.authButton!.trigger('click');

      expectStatus(context, expectedMessage);
    }
  );

  it.each([
    [
      { error: 'Verification unavailable' },
      undefined,
      'Verification unavailable',
    ],
    [{}, undefined, 'HTTP 502'],
    [{}, new Error('invalid JSON'), 'HTTP 502'],
  ])(
    'reports a verification endpoint HTTP failure %#',
    async (body, jsonError, expectedMessage) => {
      const context = await setup({
        fetchResponses: [
          { body: { ok: true, options: authenticationOptions() } },
          { body, jsonError, ok: false, status: 502 },
        ],
      });

      await context.authButton!.trigger('click');

      expectStatus(context, expectedMessage);
    }
  );

  it('serializes an absent assertion user handle as null', async () => {
    const assertion = credential();
    assertion.response.userHandle = null as unknown as ArrayBuffer;
    const context = await setup({
      credentialValue: assertion,
      fetchResponses: successfulResponses(),
    });

    await context.authButton!.trigger('click');

    const verifyRequest = context.fetchMock.mock.calls[1]![1];
    expect(
      JSON.parse(verifyRequest.body).credential.response.userHandle
    ).toBeNull();
  });

  it('replaces an existing status banner on a subsequent outcome', async () => {
    const context = await setup({
      fetchResponses: [
        { body: { error: 'First failure', ok: false } },
        ...successfulResponses(),
      ],
    });
    const status = context.elements.get('webauthn-status')!;

    await context.authButton!.trigger('click');
    const firstBanner = status.firstChild;
    await context.authButton!.trigger('click');

    expect(status.children).toHaveLength(1);
    expect(status.firstChild).not.toBe(firstBanner);
    expect(renderedText(status)).toEqual(
      expect.arrayContaining(['Success', 'Authenticated'])
    );
  });

  it('can authenticate after the visible interaction timer has expired', async () => {
    const context = await setup({
      fetchResponses: successfulResponses(),
      stateText: JSON.stringify(state({ config: { timerDuration: 1 } })),
    });

    await vi.advanceTimersByTimeAsync(1000);
    await context.authButton!.trigger('click');

    expect(renderedText(context.elements.get('webauthn-status'))).toEqual(
      expect.arrayContaining(['Success', 'Authenticated'])
    );
  });

  it.each([123, 'javascript:alert(1)', 'http://[invalid'])(
    'ignores an invalid redirect value %#',
    async redirectUrl => {
      const context = await setup({
        fetchResponses: [
          { body: { ok: true, options: authenticationOptions() } },
          { body: { ok: true, redirectUrl } },
        ],
      });

      await context.authButton!.trigger('click');
      await vi.advanceTimersByTimeAsync(1000);

      expect(context.location.href).toBe(
        'https://id.example.test/oidc/v1/interaction/uid'
      );
    }
  );

  it('emits debug diagnostics without requiring log data', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const context = await setup({
      fetchResponses: successfulResponses(),
      stateText: JSON.stringify(state({ config: { debug: true } })),
    });

    await context.authButton!.trigger('click');

    expect(log).toHaveBeenCalledWith(
      '[WebAuthn Auth] WebAuthn Authenticate Manager initialized',
      ''
    );
    expect(log).toHaveBeenCalledWith(
      '[WebAuthn Auth] Got authentication options',
      expect.any(Object)
    );
  });

  it('completes authentication without status or loading controls', async () => {
    const context = await setup({
      fetchResponses: successfulResponses(),
      omitElements: ['webauthn-status', 'webauthn-auth-btn', 'auth-btn-text'],
      stateText: JSON.stringify(state({ config: { autoTrigger: true } })),
    });

    await vi.advanceTimersByTimeAsync(500);

    expect(context.fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back from empty state text to a reported initialization error', async () => {
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    await setup({ stateText: '' });

    expect(error).toHaveBeenCalledWith(
      '[WebAuthn Auth] Failed to initialize:',
      expect.any(TypeError)
    );
  });
});
