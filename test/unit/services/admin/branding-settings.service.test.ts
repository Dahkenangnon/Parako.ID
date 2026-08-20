import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDefaultFullConfig } from '../../../../src/config/constants.js';
import { BrandingSettingsService } from '../../../../src/services/admin/branding-settings.service.js';

type Upload = { filename: string };

function createDependencies() {
  const branding = {
    ...getDefaultFullConfig().branding,
    companyName: 'Parako',
    logo: 'logos/current.png',
  };
  const dependencies = {
    getBranding: vi.fn(() => branding),
    updateBranding: vi.fn().mockResolvedValue(undefined),
    storeFile: vi.fn().mockResolvedValue('logos/new.png'),
    getFileUrl: vi.fn((key: string) => `/media/${key}`),
    deleteFile: vi.fn().mockResolvedValue(undefined),
    logCleanupFailure: vi.fn(),
  };

  return { branding, dependencies };
}

describe('BrandingSettingsService', () => {
  let fixture: ReturnType<typeof createDependencies>;
  let service: BrandingSettingsService<Upload>;

  beforeEach(() => {
    fixture = createDependencies();
    service = new BrandingSettingsService(fixture.dependencies);
  });

  it('resolves stored image keys without changing external or absent values', async () => {
    const branding = {
      ...fixture.branding,
      logoDark: 'https://cdn.example.test/dark.png',
      logoIcon: null,
      favicon: 'favicons/site.ico',
    };

    await expect(service.resolveAssetUrls(branding)).resolves.toEqual({
      ...branding,
      logo: '/media/logos/current.png',
      favicon: '/media/favicons/site.ico',
    });
    expect(fixture.dependencies.getFileUrl).toHaveBeenCalledTimes(2);
  });

  it('preserves the current logo when updating settings without a file', async () => {
    await expect(
      service.updateSettings({ companyName: 'Updated', logo: 'untrusted' })
    ).resolves.toEqual({ modifiedFieldCount: 1 });

    expect(fixture.dependencies.storeFile).not.toHaveBeenCalled();
    expect(fixture.dependencies.updateBranding).toHaveBeenCalledWith(
      expect.objectContaining({
        companyName: 'Updated',
        logo: 'logos/current.png',
      })
    );
  });

  it('persists a replacement before deleting the previous object', async () => {
    const file = { filename: 'new.png' };

    await expect(
      service.updateSettings({ companyName: 'Updated' }, file)
    ).resolves.toEqual({
      modifiedFieldCount: 2,
    });

    expect(fixture.dependencies.storeFile).toHaveBeenCalledWith(file, 'logos');
    expect(fixture.dependencies.updateBranding).toHaveBeenCalledWith(
      expect.objectContaining({ logo: 'logos/new.png' })
    );
    expect(
      fixture.dependencies.updateBranding.mock.invocationCallOrder[0]
    ).toBeLessThan(
      fixture.dependencies.deleteFile.mock.invocationCallOrder[0]!
    );
    expect(fixture.dependencies.deleteFile).toHaveBeenCalledWith(
      'logos/current.png'
    );
  });

  it('rolls back only the newly stored object when persistence fails', async () => {
    const failure = new Error('write failed');
    fixture.dependencies.updateBranding.mockRejectedValue(failure);

    await expect(
      service.updateSettings({}, { filename: 'new.png' })
    ).rejects.toBe(failure);

    expect(fixture.dependencies.deleteFile).toHaveBeenCalledTimes(1);
    expect(fixture.dependencies.deleteFile).toHaveBeenCalledWith(
      'logos/new.png'
    );
    expect(fixture.dependencies.deleteFile).not.toHaveBeenCalledWith(
      'logos/current.png'
    );
  });

  it('contains cleanup failure after a replacement has been persisted', async () => {
    const cleanupFailure = new Error('delete failed');
    fixture.branding.logoDark = 'logos/dark-current.png';
    fixture.dependencies.deleteFile.mockRejectedValue(cleanupFailure);

    await expect(
      service.replaceAsset('logoDark', { filename: 'dark.png' })
    ).resolves.toEqual({
      storageKey: 'logos/new.png',
      url: '/media/logos/new.png',
    });

    expect(fixture.dependencies.logCleanupFailure).toHaveBeenCalledWith(
      cleanupFailure,
      'logo_dark_upload_old_file_cleanup_failed',
      'logos/dark-current.png'
    );
  });

  it('persists asset removal before deleting storage', async () => {
    fixture.branding.logoIcon = 'logos/icon.png';

    await service.removeAsset('logoIcon');

    expect(fixture.dependencies.updateBranding).toHaveBeenCalledWith({
      logoIcon: null,
    });
    expect(
      fixture.dependencies.updateBranding.mock.invocationCallOrder[0]
    ).toBeLessThan(
      fixture.dependencies.deleteFile.mock.invocationCallOrder[0]!
    );
  });

  it('does not delete storage when reference removal fails', async () => {
    fixture.branding.favicon = 'favicons/site.ico';
    fixture.dependencies.updateBranding.mockRejectedValue(
      new Error('write failed')
    );

    await expect(service.removeAsset('favicon')).rejects.toThrow(
      'write failed'
    );

    expect(fixture.dependencies.deleteFile).not.toHaveBeenCalled();
  });

  it.each(['colors', 'fonts'] as const)(
    'restores default %s while preserving other branding fields',
    async field => {
      await service.resetThemePart(field);

      expect(fixture.dependencies.updateBranding).toHaveBeenCalledWith(
        expect.objectContaining({
          companyName: 'Parako',
          [field]: expect.any(Object),
        })
      );
    }
  );
});
