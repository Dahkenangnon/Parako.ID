import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Format = 'avif' | 'webp' | 'jpeg';

const image = vi.hoisted(() => ({
  sharp: vi.fn(),
  resizeCalls: [] as Array<{
    width: number;
    height: undefined;
    options: Record<string, unknown>;
  }>,
  formatCalls: [] as Array<{
    width: number;
    format: Format;
    options: Record<string, unknown>;
  }>,
  encodeFailure: null as {
    width: number;
    format: Format;
    error: unknown;
  } | null,
}));

vi.mock('sharp', () => ({ default: image.sharp }));

import {
  buildVariantKey,
  ImageProcessorService,
  type VariantSet,
} from '../../../src/services/image-processor.service.js';
import { HARDENING } from '../../../src/config/hardening-defaults.js';

function makeSharpPipeline() {
  let width = 0;
  const pipeline: any = {
    resize: vi.fn(
      (
        requestedWidth: number,
        height: undefined,
        options: Record<string, unknown>
      ) => {
        width = requestedWidth;
        image.resizeCalls.push({ width, height, options });
        return pipeline;
      }
    ),
    clone: vi.fn(() => {
      let format: Format = 'jpeg';
      const encoder: any = {
        avif: vi.fn((options: Record<string, unknown>) => {
          format = 'avif';
          image.formatCalls.push({ width, format, options });
          return encoder;
        }),
        webp: vi.fn((options: Record<string, unknown>) => {
          format = 'webp';
          image.formatCalls.push({ width, format, options });
          return encoder;
        }),
        jpeg: vi.fn((options: Record<string, unknown>) => {
          format = 'jpeg';
          image.formatCalls.push({ width, format, options });
          return encoder;
        }),
        toBuffer: vi.fn(async () => {
          const failure = image.encodeFailure;
          if (failure?.width === width && failure.format === format) {
            throw failure.error;
          }
          return Buffer.from(`${format}-${width}`);
        }),
      };
      return encoder;
    }),
  };
  return pipeline;
}

