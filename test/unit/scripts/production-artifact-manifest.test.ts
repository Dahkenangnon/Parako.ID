import { describe, expect, it, vi } from 'vitest';

import packageJson from '../../../package.json' with { type: 'json' };
import {
  classifyProductionArtifact,
  createProductionArtifactManifest,
  listRepositoryFiles,
  renderProductionArtifactManifest,
  writeProductionArtifactManifest,
} from '../../../scripts/testing/production-artifact-manifest.js';

describe('production artifact manifest', () => {
  it('classifies the application entry point as critical runtime source', () => {
    expect(classifyProductionArtifact('src/app.ts')).toEqual({
      kind: 'source',
      owner: 'core-runtime',
      risk: 'critical',
      requiredTests: ['unit', 'integration', 'e2e', 'coverage'],
    });
  });

  it('classifies Nunjucks views with compile, render, and browser proofs', () => {
    expect(classifyProductionArtifact('src/views/auth/login.njk')).toEqual({
      kind: 'template',
      owner: 'web-ui',
      risk: 'high',
      requiredTests: ['compile', 'render', 'e2e'],
    });
  });

  it('classifies executable repository scripts with automated proofs', () => {
    expect(classifyProductionArtifact('scripts/build.js')).toEqual({
      kind: 'script',
      owner: 'build-release',
      risk: 'high',
      requiredTests: ['unit', 'integration', 'coverage'],
    });
  });

  it('classifies application modules as high-risk runtime source', () => {
    expect(classifyProductionArtifact('src/services/user.service.ts')).toEqual({
      kind: 'source',
      owner: 'core-runtime',
      risk: 'high',
      requiredTests: ['unit', 'integration', 'coverage'],
    });
  });

  it('classifies declaration-only source with typecheck proof', () => {
    expect(classifyProductionArtifact('src/types/mongoose.d.ts')).toEqual({
      kind: 'declaration',
      owner: 'core-runtime',
      risk: 'low',
      requiredTests: ['typecheck'],
    });
  });

  it('classifies browser code separately from server runtime source', () => {
    expect(classifyProductionArtifact('src/assets/js/auth/login.ts')).toEqual({
      kind: 'asset',
      owner: 'web-ui',
      risk: 'high',
      requiredTests: ['unit-browser', 'e2e', 'coverage'],
    });
  });

  it('classifies locale catalogs with parity and rendering proofs', () => {
    expect(classifyProductionArtifact('runtime/locales/auth/fr.json')).toEqual({
      kind: 'locale',
      owner: 'internationalization',
      risk: 'medium',
      requiredTests: ['schema', 'key-parity', 'interpolation', 'render'],
    });
  });

  it('classifies database migrations as critical adapter artifacts', () => {
    expect(
      classifyProductionArtifact(
        'prisma/migrations/sqlite/20260714000000_baseline/migration.sql'
      )
    ).toEqual({
      kind: 'migration',
      owner: 'data-platform',
      risk: 'critical',
      requiredTests: [
        'fresh-install',
        'upgrade',
        'recovery',
        'data-validation',
        'adapter-contract',
      ],
    });
  });

  it('classifies Prisma schemas with generation and adapter proofs', () => {
    expect(classifyProductionArtifact('prisma/schema.sqlite.prisma')).toEqual({
      kind: 'schema',
      owner: 'data-platform',
      risk: 'critical',
      requiredTests: [
        'generate',
        'fresh-install',
        'migration',
        'adapter-contract',
      ],
    });
  });

  it('classifies deployment configuration with parse and smoke proofs', () => {
    expect(classifyProductionArtifact('deployment/nginx.conf')).toEqual({
      kind: 'configuration',
      owner: 'deployment',
      risk: 'high',
      requiredTests: ['parse', 'schema', 'deployment-smoke'],
    });
  });

  it('classifies Prisma generator configuration per adapter', () => {
    expect(classifyProductionArtifact('prisma.config.ts')).toEqual({
      kind: 'configuration',
      owner: 'data-platform',
      risk: 'critical',
      requiredTests: ['parse', 'schema', 'adapter-contract'],
    });
  });

  it('classifies deployable environment examples as configuration', () => {
    expect(classifyProductionArtifact('.env.example')).toEqual({
      kind: 'configuration',
      owner: 'deployment',
      risk: 'high',
      requiredTests: ['parse', 'schema', 'deployment-smoke'],
    });
  });

  it('classifies Parako sample files as runtime configuration', () => {
    expect(classifyProductionArtifact('parako.sample.jsonc')).toEqual({
      kind: 'configuration',
      owner: 'core-runtime',
      risk: 'high',
      requiredTests: ['parse', 'schema', 'deployment-smoke'],
    });
  });

  it('classifies installer entry points as critical lifecycle artifacts', () => {
    expect(classifyProductionArtifact('installer/install.sh')).toEqual({
      kind: 'installer',
      owner: 'deployment',
      risk: 'critical',
      requiredTests: [
        'shellcheck',
        'bats',
        'fresh-install',
        'upgrade',
        'uninstall',
      ],
    });
  });

  it('classifies the installer UI with browser and installation proofs', () => {
    expect(classifyProductionArtifact('installer/index.html')).toEqual({
      kind: 'installer',
      owner: 'deployment',
      risk: 'high',
      requiredTests: ['html-validate', 'browser-smoke', 'fresh-install'],
    });
  });

  it('classifies published static files with delivery-security proofs', () => {
    expect(classifyProductionArtifact('public/css/theme.css')).toEqual({
      kind: 'asset',
      owner: 'web-ui',
      risk: 'medium',
      requiredTests: ['build-presence', 'http-mime', 'cache', 'csp', 'e2e'],
    });
  });

  it('creates a sorted manifest with explicit current evidence', () => {
    expect(
      createProductionArtifactManifest([
        'src/services/user.service.ts',
        'README.md',
        'src/app.ts',
      ])
    ).toEqual({
      version: 1,
      artifacts: [
        {
          path: 'src/app.ts',
          kind: 'source',
          owner: 'core-runtime',
          risk: 'critical',
          requiredTests: ['unit', 'integration', 'e2e', 'coverage'],
          currentEvidence: [],
        },
        {
          path: 'src/services/user.service.ts',
          kind: 'source',
          owner: 'core-runtime',
          risk: 'high',
          requiredTests: ['unit', 'integration', 'coverage'],
          currentEvidence: [],
        },
      ],
      unclassified: [],
    });
  });

  it('reports unknown files inside production roots as unclassified', () => {
    expect(
      createProductionArtifactManifest(['src/unknown.runtime', 'README.md'])
    ).toEqual({
      version: 1,
      artifacts: [],
      unclassified: ['src/unknown.runtime'],
    });
  });

  it('detects unknown artifacts across every production root', () => {
    const manifest = createProductionArtifactManifest([
      'scripts/unknown.py',
      'prisma/unknown.yml',
      'runtime/locales/unknown.po',
      'deployment/unknown.cfg',
      'installer/unknown.bin',
      'deployment/README.md',
      'installer/README.md',
      'installer/test/smoke.bats',
      'public/.gitignore',
      'runtime/.gitkeep',
    ]);

    expect(manifest.unclassified).toEqual([
      'deployment/unknown.cfg',
      'installer/unknown.bin',
      'prisma/unknown.yml',
      'runtime/locales/unknown.po',
      'scripts/unknown.py',
    ]);
  });

  it('lists tracked and untracked non-ignored repository files', () => {
    const execute = vi.fn(() => 'src/app.ts\0scripts/build.js\0');
    const fileExists = vi.fn(() => true);

    expect(listRepositoryFiles('/repo', execute, fileExists)).toEqual([
      'src/app.ts',
      'scripts/build.js',
    ]);
    expect(execute).toHaveBeenCalledWith(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: '/repo', encoding: 'utf8' }
    );
    expect(fileExists).toHaveBeenCalledWith('/repo/src/app.ts');
    expect(fileExists).toHaveBeenCalledWith('/repo/scripts/build.js');
  });

  it('excludes tracked paths deleted from the current working tree', () => {
    const execute = vi.fn(
      () =>
        'test/integrations/removed.test.ts\0test/integration/current.test.ts\0'
    );
    const fileExists = vi.fn((filePath: string) =>
      filePath.endsWith('/test/integration/current.test.ts')
    );

    expect(listRepositoryFiles('/repo', execute, fileExists)).toEqual([
      'test/integration/current.test.ts',
    ]);
  });

  it('serializes a deterministic newline-terminated manifest', () => {
    const rendered = renderProductionArtifactManifest([
      'src/services/user.service.ts',
      'src/app.ts',
    ]);

    expect(rendered.endsWith('\n')).toBe(true);
    expect(JSON.parse(rendered)).toEqual(
      createProductionArtifactManifest([
        'src/services/user.service.ts',
        'src/app.ts',
      ])
    );
  });

  it('writes the rendered manifest through an injectable file boundary', () => {
    const writeFile = vi.fn();

    writeProductionArtifactManifest(
      ['src/app.ts'],
      '/repo/test/coverage/production-artifacts.json',
      writeFile
    );

    expect(writeFile).toHaveBeenCalledWith(
      '/repo/test/coverage/production-artifacts.json',
      renderProductionArtifactManifest(['src/app.ts']),
      'utf8'
    );
  });

  it('does not couple repository verification to a generated manifest file', () => {
    expect(Object.hasOwn(packageJson.scripts, 'test:manifest:update')).toBe(
      false
    );
  });
});
