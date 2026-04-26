import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';

// Mock jose
vi.mock('jose', () => ({
  generateKeyPair: vi.fn().mockResolvedValue({
    privateKey: {},
    publicKey: {},
  }),
  exportJWK: vi.fn().mockResolvedValue({
    kty: 'RSA',
    n: 'test-n',
    e: 'AQAB',
  }),
  calculateJwkThumbprint: vi.fn().mockResolvedValue('test-kid-123'),
}));

describe('Keys CLI — index.ts exports', () => {
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

      writeSpy.mockRestore();
      mkdirSpy.mockRestore();
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
      copySpy.mockRestore();
    });
  });
});
