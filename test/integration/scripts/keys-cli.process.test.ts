import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '../../..');
const keysEntrypoint = join(
  repositoryRoot,
  'dist',
  'scripts',
  'manage',
  'keys.js'
);

function runKeys(workingDirectory: string, ...arguments_: string[]) {
  return spawnSync(process.execPath, [keysEntrypoint, ...arguments_], {
    cwd: workingDirectory,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', NODE_ENV: 'test' },
    // Real asymmetric key generation should finish quickly; this ceiling only detects a deadlocked child process.
    timeout: 10_000,
  });
}

describe.sequential('compiled JWKS keys CLI', () => {
  let temporaryRoot: string;

  beforeAll(() => {
    if (!existsSync(keysEntrypoint)) {
      throw new Error(
        'The compiled keys CLI is missing. Run pnpm build before this integration suite.'
      );
    }
    temporaryRoot = mkdtempSync(join(tmpdir(), 'parako-keys-cli-'));
  });

  afterAll(() => {
    if (temporaryRoot) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('refuses to replace an existing first-boot JWKS file', () => {
    const workingDirectory = mkdtempSync(join(temporaryRoot, 'existing-'));
    const outputDirectory = join(workingDirectory, 'runtime', 'jwks');
    const outputPath = join(outputDirectory, 'jwks.json');
    const existingContent = '{"marker":"preserve-me"}\n';
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(outputPath, existingContent, { mode: 0o600 });

    const result = runKeys(workingDirectory, 'generate');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('already exists');
    expect(readFileSync(outputPath, 'utf8')).toBe(existingContent);
  });

  it('generates a complete owner-only first-boot JWKS file', () => {
    const workingDirectory = mkdtempSync(join(temporaryRoot, 'generate-'));
    const outputPath = join(workingDirectory, 'runtime', 'jwks', 'jwks.json');

    const result = runKeys(workingDirectory, 'generate');

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('JWKS keys generated successfully');
    expect(statSync(outputPath).mode & 0o777).toBe(0o600);

    const document = JSON.parse(readFileSync(outputPath, 'utf8')) as {
      keys: Array<Record<string, unknown>>;
    };
    expect(document.keys.map(key => key.alg)).toEqual([
      'RS256',
      'ES256',
      'EdDSA',
    ]);
    expect(document.keys).toHaveLength(3);
    expect(new Set(document.keys.map(key => key.kid))).toHaveProperty(
      'size',
      3
    );
    for (const key of document.keys) {
      expect(key).toMatchObject({ use: 'sig' });
      expect(key.kid).toEqual(expect.any(String));
      expect(key.d).toEqual(expect.any(String));
    }
  });

  it('reports a filesystem failure without exposing generated private keys', () => {
    const workingDirectory = mkdtempSync(join(temporaryRoot, 'failure-'));
    const runtimeDirectory = join(workingDirectory, 'runtime');
    const collisionPath = join(runtimeDirectory, 'jwks');
    const collisionContent = 'not-a-directory\n';
    mkdirSync(runtimeDirectory, { recursive: true });
    writeFileSync(collisionPath, collisionContent, { mode: 0o600 });

    const result = runKeys(workingDirectory, 'generate');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Failed to generate keys');
    expect(result.stderr).toContain('ENOTDIR');
    expect(result.stderr).not.toContain('"d":');
    expect(result.stdout).not.toContain('JWKS keys generated successfully');
    expect(readFileSync(collisionPath, 'utf8')).toBe(collisionContent);
  });
});
