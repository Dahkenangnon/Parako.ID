import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ISettings } from '../../../../src/models/settings/types.js';
import {
  ConfigurationVersionService,
  parseConfigurationVersionId,
} from '../../../../src/services/admin/configuration-version.service.js';

describe('parseConfigurationVersionId', () => {
  it.each([undefined, null, '', '   ', { id: 'version-1' }])(
    'rejects malformed values: %#',
    value => {
      expect(parseConfigurationVersionId(value)).toBeNull();
    }
  );

  it('trims a valid identifier', () => {
    expect(parseConfigurationVersionId(' version-2 ')).toBe('version-2');
  });
});

function version(overrides: Partial<ISettings> = {}): ISettings {
  return {
    key: 'parako_config',
    version: '2.0.0',
    schema_version: '1.0.0',
    _version: 2,
    is_active: false,
    application: { title: 'Old' },
    ...overrides,
  } as ISettings;
}

describe('ConfigurationVersionService', () => {
  const dependencies = {
    findVersion: vi.fn(),
    getCurrentVersion: vi.fn().mockResolvedValue('3.0.0'),
    saveVersion: vi.fn().mockResolvedValue(undefined),
    reloadConfig: vi.fn().mockResolvedValue(undefined),
  };
  let service: ConfigurationVersionService;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.getCurrentVersion.mockResolvedValue('3.0.0');
    service = new ConfigurationVersionService(dependencies);
  });

  it('reports a missing target without writing', async () => {
    dependencies.findVersion.mockResolvedValue(null);

    await expect(
      service.rollback('missing', 'admin@example.com')
    ).resolves.toEqual({
      status: 'not-found',
      versionId: 'missing',
    });
    expect(dependencies.saveVersion).not.toHaveBeenCalled();
  });

  it('refuses to roll back to the active version', async () => {
    dependencies.findVersion.mockResolvedValue(version({ is_active: true }));

    await expect(
      service.rollback('active', 'admin@example.com')
    ).resolves.toEqual({
      status: 'active',
      versionId: 'active',
      version: '2.0.0',
    });
    expect(dependencies.saveVersion).not.toHaveBeenCalled();
  });

  it('saves only configuration sections and reloads after persistence', async () => {
    dependencies.findVersion.mockResolvedValue(
      version({
        id: 'public-id',
        _id: 'database-id',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-02T00:00:00.000Z',
        description: 'old record',
        metadata: { last_modified_by: 'previous-admin' },
      })
    );

    await expect(
      service.rollback('version-2', 'admin@example.com')
    ).resolves.toEqual({
      status: 'success',
      versionId: 'version-2',
      fromVersion: '3.0.0',
      toVersion: '2.0.0',
    });
    expect(dependencies.saveVersion).toHaveBeenCalledWith(
      { application: { title: 'Old' } },
      'admin@example.com',
      'Rollback to version 2.0.0 (from 3.0.0)'
    );
    expect(dependencies.saveVersion.mock.invocationCallOrder[0]).toBeLessThan(
      dependencies.reloadConfig.mock.invocationCallOrder[0]!
    );
  });

  it('does not reload when persistence fails', async () => {
    const failure = new Error('write failed');
    dependencies.findVersion.mockResolvedValue(version());
    dependencies.saveVersion.mockRejectedValue(failure);

    await expect(
      service.rollback('version-2', 'admin@example.com')
    ).rejects.toBe(failure);
    expect(dependencies.reloadConfig).not.toHaveBeenCalled();
  });
});
