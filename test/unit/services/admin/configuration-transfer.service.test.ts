import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultFullConfig } from '../../../../src/config/constants.js';
import type { RuntimeConfig } from '../../../../src/config/types.js';
import { maskSensitiveValue } from '../../../../src/utils/settings.helper.js';
import { ConfigurationTransferService } from '../../../../src/services/admin/configuration-transfer.service.js';

function createFixture() {
  const defaults = getDefaultFullConfig();
  const current: RuntimeConfig = {
    ...defaults,
    deployment: {
      ...defaults.deployment,
      environment: 'development',
      server: { ...defaults.deployment.server, port: 9007 },
    },
    storage: { adapter: 'sqlite', sqlite: { path: 'runtime/test.db' } },
    _metadata: {
      configProvider: 'database',
      isBootstrapMerged: true,
      loadedAt: new Date('2026-08-16T10:00:00.000Z'),
    },
  };
  current.security.secrets.jwt_secret = 'current-secret';
  const dependencies = {
    getCurrentConfig: vi.fn(() => current),
    updateConfig: vi.fn().mockResolvedValue(undefined),
    reloadConfig: vi.fn().mockResolvedValue(undefined),
    generateConfigDiff: vi.fn().mockReturnValue([
      {
        field: 'application.title',
        oldValue: 'Old',
        newValue: 'Imported',
        changeType: 'modified' as const,
      },
    ]),
    analyzeConfigImpact: vi.fn().mockReturnValue({
      servicesAffected: [],
      requiresRestart: false,
      warnings: [],
    }),
  };
  return { current, dependencies };
}

describe('ConfigurationTransferService', () => {
  let fixture: ReturnType<typeof createFixture>;
  let service: ConfigurationTransferService;

  beforeEach(() => {
    fixture = createFixture();
    service = new ConfigurationTransferService(fixture.dependencies);
  });

  it('creates a dated export with masked secrets and actor metadata', () => {
    const exported = service.createExport(
      'admin@example.com',
      new Date('2026-08-16T10:30:00.000Z')
    );

    expect(exported.filename).toBe('parako-config-export-2026-08-16.json');
    expect(exported.data._export_metadata).toEqual(
      expect.objectContaining({
        exportedAt: '2026-08-16T10:30:00.000Z',
        exportedBy: 'admin@example.com',
        version: '1.0.0',
      })
    );
    expect(
      (exported.data.security as typeof fixture.current.security).secrets
        .jwt_secret
    ).toBe(maskSensitiveValue('current-secret'));
  });

  it.each([
    [undefined, 'No configuration data provided'],
    ['', 'No configuration data provided'],
    ['{broken', 'Invalid JSON format'],
    ['null', 'Configuration must be a JSON object'],
    ['[]', 'Configuration must be a JSON object'],
    [42, 'Configuration must be a JSON object'],
  ])('rejects invalid preview input %#', (input, error) => {
    expect(service.preview(input)).toEqual({ valid: false, error });
    expect(fixture.dependencies.generateConfigDiff).not.toHaveBeenCalled();
  });

  it.each([
    JSON.stringify({
      _export_metadata: { exportedAt: 'ignored' },
      application: { title: 'Imported' },
    }),
    {
      _export_metadata: { exportedAt: 'ignored' },
      application: { title: 'Imported' },
    },
  ])('previews string and object payloads without export metadata', input => {
    expect(service.preview(input)).toEqual({
      valid: true,
      value: {
        diff: expect.any(Array),
        impact: expect.any(Object),
        changeCount: 1,
      },
    });
    expect(fixture.dependencies.generateConfigDiff).toHaveBeenCalledWith(
      fixture.current,
      { application: { title: 'Imported' } }
    );
  });

  it('restores masked secrets before applying and reloads afterward', async () => {
    const input = {
      _export_metadata: { ignored: true },
      application: { title: 'Imported' },
      security: {
        secrets: { jwt_secret: maskSensitiveValue('current-secret') },
      },
    };

    await expect(service.apply(input)).resolves.toEqual({
      valid: true,
      value: { restoredFields: ['security.secrets.jwt_secret'] },
    });
    expect(fixture.dependencies.updateConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        application: { title: 'Imported' },
        security: expect.objectContaining({
          secrets: expect.objectContaining({ jwt_secret: 'current-secret' }),
        }),
      })
    );
    expect(
      fixture.dependencies.updateConfig.mock.invocationCallOrder[0]
    ).toBeLessThan(
      fixture.dependencies.reloadConfig.mock.invocationCallOrder[0]!
    );
  });

  it('does not mutate persistence for invalid apply input', async () => {
    await expect(service.apply('[]')).resolves.toEqual({
      valid: false,
      error: 'Configuration must be a JSON object',
    });
    expect(fixture.dependencies.updateConfig).not.toHaveBeenCalled();
    expect(fixture.dependencies.reloadConfig).not.toHaveBeenCalled();
  });
});
