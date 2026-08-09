import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  configure: vi.fn(),
  getLocale: vi.fn(),
  getLocales: vi.fn(),
  setLocale: vi.fn(),
  init: vi.fn(),
  translate: vi.fn(),
  translatePlural: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('i18n', () => ({
  default: {
    configure: mocks.configure,
    getLocale: mocks.getLocale,
    getLocales: mocks.getLocales,
    setLocale: mocks.setLocale,
    init: mocks.init,
    __: mocks.translate,
    __n: mocks.translatePlural,
  },
}));

vi.mock('node:fs', () => ({
  default: {
    existsSync: mocks.existsSync,
    readdirSync: mocks.readdirSync,
    readFileSync: mocks.readFileSync,
    mkdirSync: mocks.mkdirSync,
    writeFileSync: mocks.writeFileSync,
  },
}));

import { I18nService } from '../../../src/services/i18n.service.js';

function localeConfig(
  overrides: {
    available?: string[];
    default?: string;
    cookie?: string;
  } = {}
) {
  return {
    application: {
      locales: {
        available: overrides.available ?? ['en'],
        default: overrides.default ?? 'en',
      },
    },
    deployment: {
      cookies: {
        types: {
          locale: { name: overrides.cookie ?? 'parako.locale' },
        },
      },
    },
  };
}

function directory(name: string, isDirectory = true) {
  return { name, isDirectory: () => isDirectory };
}

function makeLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeService(config: unknown = localeConfig()) {
  let subscriber: ((updatedConfig: any) => void) | undefined;
  const configManager = {
    getConfig: vi.fn(() => config),
    subscribe: vi.fn((_name, callback) => {
      subscriber = callback;
    }),
  };
  const fileSystemUtils = { rootDir: '/srv/parako' };
  const logger = makeLogger();
  const service = new I18nService(
    configManager as any,
    fileSystemUtils as any,
    logger as any
  );
  return {
    configManager,
    fileSystemUtils,
    logger,
    service,
    getSubscriber: () => subscriber,
  };
}

