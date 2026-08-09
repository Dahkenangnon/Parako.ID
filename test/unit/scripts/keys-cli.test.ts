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

describe('Keys CLI — index.ts exports', () => {
  beforeEach(() => {
    vi.spyOn(fs, 'chmodSync').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  describe('generateKeys()', () => {
    it('should generate keys and write jwks.json to runtime/jwks/', async () => {
      const { generateKeys } =
        await import('../../../scripts/manage/keys/index.js');

      const writeSpy = vi
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => {});
      const mkdirSpy = vi
        .spyOn(fs, 'mkdirSync')
        .mockImplementation(() => undefined as any);
      vi.spyOn(fs, 'existsSync').mockReturnValue(false);

      await generateKeys(true);

      expect(writeSpy).toHaveBeenCalledOnce();
      const writtenPath = writeSpy.mock.calls[0][0] as string;
      expect(writtenPath).toContain('runtime/jwks/jwks.json');

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

      writeSpy.mockRestore();
      mkdirSpy.mockRestore();
    });

    it('can generate only the required RSA and EC keys', async () => {
      const { generateKeys } =
        await import('../../../scripts/manage/keys/index.js');
      const writeSpy = vi
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => {});
      const mkdirSpy = vi
        .spyOn(fs, 'mkdirSync')
        .mockImplementation(() => undefined as any);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await generateKeys(false);

      const writtenContent = JSON.parse(writeSpy.mock.calls[0][1] as string);
      expect(writtenContent.keys).toHaveLength(2);
      expect(mkdirSpy).not.toHaveBeenCalled();
    });

    it('enforces owner-only permissions on the private JWKS file', async () => {
      const { generateKeys } =
        await import('../../../scripts/manage/keys/index.js');
      const writeSpy = vi
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => {});
      const chmodSpy = vi.mocked(fs.chmodSync);
      vi.spyOn(fs, 'existsSync').mockReturnValue(true);
      vi.spyOn(console, 'log').mockImplementation(() => {});

      await generateKeys(false);

      const outputPath = writeSpy.mock.calls[0]?.[0] as string;
      expect(writeSpy).toHaveBeenCalledWith(outputPath, expect.any(String), {
        encoding: 'utf8',
        mode: 0o600,
      });
      expect(chmodSpy).toHaveBeenCalledWith(outputPath, 0o600);
    });
  });

  describe('createBackup()', () => {
    it('should create a timestamped backup of the given file', async () => {
      const { createBackup } =
        await import('../../../scripts/manage/keys/index.js');

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
      const { generateKeysInteractive } =
        await import('../../../scripts/manage/keys/index.js');
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
      const { generateKeysInteractive } =
        await import('../../../scripts/manage/keys/index.js');
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
      const { generateKeysInteractive } =
        await import('../../../scripts/manage/keys/index.js');
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
