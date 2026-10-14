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
    expect(packageJson.scripts.security).toBe(
      'node dist/scripts/manage/security.js'
    );
  });

  it('uses maintained, artifact-compatible production dependencies', () => {
    expect(packageJson.dependencies).toHaveProperty('connect-mongo');
    expect(packageJson.dependencies).not.toHaveProperty(
      'connect-mongodb-session'
    );
    expect(packageJson.dependencies['@prisma/client-runtime-utils']).toBe(
      packageJson.dependencies['@prisma/client']
    );
    expect(packageJson.dependencies['ua-parser-js']).toMatch(/^\^1\./);
  });

  it('pins patched transitive dependency floors', () => {
    const workspace = readFileSync(
      `${repositoryRoot}pnpm-workspace.yaml`,
      'utf8'
    );

    for (const override of [
      "'@parcel/watcher': '>=2.6.0 <3'",
      "'@xhmikosr/decompress': '>=10.2.2 <11'",
      "axios: '>=1.20.0 <2'",
      "fast-uri: '>=3.1.8 <4'",
      "ip-address: '>=10.7.1 <11'",
      "piscina: '>=4.9.4 <5'",
      "proxy-addr: '>=2.0.8 <3'",
      "source-map-js: '>=1.2.2 <2'",
    ]) {
      expect(workspace).toContain(override);
    }
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
