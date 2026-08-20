import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DeviceInfoCollector,
  initializeDeviceInfoPage,
  registerDeviceInfoEntry,
} from '../../../src/assets/js/user.js';

interface FormFixture {
  firstChild: object | null;
  getAttribute: ReturnType<typeof vi.fn>;
  id: string;
  insertBefore: ReturnType<typeof vi.fn>;
  querySelector: ReturnType<typeof vi.fn>;
}

function form(
  options: {
    method?: string | null;
    existing?: { value: string } | null;
    id?: string;
  } = {}
): FormFixture {
  return {
    firstChild: {},
    getAttribute: vi.fn(() => options.method ?? null),
    id: options.id ?? '',
    insertBefore: vi.fn(),
    querySelector: vi.fn(() => options.existing ?? null),
  };
}

class MutationObserverFixture {
  static instances: MutationObserverFixture[] = [];
  callback: (mutations: Array<{ addedNodes: unknown[] }>) => void;
  disconnect = vi.fn();
  observe = vi.fn();

  constructor(callback: (mutations: Array<{ addedNodes: unknown[] }>) => void) {
    this.callback = callback;
    MutationObserverFixture.instances.push(this);
  }
}

function loadCollector(
  options: {
    fingerprintJS?: {
      load: ReturnType<typeof vi.fn>;
    };
    forms?: FormFixture[];
    localStorage?: {
      getItem: ReturnType<typeof vi.fn>;
      setItem: ReturnType<typeof vi.fn>;
    };
  } = {}
) {
  MutationObserverFixture.instances = [];
  const documentListeners = new Map<string, () => void>();
  const windowListeners = new Map<string, () => void>();
  const createdInputs: Array<Record<string, string>> = [];
  const windowRoot: Record<string, unknown> = {
    addEventListener: vi.fn((name: string, callback: () => void) =>
      windowListeners.set(name, callback)
    ),
  };
  if (options.fingerprintJS) windowRoot.FingerprintJS = options.fingerprintJS;
  vi.stubGlobal('window', windowRoot);
  vi.stubGlobal('document', {
    addEventListener: vi.fn((name: string, callback: () => void) => {
      documentListeners.set(name, callback);
    }),
    body: {},
    createElement: vi.fn(() => {
      const input: Record<string, string> = {};
      createdInputs.push(input);
      return input;
    }),
    getElementById: vi.fn(() => null),
    querySelectorAll: vi.fn(() => options.forms ?? []),
  });
  vi.stubGlobal(
    'localStorage',
    options.localStorage ?? {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    }
  );
  vi.stubGlobal('navigator', {
    platform: 'TestOS',
    language: 'en-US',
    hardwareConcurrency: 8,
  });
  vi.stubGlobal('screen', { width: 1280, height: 720, colorDepth: 24 });
  vi.stubGlobal('MutationObserver', MutationObserverFixture);
  vi.stubGlobal('Node', { ELEMENT_NODE: 1 });
  return {
    Collector: DeviceInfoCollector,
    createdInputs,
    documentListeners,
    windowListeners,
  };
}

function fingerprint(visitorId = 'visitor-123') {
  const get = vi.fn().mockResolvedValue({ visitorId });
  const load = vi.fn().mockResolvedValue({ get });
  return { get, load };
}