describe('I18nService', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.NODE_ENV = 'production';
    mocks.existsSync.mockImplementation((filePath: string) => {
      if (filePath.endsWith('/.merged')) return false;
      return true;
    });
    mocks.readdirSync.mockReturnValue([
      directory('common'),
      directory('.private'),
      directory('README.md', false),
    ]);
    mocks.readFileSync.mockReturnValue('{"hello":"Hello"}');
    mocks.getLocale.mockReturnValue('en');
    mocks.getLocales.mockReturnValue(['en', 'fr']);
    mocks.translate.mockReturnValue('translated');
    mocks.translatePlural.mockReturnValue('translated plural');
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('merges visible namespace files and configures i18n during construction', () => {
    const { configManager } = makeService();

    expect(mocks.mkdirSync).toHaveBeenCalledWith(
      '/srv/parako/runtime/locales/.merged',
      { recursive: true }
    );
    expect(mocks.readFileSync).toHaveBeenCalledWith(
      '/srv/parako/runtime/locales/common/en.json',
      'utf-8'
    );
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/srv/parako/runtime/locales/.merged/en.json',
      JSON.stringify({ common: { hello: 'Hello' } }, null, 2),
      'utf-8'
    );
    expect(mocks.configure).toHaveBeenCalledWith({
      locales: ['en'],
      defaultLocale: 'en',
      directory: '/srv/parako/runtime/locales/.merged',
      objectNotation: true,
      updateFiles: false,
      autoReload: false,
      cookie: 'parako.locale',
      queryParameter: 'lang',
      mustacheConfig: { tags: ['{{', '}}'], disable: false },
      api: { __: 't', __n: 'tn' },
    });
    expect(configManager.subscribe).toHaveBeenCalledWith(
      'I18nService',
      expect.any(Function)
    );
  });

  it('does not configure twice when configure is called again', () => {
    const { service } = makeService();

    service.configure();

    expect(mocks.configure).toHaveBeenCalledOnce();
    expect(mocks.writeFileSync).toHaveBeenCalledOnce();
  });

  it('enables automatic locale reload only in development', () => {
    process.env.NODE_ENV = 'development';

    makeService();

    expect(mocks.configure).toHaveBeenCalledWith(
      expect.objectContaining({ autoReload: true })
    );
  });

  it('reconfigures from an updated config subscription', () => {
    const { getSubscriber, logger } = makeService();
    const updated = localeConfig({
      available: ['fr'],
      default: 'fr',
      cookie: 'locale.v2',
    });

    getSubscriber()?.(updated);

    expect(mocks.configure).toHaveBeenLastCalledWith(
      expect.objectContaining({
        locales: ['fr'],
        defaultLocale: 'fr',
        cookie: 'locale.v2',
      })
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      1,
      '[I18nService] Configuration updated, reconfiguring i18n with new locale settings'
    );
    expect(logger.info).toHaveBeenNthCalledWith(
      2,
      '[I18nService] i18n reconfigured successfully',
      { availableLocales: ['fr'], defaultLocale: 'fr' }
    );
  });

  it('contains and logs reconfiguration failures', () => {
    const { getSubscriber, logger } = makeService();
    const failure = new Error('i18n rejected config');
    mocks.configure.mockImplementationOnce(() => {
      throw failure;
    });

    expect(() => getSubscriber()?.(localeConfig())).not.toThrow();
    expect(logger.error).toHaveBeenCalledWith(failure, {
      context: '[I18nService] Failed to reconfigure i18n',
    });
  });

  it('writes an empty merged locale when the namespace root does not exist', () => {
    mocks.existsSync.mockImplementation((filePath: string) =>
      filePath.endsWith('/.merged')
    );

    makeService();

    expect(mocks.readdirSync).not.toHaveBeenCalled();
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/srv/parako/runtime/locales/.merged/en.json',
      '{}',
      'utf-8'
    );
  });

  it('isolates namespace directory read failures and writes an empty locale', () => {
    const failure = new Error('cannot read locales directory');
    mocks.readdirSync.mockImplementation(() => {
      throw failure;
    });

    const { logger } = makeService();

    expect(logger.error).toHaveBeenCalledWith(failure, {
      context: 'Error loading namespaced locales for en',
    });
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/srv/parako/runtime/locales/.merged/en.json',
      '{}',
      'utf-8'
    );
  });

  it('isolates an invalid namespace file and continues with valid namespaces', () => {
    const invalidJson = new SyntaxError('invalid JSON');
    mocks.readdirSync.mockReturnValue([
      directory('broken'),
      directory('common'),
      directory('missing'),
    ]);
    mocks.existsSync.mockImplementation((filePath: string) => {
      if (filePath.endsWith('/.merged')) return true;
      return !filePath.includes('/missing/');
    });
    mocks.readFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes('/broken/')) throw invalidJson;
      return '{"hello":"Hello"}';
    });

    const { logger } = makeService();

    expect(logger.error).toHaveBeenCalledWith(invalidJson, {
      context:
        'Error loading locale file /srv/parako/runtime/locales/broken/en.json',
    });
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/srv/parako/runtime/locales/.merged/en.json',
      JSON.stringify({ common: { hello: 'Hello' } }, null, 2),
      'utf-8'
    );
  });

  it('rejects non-object translation payloads without poisoning the merged file', () => {
    mocks.readFileSync.mockReturnValue('["not","a","namespace"]');

    const { logger } = makeService();

    expect(logger.error).toHaveBeenCalledWith(expect.any(TypeError), {
      context:
        'Error loading locale file /srv/parako/runtime/locales/common/en.json',
    });
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/srv/parako/runtime/locales/.merged/en.json',
      '{}',
      'utf-8'
    );
  });

  it('contains merged-directory write failures while preserving i18n setup', () => {
    const failure = new Error('read-only filesystem');
    mocks.mkdirSync.mockImplementation(() => {
      throw failure;
    });

    const { logger } = makeService();

    expect(logger.error).toHaveBeenCalledWith(failure, {
      context: 'Error writing merged locale files',
    });
    expect(mocks.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        directory: '/srv/parako/runtime/locales/.merged',
      })
    );
  });

  it('filters unsafe locale paths and selects a safe default', () => {
    const { logger } = makeService(
      localeConfig({
        available: ['en', '../../escape', 'fr-CA'],
        default: '../../escape',
      })
    );

    expect(mocks.configure).toHaveBeenCalledWith(
      expect.objectContaining({
        locales: ['en', 'fr-CA'],
        defaultLocale: 'en',
      })
    );
    expect(mocks.writeFileSync).toHaveBeenCalledTimes(2);
    expect(
      mocks.writeFileSync.mock.calls.some(([filePath]) =>
        String(filePath).includes('escape')
      )
    ).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      '[I18nService] Ignoring unsafe locale identifiers',
      { locales: ['../../escape'] }
    );
  });

  it('falls back to English when no safe configured locale remains', () => {
    makeService(localeConfig({ available: ['../bad'], default: '../bad' }));

    expect(mocks.configure).toHaveBeenCalledWith(
      expect.objectContaining({ locales: ['en'], defaultLocale: 'en' })
    );
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      '/srv/parako/runtime/locales/.merged/en.json',
      expect.any(String),
      'utf-8'
    );
  });

  it('delegates locale, middleware, and translation operations', () => {
    const { service } = makeService();
    const req = { id: 'request' } as any;
    const res = { id: 'response' } as any;
    const next = vi.fn();

    expect(service.getLocale()).toBe('en');
    expect(service.getLocale(req)).toBe('en');
    expect(mocks.getLocale).toHaveBeenNthCalledWith(1);
    expect(mocks.getLocale).toHaveBeenNthCalledWith(2, req);
    expect(service.getLocales()).toEqual(['en', 'fr']);

    service.setLocale('fr');
    service.setLocale(req, 'fr');
    expect(mocks.setLocale).toHaveBeenNthCalledWith(1, 'fr');
    expect(mocks.setLocale).toHaveBeenNthCalledWith(2, req, 'fr');

    service.init(req, res, next);
    expect(mocks.init).toHaveBeenCalledWith(req, res, next);

    expect(service.__('hello', 'Maria')).toBe('translated');
    expect(mocks.translate).toHaveBeenCalledWith('hello', 'Maria');
    expect(service.__n('item', 2, 'extra')).toBe('translated plural');
    expect(mocks.translatePlural).toHaveBeenCalledWith('item', 2, 'extra');
  });

  it('rejects request-specific locale changes without a locale', () => {
    const { service } = makeService();
    const req = {} as any;

    expect(() => service.setLocale(req)).toThrow(
      'A locale is required for request-specific locale changes'
    );
    expect(mocks.setLocale).not.toHaveBeenCalled();
  });
});
