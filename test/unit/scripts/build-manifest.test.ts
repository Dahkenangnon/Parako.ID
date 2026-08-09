import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  cleanPriorOutputs,
  collectFiles,
  hashFile,
  manifestFromEsbuildMeta,
  readManifest,
  writeManifest,
} from '../../../scripts/build-manifest.js';

const temporaryRoots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'parako-build-manifest-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('build manifest persistence', () => {
  it('returns null for absent or malformed manifests', () => {
    const root = temporaryRoot();
    const manifestPath = join(root, 'manifest.json');

    expect(readManifest(manifestPath)).toBeNull();
    writeFileSync(manifestPath, '{invalid json');
    expect(readManifest(manifestPath)).toBeNull();
  });

  it('writes and reads a formatted manifest in a nested directory', () => {
    const root = temporaryRoot();
    const manifestPath = join(root, 'public', 'manifest.json');
    const mapping = { 'css/styles.css': 'css/styles-abcd1234.css' };

    writeManifest(manifestPath, mapping);

    expect(readManifest(manifestPath)).toEqual(mapping);
    expect(readFileSync(manifestPath, 'utf8')).toBe(
      JSON.stringify(mapping, null, 2)
    );
  });
});

describe('prior build cleanup', () => {
  it('removes only existing files named by a prior manifest', () => {
    const root = temporaryRoot();
    mkdirSync(join(root, 'js'), { recursive: true });
    writeFileSync(join(root, 'js', 'app-deadbeef.js'), 'old');

    expect(
      cleanPriorOutputs(root, {
        'js/app.js': 'js/app-deadbeef.js',
        'css/styles.css': 'css/styles-missing.css',
      })
    ).toBe(1);
    expect(existsSync(join(root, 'js', 'app-deadbeef.js'))).toBe(false);
    expect(cleanPriorOutputs(root, null)).toBe(0);
  });

  it('ignores malformed and escaping manifest paths', () => {
    const parent = temporaryRoot();
    const publicRoot = join(parent, 'public');
    mkdirSync(publicRoot);
    const outside = join(parent, 'outside.js');
    writeFileSync(outside, 'must survive');

    expect(
      cleanPriorOutputs(publicRoot, {
        escape: '../outside.js',
        malformed: null,
      })
    ).toBe(0);
    expect(readFileSync(outside, 'utf8')).toBe('must survive');
  });
});

describe('hashed output names', () => {
  it.each(['app.js', 'LICENSE'])('hashes and renames %s', fileName => {
    const root = temporaryRoot();
    const source = join(root, fileName);
    const contents = `contents:${fileName}`;
    writeFileSync(source, contents);
    const digest = createHash('sha256')
      .update(contents)
      .digest('hex')
      .slice(0, 8);

    const relativePath = hashFile(source, root);

    expect(relativePath).toBe(
      fileName.includes('.')
        ? fileName.replace('.', `-${digest}.`)
        : `${fileName}-${digest}`
    );
    expect(existsSync(source)).toBe(false);
    expect(readFileSync(join(root, relativePath), 'utf8')).toBe(contents);
  });
});

describe('esbuild manifest mapping', () => {
  it('maps matching entry outputs and skips chunks and other prefixes', () => {
    const root = temporaryRoot();
    const publicRoot = join(root, 'public');
    const metaPath = join(root, 'meta.json');
    const outbase = join(root, 'src', 'assets', 'js');
    mkdirSync(publicRoot);
    writeFileSync(
      metaPath,
      JSON.stringify({
        outputs: {
          'public/js/auth/login-HASH.js': {
            entryPoint: join(outbase, 'auth', 'login.ts'),
          },
          'public/js/chunk.js': {},
          'public/css/styles.css': {
            entryPoint: join(root, 'src', 'assets', 'css', 'app.ts'),
          },
        },
      })
    );

    expect(
      manifestFromEsbuildMeta(metaPath, publicRoot, 'js', outbase)
    ).toEqual({
      'js/auth/login.js': 'js/auth/login-HASH.js',
    });
  });
});

describe('asset collection', () => {
  it('returns an empty list for an absent root', () => {
    expect(collectFiles(join(temporaryRoot(), 'missing'), ['.css'])).toEqual(
      []
    );
  });

  it('recursively collects only allowed file extensions', () => {
    const root = temporaryRoot();
    mkdirSync(join(root, 'nested'), { recursive: true });
    writeFileSync(join(root, 'app.js'), 'js');
    writeFileSync(join(root, 'styles.css'), 'css');
    writeFileSync(join(root, 'nested', 'theme.css'), 'css');

    expect(
      collectFiles(root, ['.css'])
        .map(path => basename(path))
        .sort()
    ).toEqual(['styles.css', 'theme.css']);
  });
});
