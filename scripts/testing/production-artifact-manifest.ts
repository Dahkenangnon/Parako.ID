import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';

export type ProductionArtifactKind =
  | 'asset'
  | 'configuration'
  | 'declaration'
  | 'installer'
  | 'locale'
  | 'migration'
  | 'schema'
  | 'script'
  | 'source'
  | 'template';
export type ProductionArtifactRisk = 'critical' | 'high' | 'low' | 'medium';

export interface ProductionArtifactClassification {
  kind: ProductionArtifactKind;
  owner: string;
  risk: ProductionArtifactRisk;
  requiredTests: string[];
}

export interface ProductionArtifact extends ProductionArtifactClassification {
  path: string;
  currentEvidence: string[];
}

export interface ProductionArtifactManifest {
  version: 1;
  artifacts: ProductionArtifact[];
  unclassified: string[];
}

export type RepositoryFileExecutor = (
  executable: string,
  arguments_: string[],
  options: { cwd: string; encoding: 'utf8' }
) => string;

export type ManifestWriter = (
  filePath: string,
  contents: string,
  encoding: 'utf8'
) => void;

const PRODUCTION_ROOTS = [
  'deployment/',
  'installer/',
  'prisma/',
  'public/',
  'runtime/locales/',
  'scripts/',
  'src/',
] as const;

function isProductionArtifactCandidate(filePath: string): boolean {
  if (
    filePath.endsWith('/.gitignore') ||
    filePath.endsWith('/.gitkeep') ||
    filePath.endsWith('/README.md') ||
    filePath.startsWith('installer/test/')
  ) {
    return false;
  }

  return PRODUCTION_ROOTS.some(root => filePath.startsWith(root));
}

export function classifyProductionArtifact(
  filePath: string
): ProductionArtifactClassification | undefined {
  if (filePath === 'src/app.ts') {
    return {
      kind: 'source',
      owner: 'core-runtime',
      risk: 'critical',
      requiredTests: ['unit', 'integration', 'e2e', 'coverage'],
    };
  }

  if (filePath.startsWith('src/views/') && filePath.endsWith('.njk')) {
    return {
      kind: 'template',
      owner: 'web-ui',
      risk: 'high',
      requiredTests: ['compile', 'render', 'e2e'],
    };
  }

  if (
    filePath.startsWith('scripts/') &&
    /\.(?:[cm]?js|ts|sh)$/.test(filePath)
  ) {
    return {
      kind: 'script',
      owner: 'build-release',
      risk: 'high',
      requiredTests: ['unit', 'integration', 'coverage'],
    };
  }

  if (filePath.startsWith('src/') && filePath.endsWith('.d.ts')) {
    return {
      kind: 'declaration',
      owner: 'core-runtime',
      risk: 'low',
      requiredTests: ['typecheck'],
    };
  }

  if (filePath.startsWith('src/assets/')) {
    return {
      kind: 'asset',
      owner: 'web-ui',
      risk: 'high',
      requiredTests: ['unit-browser', 'e2e', 'coverage'],
    };
  }

  if (filePath.startsWith('runtime/locales/') && filePath.endsWith('.json')) {
    return {
      kind: 'locale',
      owner: 'internationalization',
      risk: 'medium',
      requiredTests: ['schema', 'key-parity', 'interpolation', 'render'],
    };
  }

  if (filePath.startsWith('prisma/migrations/')) {
    return {
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
    };
  }

  if (filePath.startsWith('prisma/schema.') && filePath.endsWith('.prisma')) {
    return {
      kind: 'schema',
      owner: 'data-platform',
      risk: 'critical',
      requiredTests: [
        'generate',
        'fresh-install',
        'migration',
        'adapter-contract',
      ],
    };
  }

  if (filePath.startsWith('deployment/') && filePath.endsWith('.conf')) {
    return {
      kind: 'configuration',
      owner: 'deployment',
      risk: 'high',
      requiredTests: ['parse', 'schema', 'deployment-smoke'],
    };
  }

  if (filePath === 'runtime/ecosystem.config.cjs') {
    return {
      kind: 'configuration',
      owner: 'deployment',
      risk: 'critical',
      requiredTests: ['parse', 'schema', 'deployment-smoke'],
    };
  }

  if (/^prisma\.config(?:\.pg)?\.ts$/.test(filePath)) {
    return {
      kind: 'configuration',
      owner: 'data-platform',
      risk: 'critical',
      requiredTests: ['parse', 'schema', 'adapter-contract'],
    };
  }

  if (filePath === '.env.example') {
    return {
      kind: 'configuration',
      owner: 'deployment',
      risk: 'high',
      requiredTests: ['parse', 'schema', 'deployment-smoke'],
    };
  }

  if (/^parako(?:-rp)?\.(?:sample|example)\.jsonc?$/.test(filePath)) {
    return {
      kind: 'configuration',
      owner: 'core-runtime',
      risk: 'high',
      requiredTests: ['parse', 'schema', 'deployment-smoke'],
    };
  }

  if (
    filePath.startsWith('installer/') &&
    !filePath.startsWith('installer/test/') &&
    filePath.endsWith('.sh')
  ) {
    return {
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
    };
  }

  if (filePath === 'installer/index.html') {
    return {
      kind: 'installer',
      owner: 'deployment',
      risk: 'high',
      requiredTests: ['html-validate', 'browser-smoke', 'fresh-install'],
    };
  }

  if (
    filePath.startsWith('public/') &&
    !filePath.endsWith('/.gitignore') &&
    filePath !== 'public/.gitignore'
  ) {
    return {
      kind: 'asset',
      owner: 'web-ui',
      risk: 'medium',
      requiredTests: ['build-presence', 'http-mime', 'cache', 'csp', 'e2e'],
    };
  }

  if (filePath.startsWith('src/') && /\.(?:[cm]?js|ts)$/.test(filePath)) {
    return {
      kind: 'source',
      owner: 'core-runtime',
      risk: 'high',
      requiredTests: ['unit', 'integration', 'coverage'],
    };
  }

  return undefined;
}

