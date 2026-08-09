import path from 'node:path';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const multerConfigs: any[] = [];
  const diskStorage = vi.fn((options: any) => ({ type: 'disk', ...options }));
  const memoryStorage = vi.fn(() => ({ type: 'memory' }));
  const multer = vi.fn((options: any) => {
    multerConfigs.push(options);
    return { options };
  });
  Object.assign(multer, { diskStorage, memoryStorage });

  return {
    multer,
    multerConfigs,
    diskStorage,
    memoryStorage,
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
  };
});

vi.mock('multer', () => ({ default: mocks.multer }));
vi.mock('node:fs', () => ({
  default: {
    existsSync: mocks.existsSync,
    mkdirSync: mocks.mkdirSync,
    promises: {
      readFile: mocks.readFile,
      unlink: mocks.unlink,
    },
  },
}));

import {
  getTenantTempDir,
  UploadMiddleware,
} from '../../../src/middlewares/upload.middleware.js';
import { tenantContext } from '../../../src/multi-tenancy/tenant-context.js';

describe('UploadMiddleware', () => {
  const rootDir = '/srv/parako';
  let logger: Record<string, ReturnType<typeof vi.fn>>;
  let storageProvider: Record<string, any>;
  let imageProcessor: Record<string, ReturnType<typeof vi.fn>>;
  let middleware: UploadMiddleware;

  const createMiddleware = () =>
    new UploadMiddleware(
      logger as any,
      { rootDir } as any,
      storageProvider as any,
      imageProcessor as any
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.multerConfigs.length = 0;
    mocks.existsSync.mockReturnValue(false);
    mocks.readFile.mockResolvedValue(Buffer.from('file contents'));
    mocks.unlink.mockResolvedValue(undefined);
    logger = {
      debug: vi.fn(),
      warn: vi.fn(),
    };
    storageProvider = {
      providerName: 'local',
      store: vi.fn().mockResolvedValue('stored'),
      getUrl: vi.fn((key: string) => `/media/${key}`),
      delete: vi.fn().mockResolvedValue(undefined),
    };
    imageProcessor = {
      isRasterImage: vi.fn().mockReturnValue(false),
      generateVariants: vi.fn().mockResolvedValue({}),
    };
    middleware = createMiddleware();
  });

  const config = (index: number) => mocks.multerConfigs[index];
  const file = (originalname: string, mimetype: string): Express.Multer.File =>
    ({ originalname, mimetype }) as Express.Multer.File;

  const runFilter = (index: number, upload: Express.Multer.File) =>
    new Promise<boolean>((resolve, reject) => {
      config(index).fileFilter(
        {} as Request,
        upload,
        (error: Error | null, accepted?: boolean) => {
          if (error) reject(error);
          else resolve(Boolean(accepted));
        }
      );
    });

  const destination = (index: number, tenantId: string) =>
    new Promise<string>((resolve, reject) => {
      tenantContext.run(tenantId, () => {
        config(index).storage.destination(
          {} as Request,
          file('asset.png', 'image/png'),
          (error: Error | null, directory: string) => {
            if (error) reject(error);
            else resolve(directory);
          }
        );
      });
    });

  const filename = (
    index: number,
    req: Request,
    originalname: string,
    mimetype = 'image/png'
  ) =>
    new Promise<string>((resolve, reject) => {
      config(index).storage.filename(
        req,
        file(originalname, mimetype),
        (error: Error | null, value: string) => {
          if (error) reject(error);
          else resolve(value);
        }
      );
    });

  describe('tenant-scoped temporary directories', () => {
    it('rejects a tenant ID instead of normalizing it into another tenant namespace', () => {
      expect(() =>
        tenantContext.run('acme@corp', () =>
          getTenantTempDir(rootDir, 'avatars')
        )
      ).toThrow(/invalid tenant/i);
    });

    it('keeps an allowed system tenant in its own upload namespace', () => {
      const result = tenantContext.run('_platforms', () =>
        getTenantTempDir(rootDir, 'logos')
      );

      expect(result).toBe(
        path.resolve(rootDir, 'runtime/.tmp-uploads/_platforms/logos')
      );
    });

    it('rejects a tenant ID made entirely of path traversal characters', () => {
      expect(() =>
        tenantContext.run('../../..', () =>
          getTenantTempDir(rootDir, 'avatars')
        )
      ).toThrow(/invalid tenant/i);
    });

    it.each(['..', '../logos', '/tmp/escape'])(
      'rejects a category that escapes tenant scope: %s',
      category => {
        expect(() =>
          tenantContext.run('acme', () => getTenantTempDir(rootDir, category))
        ).toThrow(/invalid.*upload path/i);
      }
    );
  });

  describe('Multer configuration', () => {
    it('creates the shared temporary root and all four upload handlers', () => {
      expect(mocks.mkdirSync).toHaveBeenCalledWith(
        path.join(rootDir, 'runtime', '.tmp-uploads'),
        { recursive: true }
      );
      expect(mocks.multer).toHaveBeenCalledTimes(4);
      expect(mocks.diskStorage).toHaveBeenCalledTimes(3);
      expect(mocks.memoryStorage).toHaveBeenCalledOnce();
      expect(config(0).limits).toEqual({
        fileSize: 5 * 1024 * 1024,
        files: 1,
      });
      expect(config(1).limits).toEqual({
        fileSize: 10 * 1024 * 1024,
        files: 1,
      });
      expect(config(2).limits).toEqual({
        fileSize: 5 * 1024 * 1024,
        files: 5,
      });
      expect(config(3).limits).toEqual({
        fileSize: 1 * 1024 * 1024,
        files: 1,
      });
    });

    it('does not recreate an existing temporary root', () => {
      mocks.mkdirSync.mockClear();
      mocks.existsSync.mockReturnValue(true);

      createMiddleware();

      expect(mocks.mkdirSync).not.toHaveBeenCalled();
    });

    it.each(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])(
      'accepts avatar MIME type %s',
      async mimetype => {
        await expect(runFilter(0, file('avatar.bin', mimetype))).resolves.toBe(
          true
        );
      }
    );

    it('rejects a non-image avatar', async () => {
      await expect(
        runFilter(0, file('avatar.txt', 'text/plain'))
      ).rejects.toThrow('Only JPEG, PNG, GIF, and WebP images are allowed');
    });

    it.each([
      ['the CSV MIME type', 'report.data', 'text/csv'],
      ['the CSV extension', 'report.csv', 'application/octet-stream'],
    ])('accepts a CSV identified by %s', async (_label, name, mimetype) => {
      await expect(runFilter(1, file(name, mimetype))).resolves.toBe(true);
    });

    it('rejects a file that is not identified as CSV', async () => {
      await expect(
        runFilter(1, file('report.CSV', 'application/octet-stream'))
      ).rejects.toThrow('Only CSV files are allowed');
    });

    it.each([
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/svg+xml',
    ])('accepts logo MIME type %s', async mimetype => {
      await expect(runFilter(2, file('logo.bin', mimetype))).resolves.toBe(
        true
      );
    });

    it('rejects an unsupported logo MIME type', async () => {
      await expect(runFilter(2, file('logo.bmp', 'image/bmp'))).rejects.toThrow(
        'Only JPEG, PNG, GIF, WebP, and SVG images are allowed'
      );
    });

    it.each([
      'image/x-icon',
      'image/vnd.microsoft.icon',
      'image/png',
      'image/svg+xml',
    ])('accepts favicon MIME type %s', async mimetype => {
      await expect(runFilter(3, file('favicon.bin', mimetype))).resolves.toBe(
        true
      );
    });

    it.each(['.ico', '.png', '.svg'])(
      'rejects favicon extension %s when the declared MIME type is unsupported',
      async extension => {
        await expect(
          runFilter(3, file(`favicon${extension.toUpperCase()}`, 'text/plain'))
        ).rejects.toThrow(
          'Only ICO, PNG, and SVG files are allowed for favicons'
        );
      }
    );

    it('rejects an unsupported favicon', async () => {
      await expect(
        runFilter(3, file('favicon.jpg', 'image/jpeg'))
      ).rejects.toThrow(
        'Only ICO, PNG, and SVG files are allowed for favicons'
      );
    });

    it.each([
      [0, 'avatars'],
      [2, 'logos'],
      [3, 'favicons'],
    ])('creates tenant-scoped destination %s', async (index, category) => {
      const result = await destination(index, 'acme');

      expect(result).toBe(
        path.resolve(rootDir, 'runtime/.tmp-uploads/acme', category)
      );
      expect(mocks.mkdirSync).toHaveBeenCalledWith(result, { recursive: true });
    });

    it('names avatars with the active user ID, timestamp, and extension', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1234);

      await expect(
        filename(
          0,
          {
            session: { authenticatedUsers: { active: { id: 'user-1' } } },
          } as any,
          'avatar.PNG'
        )
      ).resolves.toBe('avatar-user-1-1234.png');
    });

    it('uses an explicit fallback when an avatar session has no active user', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1234);

      await expect(
        filename(0, { session: {} } as any, 'avatar.png')
      ).resolves.toBe('avatar-unknown-1234.png');
    });

    it('rejects an avatar filename when the session user ID contains a path separator', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1234);

      await expect(
        filename(
          0,
          {
            session: {
              authenticatedUsers: { active: { id: '../../outside' } },
            },
          } as any,
          'avatar.png'
        )
      ).rejects.toThrow(/invalid upload filename/i);
    });

    it.each([
      [2, 'logo'],
      [3, 'favicon'],
    ])(
      'names %s uploads with a timestamp and extension',
      async (index, prefix) => {
        vi.spyOn(Date, 'now').mockReturnValue(5678);

        await expect(
          filename(index, {} as Request, 'asset.svg', 'image/svg+xml')
        ).resolves.toBe(`${prefix}-5678.svg`);
      }
    );

    it.each([
      [0, 'avatar-unknown-9012.png', 'image/png'],
      [2, 'logo-9012.svg', 'image/svg+xml'],
      [3, 'favicon-9012.ico', 'image/x-icon'],
    ])(
      'derives disk upload handler %s extension from the accepted MIME type',
      async (index, expected, mimetype) => {
        vi.spyOn(Date, 'now').mockReturnValue(9012);

        await expect(
          filename(index, { session: {} } as any, 'payload.html', mimetype)
        ).resolves.toBe(expected);
      }
    );

    it('fails closed when a disk filename callback receives an unsupported MIME type', async () => {
      await expect(
        filename(
          0,
          { session: {} } as any,
          'payload.bin',
          'application/octet-stream'
        )
      ).rejects.toThrow('Invalid upload MIME type');
    });

    it.each([2, 3])(
      'rejects an unsafe original filename for disk upload handler %s',
      async index => {
        await expect(
          filename(index, {} as Request, 'asset.svg\\..\\outside')
        ).rejects.toThrow(/invalid upload original filename/i);
      }
    );
  });

  describe('storage-backed operations', () => {
    const storedFile = {
      filename: 'avatar-user-1.png',
      path: '/tmp/avatar-user-1.png',
      mimetype: 'image/png',
    } as Express.Multer.File;

    it('stores a raster source and variants under the tenant namespace', async () => {
      imageProcessor.isRasterImage.mockReturnValue(true);

      const result = await tenantContext.run('acme', () =>
        middleware.storeFile(storedFile, 'avatars')
      );

      const contents = Buffer.from('file contents');
      expect(mocks.readFile).toHaveBeenCalledWith(storedFile.path);
      expect(storageProvider.store).toHaveBeenCalledWith(
        contents,
        'acme/avatars/avatar-user-1.png',
        'image/png'
      );
      expect(imageProcessor.generateVariants).toHaveBeenCalledWith(
        contents,
        'acme/avatars/avatar-user-1.png',
        'image/png'
      );
      expect(mocks.unlink).toHaveBeenCalledWith(storedFile.path);
      expect(logger.debug).toHaveBeenCalledWith('File stored via provider', {
        key: 'acme/avatars/avatar-user-1.png',
        provider: 'local',
      });
      expect(result).toBe('acme/avatars/avatar-user-1.png');
    });

    it('skips image variants for a non-raster upload', async () => {
      await middleware.storeFile(
        { ...storedFile, mimetype: 'image/svg+xml' },
        'logos'
      );

      expect(imageProcessor.generateVariants).not.toHaveBeenCalled();
    });

    it('keeps the stored source when variant generation fails', async () => {
      imageProcessor.isRasterImage.mockReturnValue(true);
      imageProcessor.generateVariants.mockRejectedValue(
        new Error('encoder unavailable')
      );

      await expect(middleware.storeFile(storedFile, 'avatars')).resolves.toBe(
        'default/avatars/avatar-user-1.png'
      );
      expect(logger.warn).toHaveBeenCalledWith(
        'Image variant generation failed',
        {
          key: 'default/avatars/avatar-user-1.png',
          error: 'encoder unavailable',
        }
      );
    });

    it('preserves diagnostics when variant generation rejects a non-Error', async () => {
      imageProcessor.isRasterImage.mockReturnValue(true);
      imageProcessor.generateVariants.mockRejectedValue('encoder stopped');

      await middleware.storeFile(storedFile, 'avatars');

      expect(logger.warn).toHaveBeenCalledWith(
        'Image variant generation failed',
        expect.objectContaining({ error: 'encoder stopped' })
      );
    });

    it('treats temporary-file cleanup as best effort', async () => {
      mocks.unlink.mockRejectedValue(new Error('already removed'));

      await expect(middleware.storeFile(storedFile, 'avatars')).resolves.toBe(
        'default/avatars/avatar-user-1.png'
      );
    });

    it('cleans up the temporary file when persistent storage fails', async () => {
      const error = new Error('storage unavailable');
      storageProvider.store.mockRejectedValue(error);

      await expect(middleware.storeFile(storedFile, 'avatars')).rejects.toBe(
        error
      );
      expect(mocks.unlink).toHaveBeenCalledWith(storedFile.path);
      expect(logger.debug).not.toHaveBeenCalled();
    });

    it.each(['../shared', '/absolute', 'avatars/nested'])(
      'rejects an unsafe storage category: %s',
      async category => {
        await expect(
          middleware.storeFile(storedFile, category)
        ).rejects.toThrow(/invalid upload category/i);
        expect(mocks.readFile).not.toHaveBeenCalled();
      }
    );

    it.each(['../avatar.png', 'nested/avatar.png', ''])(
      'rejects an unsafe stored filename: %j',
      async unsafeFilename => {
        await expect(
          middleware.storeFile(
            { ...storedFile, filename: unsafeFilename },
            'avatars'
          )
        ).rejects.toThrow(/invalid upload filename/i);
        expect(mocks.readFile).not.toHaveBeenCalled();
      }
    );

    it.each([
      ['', ''],
      [
        'https://cdn.example.test/avatar.png',
        'https://cdn.example.test/avatar.png',
      ],
      [
        'http://cdn.example.test/avatar.png',
        'http://cdn.example.test/avatar.png',
      ],
    ])('returns %j without consulting storage', (input, expected) => {
      expect(middleware.getFileUrl(input)).toBe(expected);
      expect(storageProvider.getUrl).not.toHaveBeenCalled();
    });

    it.each([
      ['/uploads/default/avatars/a.png', 'default/avatars/a.png'],
      ['default/avatars/a.png', 'default/avatars/a.png'],
    ])('resolves storage URL for %s', (input, expectedKey) => {
      expect(middleware.getFileUrl(input)).toBe(`/media/${expectedKey}`);
      expect(storageProvider.getUrl).toHaveBeenCalledWith(expectedKey);
    });

    it('passes through an asynchronous provider URL', async () => {
      storageProvider.getUrl.mockResolvedValue(
        'https://object.example.test/signed'
      );

      await expect(middleware.getFileUrl('tenant/logo.png')).resolves.toBe(
        'https://object.example.test/signed'
      );
    });

    it.each(['', 'https://cdn.example.test/avatar.png'])(
      'does not delete %j',
      async key => {
        await middleware.deleteFile(key);
        expect(storageProvider.delete).not.toHaveBeenCalled();
      }
    );

    it.each([
      ['/uploads/default/avatars/a.png', 'default/avatars/a.png'],
      ['default/avatars/a.png', 'default/avatars/a.png'],
    ])('deletes storage key for %s', async (input, expectedKey) => {
      await middleware.deleteFile(input);
      expect(storageProvider.delete).toHaveBeenCalledWith(expectedKey);
    });

    it('propagates provider deletion failures', async () => {
      const error = new Error('delete unavailable');
      storageProvider.delete.mockRejectedValue(error);

      await expect(middleware.deleteFile('tenant/file.png')).rejects.toBe(
        error
      );
    });
  });
});
