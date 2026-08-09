import sharp from 'sharp';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { ILogger } from '../di/interfaces/logger.interface.js';
import type { IStorageProvider } from '../storage/storage-provider.interface.js';
import { HARDENING } from '../config/hardening-defaults.js';

export type VariantFormat = 'avif' | 'webp' | 'jpeg';

export interface VariantDescriptor {
  key: string;
  width: number;
  format: VariantFormat;
}

/**
 * Map of generated variants grouped by output format and indexed by width.
 * Example: { avif: { 320: 'tid/cat/logo-1700000000-320.avif', ... }, ... }
 */
export type VariantSet = Record<VariantFormat, Record<number, string>>;

export interface GenerateVariantsOptions {
  /**
   * Encoding effort for AVIF. The build pipeline uses the higher value for
   * the best ratio; request-path callers should pass the lower value so the
   * encoder does not stall the event loop.
   */
  readonly avifEffort?: number;
}

const FORMAT_TO_MIME: Record<VariantFormat, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  jpeg: 'image/jpeg',
};

const FORMAT_TO_EXT: Record<VariantFormat, string> = {
  avif: 'avif',
  webp: 'webp',
  jpeg: 'jpg',
};

const stripExtension = (key: string): string => {
  const dot = key.lastIndexOf('.');
  const slash = key.lastIndexOf('/');
  return dot > slash ? key.slice(0, dot) : key;
};

export const buildVariantKey = (
  baseKey: string,
  width: number,
  format: VariantFormat
): string => `${stripExtension(baseKey)}-${width}.${FORMAT_TO_EXT[format]}`;

const emptyVariantSet = (): VariantSet => ({ avif: {}, webp: {}, jpeg: {} });

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Generate scaled WebP, AVIF, and JPEG variants from a raster image source.
 *
 * SVG inputs are skipped because they scale losslessly at the browser level
 * and rasterizing them would discard that property.
 */
@injectable()
export class ImageProcessorService {
  constructor(
    @inject(TYPES.Logger) private readonly logger: ILogger,
    @inject(TYPES.StorageProvider)
    private readonly storageProvider: IStorageProvider
  ) {}

  /**
   * Returns true when the input is a raster image whose variants can be
   * generated. SVG and unrecognized inputs return false.
   */
  public isRasterImage(mimeType: string): boolean {
    return (
      mimeType === 'image/jpeg' ||
      mimeType === 'image/png' ||
      mimeType === 'image/webp' ||
      mimeType === 'image/gif'
    );
  }

  public async generateVariants(
    source: Buffer,
    baseKey: string,
    mimeType: string,
    options: GenerateVariantsOptions = {}
  ): Promise<VariantSet> {
    if (!this.isRasterImage(mimeType)) {
      return emptyVariantSet();
    }

    const avifEffort = options.avifEffort ?? HARDENING.images.avif.effortUpload;

    const variants = emptyVariantSet();
    const descriptors: VariantDescriptor[] = [];
    const storedKeys: string[] = [];

    try {
      for (const width of HARDENING.images.widths) {
        const pipeline = sharp(source).resize(width, undefined, {
          fit: 'inside',
          withoutEnlargement: true,
        });

        const [avif, webp, jpeg] = await Promise.all([
          pipeline
            .clone()
            .avif({
              quality: HARDENING.images.avif.quality,
              effort: avifEffort,
            })
            .toBuffer(),
          pipeline
            .clone()
            .webp({
              quality: HARDENING.images.webp.quality,
              effort: HARDENING.images.webp.effort,
            })
            .toBuffer(),
          pipeline
            .clone()
            .jpeg({
              quality: HARDENING.images.jpeg.quality,
              progressive: HARDENING.images.jpeg.progressive,
            })
            .toBuffer(),
        ]);

        const avifKey = buildVariantKey(baseKey, width, 'avif');
        const webpKey = buildVariantKey(baseKey, width, 'webp');
        const jpegKey = buildVariantKey(baseKey, width, 'jpeg');
        const stores = [
          { buffer: avif, key: avifKey, mime: FORMAT_TO_MIME.avif },
          { buffer: webp, key: webpKey, mime: FORMAT_TO_MIME.webp },
          { buffer: jpeg, key: jpegKey, mime: FORMAT_TO_MIME.jpeg },
        ];
        const results = await Promise.allSettled(
          stores.map(({ buffer, key, mime }) =>
            this.storageProvider.store(buffer, key, mime)
          )
        );

        results.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            storedKeys.push(stores[index].key);
          }
        });
        const failedStore = results.find(
          result => result.status === 'rejected'
        );
        if (failedStore?.status === 'rejected') {
          throw failedStore.reason;
        }

        variants.avif[width] = avifKey;
        variants.webp[width] = webpKey;
        variants.jpeg[width] = jpegKey;

        descriptors.push(
          { key: avifKey, width, format: 'avif' },
          { key: webpKey, width, format: 'webp' },
          { key: jpegKey, width, format: 'jpeg' }
        );
      }
    } catch (error) {
      await this.deleteKeys(storedKeys);
      throw error;
    }

    this.logger.debug('Image variants generated', {
      baseKey,
      count: descriptors.length,
    });

    return variants;
  }

  public async deleteVariants(variants: VariantSet): Promise<void> {
    const keys: string[] = [];
    for (const format of ['avif', 'webp', 'jpeg'] as const) {
      for (const width of Object.keys(variants[format])) {
        keys.push(variants[format][Number(width)]);
      }
    }
    await this.deleteKeys(keys);
  }

  private async deleteKeys(keys: readonly string[]): Promise<void> {
    await Promise.all(
      keys.map(key =>
        Promise.resolve()
          .then(() => this.storageProvider.delete(key))
          .catch(error =>
            this.logger.warn('Variant delete failed', {
              key,
              error: errorMessage(error),
            })
          )
      )
    );
  }
}