function makeLogger() {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeService() {
  const logger = makeLogger();
  const storageProvider = {
    providerName: 'local',
    store: vi.fn(async (_buffer: Buffer, key: string) => key),
    delete: vi.fn().mockResolvedValue(undefined),
    getUrl: vi.fn(),
  };
  const service = new ImageProcessorService(
    logger as any,
    storageProvider as any
  );
  return { logger, service, storageProvider };
}

function fullVariantSet(): VariantSet {
  return {
    avif: { 320: 'avatar-320.avif', 640: 'avatar-640.avif' },
    webp: { 320: 'avatar-320.webp' },
    jpeg: { 320: 'avatar-320.jpg' },
  };
}

describe('image variant key construction', () => {
  it.each([
    ['tenant/avatar/photo.png', 320, 'avif', 'tenant/avatar/photo-320.avif'],
    ['tenant/avatar/photo', 640, 'webp', 'tenant/avatar/photo-640.webp'],
    [
      'tenant.with.dot/avatar/photo.jpeg',
      1024,
      'jpeg',
      'tenant.with.dot/avatar/photo-1024.jpg',
    ],
    ['photo.old.png', 1600, 'jpeg', 'photo.old-1600.jpg'],
  ] as const)(
    'builds %s at width %i as %s',
    (baseKey, width, format, expected) => {
      expect(buildVariantKey(baseKey, width, format)).toBe(expected);
    }
  );
});

describe('ImageProcessorService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    image.resizeCalls.length = 0;
    image.formatCalls.length = 0;
    image.encodeFailure = null;
    image.sharp.mockImplementation(() => makeSharpPipeline());
  });

  describe('raster detection', () => {
    it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])(
      'accepts %s',
      mimeType => {
        const { service } = makeService();
        expect(service.isRasterImage(mimeType)).toBe(true);
      }
    );

    it.each(['image/svg+xml', 'application/octet-stream', 'IMAGE/PNG', ''])(
      'rejects %s',
      mimeType => {
        const { service } = makeService();
        expect(service.isRasterImage(mimeType)).toBe(false);
      }
    );
  });

  describe('variant generation', () => {
    it('skips non-raster sources without invoking Sharp or storage', async () => {
      const { service, storageProvider } = makeService();

      await expect(
        service.generateVariants(
          Buffer.from('<svg/>'),
          'tenant/logo.svg',
          'image/svg+xml'
        )
      ).resolves.toEqual({ avif: {}, webp: {}, jpeg: {} });
      expect(image.sharp).not.toHaveBeenCalled();
      expect(storageProvider.store).not.toHaveBeenCalled();
    });

    it('creates every configured width and output format with hardened options', async () => {
      const { service, storageProvider, logger } = makeService();
      const source = Buffer.from('image-data');

      const result = await service.generateVariants(
        source,
        'tenant/avatars/alice.png',
        'image/png'
      );

      expect(image.sharp).toHaveBeenCalledTimes(HARDENING.images.widths.length);
      expect(image.sharp).toHaveBeenCalledWith(source);
      expect(image.resizeCalls).toEqual(
        HARDENING.images.widths.map(width => ({
          width,
          height: undefined,
          options: { fit: 'inside', withoutEnlargement: true },
        }))
      );
      expect(image.formatCalls).toHaveLength(
        HARDENING.images.widths.length * 3
      );
      for (const width of HARDENING.images.widths) {
        expect(image.formatCalls).toContainEqual({
          width,
          format: 'avif',
          options: {
            quality: HARDENING.images.avif.quality,
            effort: HARDENING.images.avif.effortUpload,
          },
        });
        expect(image.formatCalls).toContainEqual({
          width,
          format: 'webp',
          options: {
            quality: HARDENING.images.webp.quality,
            effort: HARDENING.images.webp.effort,
          },
        });
        expect(image.formatCalls).toContainEqual({
          width,
          format: 'jpeg',
          options: {
            quality: HARDENING.images.jpeg.quality,
            progressive: HARDENING.images.jpeg.progressive,
          },
        });
      }

      expect(storageProvider.store).toHaveBeenCalledTimes(
        HARDENING.images.widths.length * 3
      );
      expect(storageProvider.store).toHaveBeenCalledWith(
        Buffer.from('avif-320'),
        'tenant/avatars/alice-320.avif',
        'image/avif'
      );
      expect(storageProvider.store).toHaveBeenCalledWith(
        Buffer.from('webp-640'),
        'tenant/avatars/alice-640.webp',
        'image/webp'
      );
      expect(storageProvider.store).toHaveBeenCalledWith(
        Buffer.from('jpeg-1600'),
        'tenant/avatars/alice-1600.jpg',
        'image/jpeg'
      );
      expect(result).toEqual({
        avif: Object.fromEntries(
          HARDENING.images.widths.map(width => [
            width,
            `tenant/avatars/alice-${width}.avif`,
          ])
        ),
        webp: Object.fromEntries(
          HARDENING.images.widths.map(width => [
            width,
            `tenant/avatars/alice-${width}.webp`,
          ])
        ),
        jpeg: Object.fromEntries(
          HARDENING.images.widths.map(width => [
            width,
            `tenant/avatars/alice-${width}.jpg`,
          ])
        ),
      });
      expect(logger.debug).toHaveBeenCalledWith('Image variants generated', {
        baseKey: 'tenant/avatars/alice.png',
        count: HARDENING.images.widths.length * 3,
      });
    });

    it('honors a caller-supplied AVIF effort', async () => {
      const { service } = makeService();

      await service.generateVariants(
        Buffer.from('image-data'),
        'avatar.png',
        'image/png',
        { avifEffort: 6 }
      );

      const avifCalls = image.formatCalls.filter(
        call => call.format === 'avif'
      );
      expect(avifCalls).toHaveLength(HARDENING.images.widths.length);
      expect(avifCalls.every(call => call.options.effort === 6)).toBe(true);
    });

    it('rolls back prior-width variants when a later encoding fails', async () => {
      const failure = new Error('AVIF encoder failed');
      image.encodeFailure = { width: 640, format: 'avif', error: failure };
      const { service, storageProvider } = makeService();

      await expect(
        service.generateVariants(
          Buffer.from('image-data'),
          'tenant/avatar.png',
          'image/png'
        )
      ).rejects.toBe(failure);
      expect(
        storageProvider.delete.mock.calls.map(([key]) => key).sort()
      ).toEqual([
        'tenant/avatar-320.avif',
        'tenant/avatar-320.jpg',
        'tenant/avatar-320.webp',
      ]);
    });

    it('rolls back successful sibling stores when one variant store fails', async () => {
      const failure = new Error('object store unavailable');
      const { service, storageProvider } = makeService();
      storageProvider.store.mockImplementation(
        async (_buffer: Buffer, key: string) => {
          if (key === 'tenant/avatar-320.webp') throw failure;
          return key;
        }
      );

      await expect(
        service.generateVariants(
          Buffer.from('image-data'),
          'tenant/avatar.png',
          'image/png'
        )
      ).rejects.toBe(failure);
      expect(
        storageProvider.delete.mock.calls.map(([key]) => key).sort()
      ).toEqual(['tenant/avatar-320.avif', 'tenant/avatar-320.jpg']);
    });

    it('preserves the original generation error when rollback deletion fails', async () => {
      const generationFailure = new Error('PNG decode failed');
      image.encodeFailure = {
        width: 640,
        format: 'webp',
        error: generationFailure,
      };
      const { service, storageProvider, logger } = makeService();
      storageProvider.delete.mockRejectedValue('rollback unavailable');

      await expect(
        service.generateVariants(
          Buffer.from('image-data'),
          'tenant/avatar.png',
          'image/png'
        )
      ).rejects.toBe(generationFailure);
      expect(logger.warn).toHaveBeenCalledWith('Variant delete failed', {
        key: expect.stringMatching(/^tenant\/avatar-320\./),
        error: 'rollback unavailable',
      });
    });
  });

  describe('variant deletion', () => {
    it('deletes every supplied key across all output formats', async () => {
      const { service, storageProvider } = makeService();

      await service.deleteVariants(fullVariantSet());

      expect(
        storageProvider.delete.mock.calls.map(([key]) => key).sort()
      ).toEqual([
        'avatar-320.avif',
        'avatar-320.jpg',
        'avatar-320.webp',
        'avatar-640.avif',
      ]);
    });

    it('accepts an empty variant set without storage calls', async () => {
      const { service, storageProvider } = makeService();

      await expect(
        service.deleteVariants({ avif: {}, webp: {}, jpeg: {} })
      ).resolves.toBeUndefined();
      expect(storageProvider.delete).not.toHaveBeenCalled();
    });

    it.each([
      [new Error('delete denied'), 'delete denied'],
      ['storage offline', 'storage offline'],
    ])('logs and contains a deletion failure: %s', async (failure, message) => {
      const { service, storageProvider, logger } = makeService();
      storageProvider.delete.mockRejectedValue(failure);

      await expect(
        service.deleteVariants(fullVariantSet())
      ).resolves.toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith('Variant delete failed', {
        key: 'avatar-320.avif',
        error: message,
      });
    });
  });
});
