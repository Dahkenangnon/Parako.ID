import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const configure = vi.fn();
  return { configure, i18n: { configure } };
});

vi.mock('i18n', () => ({ default: mocks.i18n }));

import { createI18n } from '../../../src/config/i18n.js';

describe('createI18n', () => {
  beforeEach(() => {
    mocks.configure.mockClear();
  });

  it('configures and returns i18n from the current application settings', () => {
    const config = {
      application: { locales: { available: ['en', 'fr'], default: 'fr' } },
      deployment: { cookies: { types: { locale: { name: 'parako.locale' } } } },
    };
    const configManager = { getConfig: vi.fn(() => config) };
    const fileSystemUtils = {
      join: vi.fn(() => '/srv/parako/runtime/locales'),
      rootDir: '/srv/parako',
    };

    const result = createI18n(configManager as never, fileSystemUtils as never);

    expect(configManager.getConfig).toHaveBeenCalledOnce();
    expect(fileSystemUtils.join).toHaveBeenCalledWith(
      '/srv/parako',
      'runtime/locales'
    );
    expect(mocks.configure).toHaveBeenCalledWith({
      api: { __: 't', __n: 'tn' },
      cookie: 'parako.locale',
      defaultLocale: 'fr',
      directory: '/srv/parako/runtime/locales',
      locales: ['en', 'fr'],
      objectNotation: true,
      queryParameter: 'lang',
      updateFiles: false,
    });
    expect(result).toBe(mocks.i18n);
  });
});
