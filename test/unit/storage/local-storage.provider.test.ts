import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalStorageProvider } from '../../../src/storage/local-storage.provider.js';

describe('LocalStorageProvider', () => {
  let testRoot: string | undefined;

  const createProvider = (uploadDir = 'uploads', signedUrlExpiry?: number) => {
    if (!testRoot) throw new Error('Test root has not been created');

    const logger = {
      debug: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
    };
    const getConfig = vi.fn().mockReturnValue({
      security: {
        secrets: { cookie_secrets: ['local-storage-test-secret'] },
      },
      integrations: {
        file_storage: {
          upload_dir: uploadDir,
          ...(signedUrlExpiry === undefined
            ? {}
            : { signed_url_expiry_seconds: signedUrlExpiry }),
        },
      },
    });

    const provider = new LocalStorageProvider(
      { rootDir: testRoot } as never,
      logger as never,
      { getConfig } as never
    );
    return { getConfig, logger, provider };
  };

  const createTestRoot = async () => {
    testRoot = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'parako-local-storage-')
    );
    return testRoot;
  };

  afterEach(async () => {
    if (testRoot) {
      await fs.promises.rm(testRoot, { force: true, recursive: true });
      testRoot = undefined;
    }
  });

  it('rejects writes through a symlink that escapes the upload directory', async () => {
    await createTestRoot();
    if (!testRoot) throw new Error('Test root was not created');
    const uploadsPath = path.join(testRoot, 'uploads');
    const outsidePath = path.join(testRoot, 'outside');
    await fs.promises.mkdir(uploadsPath);
    await fs.promises.mkdir(outsidePath);
    await fs.promises.symlink(outsidePath, path.join(uploadsPath, 'escape'));

    const { provider } = createProvider();

    await expect(
      provider.store(
        Buffer.from('sensitive'),
        'escape/outside.txt',
        'text/plain'
      )
    ).rejects.toThrow(/outside uploads directory/i);
    await expect(
      fs.promises.access(path.join(outsidePath, 'outside.txt'))
    ).rejects.toThrow();
  });

  it('creates a relative upload directory and stores nested files', async () => {
    await createTestRoot();
    if (!testRoot) throw new Error('Test root was not created');
    const { logger, provider } = createProvider();

    await expect(
      provider.store(Buffer.from('avatar'), 'tenant/avatar.txt', 'text/plain')
    ).resolves.toBe('tenant/avatar.txt');

    await expect(
      fs.promises.readFile(
        path.join(testRoot, 'uploads/tenant/avatar.txt'),
        'utf8'
      )
    ).resolves.toBe('avatar');
    expect(logger.debug).toHaveBeenCalledWith('File stored locally', {
      key: 'tenant/avatar.txt',
    });
  });

  it('supports an existing absolute upload directory', async () => {
    await createTestRoot();
    if (!testRoot) throw new Error('Test root was not created');
    const absoluteUploadDir = path.join(testRoot, 'absolute-uploads');
    await fs.promises.mkdir(absoluteUploadDir);
    const { provider } = createProvider(absoluteUploadDir);

    await provider.store(Buffer.from('data'), 'file.txt', 'text/plain');

    await expect(
      fs.promises.readFile(path.join(absoluteUploadDir, 'file.txt'), 'utf8')
    ).resolves.toBe('data');
  });

  it.each(['../outside.txt', 'tenant/../outside.txt', 'tenant\0file.txt'])(
    'rejects a traversal key before writing: %s',
    async key => {
      await createTestRoot();
      const { provider } = createProvider();

      await expect(
        provider.store(Buffer.from('data'), key, 'text/plain')
      ).rejects.toThrow(/invalid storage key/i);
    }
  );

  it('rejects an absolute key outside the upload directory', async () => {
    await createTestRoot();
    const { provider } = createProvider();

    await expect(
      provider.store(Buffer.from('data'), '/outside.txt', 'text/plain')
    ).rejects.toThrow(/outside uploads directory/i);
  });

  it('rejects replacing a final-path symbolic link', async () => {
    await createTestRoot();
    if (!testRoot) throw new Error('Test root was not created');
    const uploadsPath = path.join(testRoot, 'uploads');
    const outsidePath = path.join(testRoot, 'outside.txt');
    await fs.promises.mkdir(uploadsPath);
    await fs.promises.writeFile(outsidePath, 'outside');
    await fs.promises.symlink(
      outsidePath,
      path.join(uploadsPath, 'linked.txt')
    );
    const { provider } = createProvider();

    await expect(
      provider.store(Buffer.from('replacement'), 'linked.txt', 'text/plain')
    ).rejects.toThrow(/symbolic link/i);
    await expect(fs.promises.readFile(outsidePath, 'utf8')).resolves.toBe(
      'outside'
    );
  });

  it('overwrites an existing regular file', async () => {
    await createTestRoot();
    if (!testRoot) throw new Error('Test root was not created');
    const { provider } = createProvider();
    await provider.store(Buffer.from('first'), 'file.txt', 'text/plain');

    await expect(
      provider.store(Buffer.from('second'), 'file.txt', 'text/plain')
    ).resolves.toBe('file.txt');

    await expect(
      fs.promises.readFile(path.join(testRoot, 'uploads/file.txt'), 'utf8')
    ).resolves.toBe('second');
  });

  it('deletes a stored file and logs the operation', async () => {
    await createTestRoot();
    if (!testRoot) throw new Error('Test root was not created');
    const { logger, provider } = createProvider();
    const storedPath = path.join(testRoot, 'uploads/tenant/file.txt');
    await provider.store(Buffer.from('data'), 'tenant/file.txt', 'text/plain');

    await provider.delete('tenant/file.txt');

    await expect(fs.promises.access(storedPath)).rejects.toThrow();
    expect(logger.debug).toHaveBeenCalledWith('File deleted', {
      key: 'tenant/file.txt',
    });
  });

  it('does nothing when asked to delete an empty key', async () => {
    await createTestRoot();
    const { logger, provider } = createProvider();

    await expect(provider.delete('')).resolves.toBeUndefined();

    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs invalid traversal keys during deletion without throwing', async () => {
    await createTestRoot();
    const { logger, provider } = createProvider();

    await expect(provider.delete('../outside.txt')).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
      context: 'local_storage_delete',
      key: '../outside.txt',
    });
  });

  it('warns and ignores an absolute delete key outside the upload directory', async () => {
    await createTestRoot();
    const { logger, provider } = createProvider();

    await expect(provider.delete('/outside.txt')).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      'Path traversal blocked in delete',
      { key: '/outside.txt' }
    );
  });

  it('does not delete through a directory symlink that escapes the upload directory', async () => {
    await createTestRoot();
    if (!testRoot) throw new Error('Test root was not created');
    const uploadsPath = path.join(testRoot, 'uploads');
    const outsidePath = path.join(testRoot, 'outside');
    await fs.promises.mkdir(uploadsPath);
    await fs.promises.mkdir(outsidePath);
    await fs.promises.writeFile(path.join(outsidePath, 'keep.txt'), 'keep');
    await fs.promises.symlink(outsidePath, path.join(uploadsPath, 'escape'));
    const { logger, provider } = createProvider();

    await expect(provider.delete('escape/keep.txt')).resolves.toBeUndefined();

    await expect(
      fs.promises.readFile(path.join(outsidePath, 'keep.txt'), 'utf8')
    ).resolves.toBe('keep');
    expect(logger.error).toHaveBeenCalledWith(expect.any(Error), {
      context: 'local_storage_delete',
      key: 'escape/keep.txt',
    });
  });

  it('returns an empty URL for an empty key', async () => {
    await createTestRoot();
    const { provider } = createProvider();

    expect(provider.getUrl('')).toBe('');
  });

  it('creates a signed local URL with the configured expiry', async () => {
    await createTestRoot();
    const { provider } = createProvider('uploads', 120);
    const now = Math.floor(Date.now() / 1000);

    const url = provider.getUrl('tenant/file name.txt');

    expect(url).toMatch(
      /^\/media\/file\/tenant\/file%20name\.txt\?expires=\d+&sig=[a-f0-9]{64}$/
    );
    const expires = Number(
      new URL(url, 'https://local.test').searchParams.get('expires')
    );
    expect(expires).toBeGreaterThanOrEqual(now + 119);
    expect(expires).toBeLessThanOrEqual(now + 121);
  });

  it('uses the default signed URL expiry when none is configured', async () => {
    await createTestRoot();
    const { provider } = createProvider();
    const now = Math.floor(Date.now() / 1000);

    const url = provider.getUrl('file.txt');
    const expires = Number(
      new URL(url, 'https://local.test').searchParams.get('expires')
    );

    expect(expires).toBeGreaterThanOrEqual(now + 3599);
    expect(expires).toBeLessThanOrEqual(now + 3601);
  });
});
