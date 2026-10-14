import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import * as jose from 'jose';

const dependencies = vi.hoisted(() => ({
  assertInteractiveTty: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock('inquirer', () => ({
  default: { prompt: dependencies.prompt },
}));
vi.mock('../../../scripts/manage/shared/utils.js', () => ({
  assertInteractiveTty: dependencies.assertInteractiveTty,
}));

// Mock jose
vi.mock('jose', () => ({
  generateKeyPair: vi.fn().mockResolvedValue({
    privateKey: {},
    publicKey: {},
  }),
  exportJWK: vi.fn().mockImplementation(async () => ({
    kty: 'RSA',
    n: 'test-n',
    e: 'AQAB',
  })),
  calculateJwkThumbprint: vi.fn().mockResolvedValue('test-kid-123'),
}));

import {
  createBackup,
  generateKeys,
  generateKeysInteractive,
} from '../../../scripts/manage/keys/index.js';

describe('Keys CLI — index.ts exports', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined);
    vi.spyOn(fs, 'openSync').mockReturnValue(23);
    vi.spyOn(fs, 'fchmodSync').mockImplementation(() => {});
    vi.spyOn(fs, 'closeSync').mockImplementation(() => {});
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {});
    vi.spyOn(fs, 'unlinkSync').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('generateKeys()', () => {
    it('refuses an existing first-boot JWKS file before generating keys', async () => {
      vi.mocked(fs.openSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('already exists'), { code: 'EEXIST' });
      });
      const writeSpy = vi
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => {});

      await expect(generateKeys()).rejects.toThrow(
        'Refusing to overwrite first-boot keys'
      );

      expect(jose.generateKeyPair).not.toHaveBeenCalled();
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('propagates an unexpected first-boot file reservation error', async () => {
      const permissionError = Object.assign(new Error('permission denied'), {
        code: 'EACCES',
      });
      vi.mocked(fs.openSync).mockImplementationOnce(() => {
        throw permissionError;
      });

      await expect(generateKeys()).rejects.toBe(permissionError);

      expect(jose.generateKeyPair).not.toHaveBeenCalled();
    });

    it('should generate keys and write jwks.json to runtime/jwks/', async () => {
      const writeSpy = vi
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => {});

      await generateKeys(true);

      expect(writeSpy).toHaveBeenCalledWith(23, expect.any(String), 'utf8');
      expect(fs.renameSync).not.toHaveBeenCalled();

      const writtenContent = JSON.parse(writeSpy.mock.calls[0][1] as string);
      expect(writtenContent).toHaveProperty('keys');
      expect(writtenContent.keys).toHaveLength(3);
      expect(
        writtenContent.keys.map((key: { alg?: string }) => key.alg)
      ).toEqual(['RS256', 'ES256', 'EdDSA']);
      expect(vi.mocked(jose.generateKeyPair).mock.calls).toEqual([
        ['RS256', { extractable: true }],
        ['ES256', { extractable: true }],
        ['EdDSA', { extractable: true }],
      ]);
    });

    it('can generate only the required RSA and EC keys', async () => {
      const writeSpy = vi
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await generateKeys(false, true);

      const writtenContent = JSON.parse(writeSpy.mock.calls[0][1] as string);
      expect(writtenContent.keys).toHaveLength(2);
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('runtime/jwks'),
        { recursive: true }
      );
    });

    it('atomically replaces keys with owner-only permissions', async () => {
      const writeSpy = vi
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await generateKeys(false, true);

      const flags =
        fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW;
      expect(fs.openSync).toHaveBeenCalledWith(
        expect.stringContaining('runtime/jwks/jwks.json.tmp-'),
        flags,
        0o600
      );
      expect(writeSpy).toHaveBeenCalledWith(23, expect.any(String), 'utf8');
      expect(fs.fchmodSync).toHaveBeenCalledWith(23, 0o600);
      expect(fs.closeSync).toHaveBeenCalledWith(23);
      expect(fs.renameSync).toHaveBeenCalledWith(
        expect.stringContaining('runtime/jwks/jwks.json.tmp-'),
        expect.stringContaining('runtime/jwks/jwks.json')
      );
    });

    it('removes a reserved first-boot file if key generation fails', async () => {
      vi.mocked(jose.generateKeyPair).mockRejectedValueOnce(
        new Error('generation failed')
      );
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(generateKeys()).rejects.toThrow('generation failed');

      expect(fs.closeSync).toHaveBeenCalledWith(23);
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('runtime/jwks/jwks.json')
      );
    });

    it('preserves a generation failure when its reserved file is already absent', async () => {
      vi.mocked(jose.generateKeyPair).mockRejectedValueOnce(
        new Error('generation failed')
      );
      vi.mocked(fs.unlinkSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('already absent'), { code: 'ENOENT' });
      });
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(generateKeys()).rejects.toThrow('generation failed');

      expect(fs.closeSync).toHaveBeenCalledWith(23);
    });

    it('surfaces a failure to remove an incomplete reserved file', async () => {
      vi.mocked(jose.generateKeyPair).mockRejectedValueOnce(
        new Error('generation failed')
      );
      vi.mocked(fs.unlinkSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('cleanup denied'), { code: 'EACCES' });
      });
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(generateKeys()).rejects.toThrow('cleanup denied');
    });

    it('closes and removes a temporary replacement after a write failure', async () => {
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
        throw new Error('write failed');
      });
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(generateKeys(false, true)).rejects.toThrow('write failed');

      expect(fs.closeSync).toHaveBeenCalledWith(23);
      expect(fs.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('runtime/jwks/jwks.json.tmp-')
      );
      expect(fs.renameSync).not.toHaveBeenCalled();
    });

    it('ignores an absent temporary file after atomic replacement', async () => {
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.mocked(fs.unlinkSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('already renamed'), { code: 'ENOENT' });
      });
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(generateKeys(false, true)).resolves.toBeUndefined();

      expect(fs.renameSync).toHaveBeenCalledOnce();
    });

    it('surfaces an unexpected temporary-file cleanup failure', async () => {
      vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      vi.mocked(fs.unlinkSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('cleanup denied'), { code: 'EACCES' });
      });
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await expect(generateKeys(false, true)).rejects.toThrow('cleanup denied');
    });
  });

  describe('createBackup()', () => {
    it('should create a timestamped backup of the given file', async () => {
      const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementation(() => {});

      const backupPath = createBackup('/some/path/jwks.json');

      expect(copySpy).toHaveBeenCalledOnce();
      expect(backupPath).toContain('jwks.json.backup-');
      expect(fs.chmodSync).toHaveBeenCalledWith(backupPath, 0o600);
      copySpy.mockRestore();
    });
  });

  describe('generateKeysInteractive()', () => {
    it('generates immediately when no JWKS file exists', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);
      const writeSpy = vi
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => {});
      vi.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined as any);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await generateKeysInteractive();

      expect(dependencies.assertInteractiveTty).toHaveBeenCalledWith(
        'keys generate'
      );
      expect(dependencies.prompt).not.toHaveBeenCalled();
      expect(writeSpy).toHaveBeenCalledOnce();
    });

    it('leaves an existing JWKS file untouched when overwrite is declined', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const writeSpy = vi
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => {});
      const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      dependencies.prompt.mockResolvedValue({ confirmOverwrite: false });

      await generateKeysInteractive();

      expect(dependencies.prompt).toHaveBeenCalledOnce();
      expect(copySpy).not.toHaveBeenCalled();
      expect(writeSpy).not.toHaveBeenCalled();
    });

    it('backs up an existing JWKS file before confirmed replacement', async () => {
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      const writeSpy = vi
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => {});
      const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      dependencies.prompt.mockResolvedValue({ confirmOverwrite: true });

      await generateKeysInteractive();

      expect(copySpy).toHaveBeenCalledOnce();
      expect(copySpy.mock.calls[0]?.[0]).toContain('runtime/jwks/jwks.json');
      expect(writeSpy).toHaveBeenCalledOnce();
    });
  });
});