export function createProductionArtifactManifest(
  filePaths: string[]
): ProductionArtifactManifest {
  const artifacts = filePaths
    .map((filePath): ProductionArtifact | undefined => {
      const classification = classifyProductionArtifact(filePath);
      if (!classification) return undefined;

      return {
        path: filePath,
        ...classification,
        currentEvidence: [],
      };
    })
    .filter((artifact): artifact is ProductionArtifact => Boolean(artifact))
    .sort((left, right) => left.path.localeCompare(right.path));
  const unclassified = filePaths
    .filter(
      filePath =>
        isProductionArtifactCandidate(filePath) &&
        classifyProductionArtifact(filePath) === undefined
    )
    .sort((left, right) => left.localeCompare(right));

  return {
    version: 1,
    artifacts,
    unclassified,
  };
}

export function listRepositoryFiles(
  repositoryRoot: string,
  execute: RepositoryFileExecutor = (executable, arguments_, options) =>
    execFileSync(executable, arguments_, options),
  fileExists: (filePath: string) => boolean = existsSync
): string[] {
  return (
    execute(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
      { cwd: repositoryRoot, encoding: 'utf8' }
    )
      .split('\0')
      .filter(Boolean)
      // `git ls-files --cached` includes tracked paths deleted in the working
      // tree until their removal is staged. Consumers inspect current files, so
      // exclude those stale index entries while preserving untracked additions.
      .filter(filePath => fileExists(`${repositoryRoot}/${filePath}`))
  );
}

export function renderProductionArtifactManifest(filePaths: string[]): string {
  return `${JSON.stringify(createProductionArtifactManifest(filePaths), null, 2)}\n`;
}

export function writeProductionArtifactManifest(
  filePaths: string[],
  outputPath: string,
  writeFile: ManifestWriter = (filePath, contents, encoding) =>
    writeFileSync(filePath, contents, encoding)
): void {
  writeFile(outputPath, renderProductionArtifactManifest(filePaths), 'utf8');
}