describe('device info collector', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('injects FingerprintJS device data into an existing POST field', async () => {
    const existing = { value: '' };
    const postForm = form({ method: 'post', existing });
    const fp = fingerprint();
    const { Collector } = loadCollector({
      fingerprintJS: fp,
      forms: [postForm],
    });
    const collector = new Collector({ csrfToken: 'csrf', debug: false });

    await collector.initialize();

    expect(fp.load).toHaveBeenCalledWith({ monitoring: false });
    expect(existing.value).toBe(
      JSON.stringify({
        visitorId: 'visitor-123',
        visitorIdSource: 'fingerprintjs',
      })
    );
    expect(postForm.insertBefore).not.toHaveBeenCalled();
    expect(MutationObserverFixture.instances[0]?.observe).toHaveBeenCalledWith(
      document.body,
      { childList: true, subtree: true }
    );
  });

  it('passes a Pro API key and creates a hidden device field', async () => {
    const postForm = form({ method: 'POST', id: 'login' });
    const fp = fingerprint('pro-visitor');
    const { Collector, createdInputs } = loadCollector({
      fingerprintJS: fp,
      forms: [postForm],
    });

    await new Collector({
      csrfToken: 'csrf',
      fingerprintJSApiKey: 'api-key',
      debug: true,
    }).initialize();

    expect(fp.load).toHaveBeenCalledWith({
      apiKey: 'api-key',
      monitoring: false,
    });
    expect(createdInputs[0]).toMatchObject({
      type: 'hidden',
      name: '_deviceInfo',
      value: JSON.stringify({
        visitorId: 'pro-visitor',
        visitorIdSource: 'fingerprintjs',
      }),
    });
    expect(postForm.insertBefore).toHaveBeenCalledWith(
      createdInputs[0],
      postForm.firstChild
    );
  });

  it('uses a stored fallback ID when FingerprintJS is unavailable', async () => {
    const existing = { value: '' };
    const storage = {
      getItem: vi.fn(() => 'stored-fallback'),
      setItem: vi.fn(),
    };
    const { Collector } = loadCollector({
      forms: [form({ method: 'POST', existing })],
      localStorage: storage,
    });

    await new Collector({ csrfToken: 'csrf', debug: false }).initialize();

    expect(JSON.parse(existing.value)).toEqual({
      visitorId: 'stored-fallback',
      visitorIdSource: 'fallback',
    });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('generates and stores a fallback ID when none exists', async () => {
    const storage = { getItem: vi.fn(() => null), setItem: vi.fn() };
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const existing = { value: '' };
    const { Collector } = loadCollector({
      forms: [form({ method: 'POST', existing })],
      localStorage: storage,
    });

    await new Collector({ csrfToken: 'csrf', debug: false }).initialize();

    const info = JSON.parse(existing.value) as { visitorId: string };
    expect(info.visitorId).toMatch(/^fb_[a-z0-9]+_i+$/);
    expect(storage.setItem).toHaveBeenCalledWith(
      'parako_device_fallback_id',
      info.visitorId
    );
  });

  it('still generates fallback data when localStorage is unavailable', async () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('denied');
      }),
      setItem: vi.fn(() => {
        throw new Error('denied');
      }),
    };
    const existing = { value: '' };
    const { Collector } = loadCollector({
      forms: [form({ method: 'POST', existing })],
      localStorage: storage,
    });
    vi.stubGlobal('navigator', {
      platform: 'TestOS',
      language: 'en-US',
      hardwareConcurrency: undefined,
    });

    await new Collector({ csrfToken: 'csrf', debug: false }).initialize();

    expect(JSON.parse(existing.value).visitorIdSource).toBe('fallback');
    expect(storage.setItem).toHaveBeenCalledOnce();
  });

  it('reports an initialization failure without throwing', async () => {
    const { Collector } = loadCollector();
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    vi.stubGlobal('Intl', {
      DateTimeFormat: vi.fn(() => {
        throw new Error('timezone unavailable');
      }),
    });
    const collector = new Collector({ csrfToken: 'csrf', debug: false });

    await expect(collector.initialize()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      '[DeviceInfoCollector] Initialization failed:',
      expect.any(Error)
    );
  });

  it('does not inject before collection or without CSRF configuration', async () => {
    const postForm = form({ method: 'POST' });
    const fp = fingerprint();
    const { Collector } = loadCollector({
      fingerprintJS: fp,
      forms: [postForm],
    });
    const collector = new Collector({ csrfToken: '', debug: false });

    (collector as any).injectIntoForms();
    await collector.initialize();

    expect(postForm.insertBefore).not.toHaveBeenCalled();
  });

  it('injects only dynamically-added POST forms and nested POST forms', async () => {
    const fp = fingerprint();
    const { Collector } = loadCollector({ fingerprintJS: fp });
    const collector = new Collector({ csrfToken: 'csrf', debug: false });
    await collector.initialize();
    const postForm = Object.assign(form({ method: 'post' }), {
      nodeType: 1,
      tagName: 'FORM',
    });
    const getForm = Object.assign(form({ method: 'GET' }), {
      nodeType: 1,
      tagName: 'FORM',
    });
    const methodlessForm = Object.assign(form(), {
      nodeType: 1,
      tagName: 'FORM',
    });
    const nested = form({ method: 'POST' });
    const container = {
      nodeType: 1,
      tagName: 'DIV',
      querySelectorAll: vi.fn(() => [nested]),
    };

    MutationObserverFixture.instances[0]?.callback([
      {
        addedNodes: [
          { nodeType: 3 },
          postForm,
          getForm,
          methodlessForm,
          container,
        ],
      },
    ]);
    (collector as any).injectIntoForm(getForm);
    (collector as any).injectIntoForm(methodlessForm);

    expect(postForm.insertBefore).toHaveBeenCalledOnce();
    expect(getForm.insertBefore).not.toHaveBeenCalled();
    expect(methodlessForm.insertBefore).not.toHaveBeenCalled();
    expect(nested.insertBefore).toHaveBeenCalledOnce();
    expect(container.querySelectorAll).toHaveBeenCalledWith(
      'form[method="POST"], form[method="post"]'
    );
  });

  it('does not replace an active mutation observer and tears down idempotently', async () => {
    const fp = fingerprint();
    const { Collector } = loadCollector({ fingerprintJS: fp });
    const collector = new Collector({ csrfToken: 'csrf', debug: true });
    await collector.initialize();
    const observer = MutationObserverFixture.instances[0]!;

    (collector as any).startFormObserver();
    collector.destroy();
    collector.destroy();

    expect(MutationObserverFixture.instances).toHaveLength(1);
    expect(observer.disconnect).toHaveBeenCalledOnce();
  });

  it('registers page initialization for DOM readiness once', () => {
    const { documentListeners } = loadCollector();

    registerDeviceInfoEntry();

    expect(document.addEventListener).toHaveBeenCalledWith(
      'DOMContentLoaded',
      expect.any(Function),
      { once: true }
    );
    expect(documentListeners.get('DOMContentLoaded')).toBeTypeOf('function');
  });

  it.each([
    ['missing state', null],
    ['malformed state', { textContent: '{' }],
    ['blank state', { textContent: null }],
    ['missing CSRF', { textContent: JSON.stringify({ debug: false }) }],
  ])('rejects %s during page bootstrap', (_name, stateElement) => {
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadCollector();
    vi.mocked(document.getElementById).mockReturnValue(stateElement as any);

    initializeDeviceInfoPage();

    expect(consoleError.mock.calls.length + consoleWarn.mock.calls.length).toBe(
      1
    );
  });

  it.each([true, false])(
    'bootstraps valid page state with debug=%s and cleans up on lifecycle events',
    async debug => {
      const fp = fingerprint();
      const { windowListeners } = loadCollector({ fingerprintJS: fp });
      vi.mocked(document.getElementById).mockReturnValue({
        textContent: JSON.stringify({ csrfToken: 'csrf', debug }),
      } as any);
      const collector = initializeDeviceInfoPage();
      expect(collector).toBeInstanceOf(DeviceInfoCollector);
      await vi.waitFor(() =>
        expect(MutationObserverFixture.instances).toHaveLength(1)
      );

      windowListeners.get('beforeunload')?.();
      windowListeners.get('pagehide')?.();
      expect(
        MutationObserverFixture.instances[0]?.disconnect
      ).toHaveBeenCalledOnce();
    }
  );

  it('is statically importable outside a browser document', () => {
    expect(DeviceInfoCollector).toBeTypeOf('function');
  });
});
