import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import packageJson from '../../../package.json' with { type: 'json' };

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('source package release policy', () => {
  it('is private and does not advertise an unsupported npm API surface', () => {
    expect(packageJson.private).toBe(true);
    expect(packageJson).not.toHaveProperty('main');
    expect(packageJson).not.toHaveProperty('bin');
    expect(packageJson).not.toHaveProperty('files');
  });

  it('uses declared process entry points without requiring a global PM2 install', () => {
    expect(packageJson.scripts.start).toBe(
      'cross-env NODE_ENV=production node dist/src/index.js'
    );
    expect(packageJson.scripts['start:worker']).toBe(
      'cross-env NODE_ENV=production node dist/src/worker.js'
    );
    expect(packageJson.scripts).not.toHaveProperty('restart');
    expect(packageJson.scripts).not.toHaveProperty('prod:worker');
  });

  it('uses maintained, artifact-compatible production dependencies', () => {
    expect(packageJson.dependencies).toHaveProperty('connect-mongo');
    expect(packageJson.dependencies).not.toHaveProperty(
      'connect-mongodb-session'
    );
    expect(packageJson.dependencies).not.toHaveProperty(
      '@prisma/client-runtime-utils'
    );
    expect(packageJson.dependencies['ua-parser-js']).toMatch(/^\^1\./);
  });

  it('pins patched transitive dependency floors', () => {
    const workspace = readFileSync(
      `${repositoryRoot}pnpm-workspace.yaml`,
      'utf8'
    );

    expect(workspace).toContain("fast-uri: '>=3.1.5 <4'");
    expect(workspace).toContain("ip-address: '>=10.3.1'");
    expect(workspace).not.toContain('ua-parser-js@2.0.10');
  });

  it('excludes local planning and generated test output from accidental packs', () => {
    const npmIgnore = readFileSync(`${repositoryRoot}.npmignore`, 'utf8');

    for (const path of [
      'dont-git/',
      'coverage/',
      'playwright-report/',
      'test-results/',
    ]) {
      expect(npmIgnore).toContain(path);
    }
  });
});
