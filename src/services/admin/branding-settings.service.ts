import { getDefaultFullConfig } from '../../config/constants.js';
import type { RuntimeConfig } from '../../config/types.js';
import { mergeConfig, type DeepPartial } from '../../utils/config-merge.js';
import { resolveBrandingUrlAsync } from '../../utils/views.js';

type BrandingConfig = RuntimeConfig['branding'];
type BrandingPatch = DeepPartial<BrandingConfig>;

export type BrandingAssetField =
  'logo' | 'logoDark' | 'logoIcon' | 'logoIconDark' | 'favicon';

interface BrandingAssetDefinition {
  category: 'logos' | 'favicons';
  clearedValue: '' | null;
  context: string;
}

const BRANDING_ASSETS: Record<BrandingAssetField, BrandingAssetDefinition> = {
  logo: { category: 'logos', clearedValue: '', context: 'logo' },
  logoDark: {
    category: 'logos',
    clearedValue: null,
    context: 'logo_dark',
  },
  logoIcon: {
    category: 'logos',
    clearedValue: null,
    context: 'logo_icon',
  },
  logoIconDark: {
    category: 'logos',
    clearedValue: null,
    context: 'logo_icon_dark',
  },
  favicon: {
    category: 'favicons',
    clearedValue: null,
    context: 'favicon',
  },
};

export interface BrandingSettingsDependencies<UploadFile> {
  getBranding(): BrandingConfig | undefined;
  updateBranding(branding: BrandingPatch): Promise<void>;
  storeFile(
    file: UploadFile,
    category: BrandingAssetDefinition['category']
  ): Promise<string>;
  getFileUrl(storageKey: string): string | Promise<string>;
  deleteFile(storageKey: string): Promise<void>;
  logCleanupFailure(error: unknown, context: string, storageKey: string): void;
}

export interface BrandingAssetReplacement {
  storageKey: string;
  url: string;
}

export class BrandingSettingsService<UploadFile> {
  constructor(
    private readonly dependencies: BrandingSettingsDependencies<UploadFile>
  ) {}

  async resolveAssetUrls(branding: BrandingConfig): Promise<BrandingConfig> {
    const resolved = { ...branding } as Record<string, unknown>;

    await Promise.all(
      (Object.keys(BRANDING_ASSETS) as BrandingAssetField[]).map(
        async field => {
          const value = resolved[field];
          if (typeof value === 'string') {
            resolved[field] = await resolveBrandingUrlAsync(
              value,
              this.dependencies.getFileUrl
            );
          }
        }
      )
    );

    return resolved as BrandingConfig;
  }

  async updateSettings(
    submitted: BrandingPatch,
    logoFile?: UploadFile
  ): Promise<{ modifiedFieldCount: number }> {
    const changes = { ...submitted };
    let uploadedStorageKey: string | undefined;

    if (logoFile) {
      uploadedStorageKey = await this.dependencies.storeFile(
        logoFile,
        BRANDING_ASSETS.logo.category
      );
      changes.logo = uploadedStorageKey;
    } else {
      delete changes.logo;
    }

    const current = this.dependencies.getBranding() ?? ({} as BrandingConfig);
    const merged = mergeConfig(current, changes);

    if (uploadedStorageKey) {
      await this.persistReplacement(
        merged,
        current.logo,
        uploadedStorageKey,
        `${BRANDING_ASSETS.logo.context}_upload`
      );
    } else {
      await this.dependencies.updateBranding(merged);
    }

    return { modifiedFieldCount: Object.keys(changes).length };
  }

  async replaceAsset(
    field: Exclude<BrandingAssetField, 'logo'>,
    file: UploadFile
  ): Promise<BrandingAssetReplacement> {
    const definition = BRANDING_ASSETS[field];
    const current = this.dependencies.getBranding();
    const storageKey = await this.dependencies.storeFile(
      file,
      definition.category
    );

    await this.persistReplacement(
      { [field]: storageKey } as BrandingPatch,
      current?.[field],
      storageKey,
      `${definition.context}_upload`
    );

    return {
      storageKey,
      url: await this.dependencies.getFileUrl(storageKey),
    };
  }

  async removeAsset(field: BrandingAssetField): Promise<void> {
    const definition = BRANDING_ASSETS[field];
    const previousStorageKey = this.dependencies.getBranding()?.[field];

    await this.dependencies.updateBranding({
      [field]: definition.clearedValue,
    } as BrandingPatch);

    if (previousStorageKey) {
      await this.deleteBestEffort(
        previousStorageKey,
        `${definition.context}_removal_old_file_cleanup_failed`
      );
    }
  }

  async resetThemePart(field: 'colors' | 'fonts'): Promise<void> {
    const current = this.dependencies.getBranding() ?? ({} as BrandingConfig);
    const defaults = getDefaultFullConfig().branding[field];

    await this.dependencies.updateBranding({
      ...current,
      [field]: defaults,
    });
  }

  private async persistReplacement(
    branding: BrandingPatch,
    previousStorageKey: string | null | undefined,
    newStorageKey: string,
    context: string
  ): Promise<void> {
    try {
      await this.dependencies.updateBranding(branding);
    } catch (error) {
      await this.deleteBestEffort(newStorageKey, `${context}_rollback_failed`);
      throw error;
    }

    if (previousStorageKey && previousStorageKey !== newStorageKey) {
      await this.deleteBestEffort(
        previousStorageKey,
        `${context}_old_file_cleanup_failed`
      );
    }
  }

  private async deleteBestEffort(
    storageKey: string,
    context: string
  ): Promise<void> {
    try {
      await this.dependencies.deleteFile(storageKey);
    } catch (error) {
      this.dependencies.logCleanupFailure(error, context, storageKey);
    }
  }
}
