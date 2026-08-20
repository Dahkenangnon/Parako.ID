import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const RELEASE_WORKFLOW = readFileSync(
  new URL('../../../.github/workflows/release.yml', import.meta.url),
  'utf8'
);
const INSTALLER_WORKFLOW = readFileSync(
  new URL('../../../.github/workflows/installer-ci.yml', import.meta.url),
  'utf8'
);
const CODEQL_WORKFLOW = readFileSync(
  new URL('../../../.github/workflows/codeql.yml', import.meta.url),
  'utf8'
);
const PACKAGE_SCRIPTS = (
  JSON.parse(
    readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
  ) as { scripts: Record<string, string> }
).scripts;

function readJob(workflow: string, jobId: string): string {
  const marker = `  ${jobId}:\n`;
  const start = workflow.indexOf(marker);
  if (start < 0) throw new Error(`Unable to find CI job: ${jobId}`);

  const remaining = workflow.slice(start + marker.length);
  const nextJob = remaining.search(/^  [a-z][a-z0-9-]+:\n/m);
  return marker + (nextJob < 0 ? remaining : remaining.slice(0, nextJob));
}

function expectEveryActionStepToHaveAName(workflow: string): void {
  expect(workflow).not.toMatch(/^\s+- (?:run|uses):/mu);

  const lines = workflow.split('\n');

  for (const [index, line] of lines.entries()) {
    if (!/^\s+uses: /.test(line)) continue;

    const usesIndent = line.search(/\S/u);
    const stepPrefix = `${' '.repeat(usesIndent - 2)}- `;
    let stepStart = index - 1;
    while (stepStart >= 0 && !lines[stepStart]?.startsWith(stepPrefix)) {
      stepStart -= 1;
    }

    expect(
      lines[stepStart],
      `unnamed action step at line ${index + 1}`
    ).toMatch(/^\s+- name: /u);
  }
}

describe('GitHub Actions workflow policy', () => {
  it('splits CI policy, quality, typecheck, test, integration, build, and E2E concerns', () => {
    const jobs = [
      'commit-policy',
      'dependency-policy',
      'source-quality',
      'typecheck',
      'unit-tests',
      'contract-tests',
      'integration-persistence',
      'integration-oidc',
      'integration-application',
      'coverage',
      'integration-postgresql',
      'production-build',
      'e2e-infrastructure',
      'e2e-browser-matrix',
    ];

    for (const job of jobs) expect(RELEASE_WORKFLOW).toContain(`  ${job}:\n`);
    expect(RELEASE_WORKFLOW).not.toContain('  ci:\n');
    expect(RELEASE_WORKFLOW).not.toContain('  adapter-matrix:\n');
  });

  it('runs each test layer and the cumulative coverage policy independently', () => {
    const scripts = {
      'unit-tests': 'pnpm run test:unit',
      'contract-tests': 'pnpm run test:contract',
      'integration-persistence': 'pnpm run test:integration:persistence',
      'integration-oidc': 'pnpm run test:integration:oidc',
      'integration-application': 'pnpm run test:integration:application',
      coverage: 'pnpm run test:coverage',
      'integration-postgresql': 'pnpm run test:integration:postgresql',
    } as const;

    for (const [jobId, script] of Object.entries(scripts)) {
      expect(readJob(RELEASE_WORKFLOW, jobId)).toContain(script);
    }

    expect(RELEASE_WORKFLOW).not.toContain('pnpm run test:run');
    expect(RELEASE_WORKFLOW).not.toContain('VITEST_COVERAGE_FRAGMENT');
    expect(RELEASE_WORKFLOW).not.toContain('coverage-fragment-');
  });

  it('provides deterministic external fixtures and preserves the encryption key as text', () => {
    const applicationIntegration = readJob(
      RELEASE_WORKFLOW,
      'integration-application'
    );
    const coverage = readJob(RELEASE_WORKFLOW, 'coverage');

    for (const job of [applicationIntegration, coverage]) {
      expect(job).toContain('image: mongo:8');
      expect(job).toContain('image: redis:7-alpine');
      expect(job).toContain('CONTRACT_MONGODB_URI: mongodb://127.0.0.1:27017/');
    }

    const encryptionKeyDeclarations = RELEASE_WORKFLOW.match(
      /^\s*ENCRYPTION_KEY:.*$/gmu
    );
    expect(encryptionKeyDeclarations).not.toBeNull();
    for (const declaration of encryptionKeyDeclarations ?? []) {
      expect(declaration).toMatch(/ENCRYPTION_KEY: '[0-9a-f]{64}'$/u);
    }
    expect(PACKAGE_SCRIPTS['test:coverage']).toContain('pnpm run build');
  });

  it('assigns every non-PostgreSQL integration directory to exactly one CI shard script', () => {
    const integrationScripts = [
      'test:integration:persistence',
      'test:integration:oidc',
      'test:integration:application',
    ].map(scriptName => PACKAGE_SCRIPTS[scriptName] ?? '');
    const integrationDirectories = readdirSync(
      new URL('../../integration', import.meta.url),
      { withFileTypes: true }
    )
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);

    for (const directory of integrationDirectories) {
      const testPath = `test/integration/${directory}`;
      const owners = integrationScripts.filter(script =>
        script.split(/\s+/u).includes(testPath)
      );
      expect(owners, testPath).toHaveLength(1);
    }
  });

  it('requires every independently diagnosable gate before release artifacts are built', () => {
    const releaseBuild = readJob(RELEASE_WORKFLOW, 'release-build');
    const requiredJobs = [
      'commit-policy',
      'dependency-policy',
      'source-quality',
      'typecheck',
      'unit-tests',
      'contract-tests',
      'integration-persistence',
      'integration-oidc',
      'integration-application',
      'coverage',
      'integration-postgresql',
      'production-build',
      'e2e-infrastructure',
      'e2e-browser-matrix',
    ];

    for (const job of requiredJobs) {
      expect(releaseBuild).toContain(`      - ${job}\n`);
    }
  });

  it('runs expensive browser E2E jobs only after the independent preflight gates pass', () => {
    const requiredJobs = [
      'commit-policy',
      'dependency-policy',
      'source-quality',
      'typecheck',
      'unit-tests',
      'contract-tests',
      'integration-persistence',
      'integration-oidc',
      'integration-application',
      'coverage',
      'integration-postgresql',
      'production-build',
    ];

    for (const jobId of ['e2e-infrastructure', 'e2e-browser-matrix']) {
      const job = readJob(RELEASE_WORKFLOW, jobId);
      for (const requiredJob of requiredJobs) {
        expect(job).toContain(`      - ${requiredJob}\n`);
      }
    }
  });

  it('splits installer quality, contract, operator, topology, fixture, and OS checks', () => {
    const jobs = [
      'shell-quality',
      'installer-contract',
      'native-operator-tests',
      'docker-operator-tests',
      'docker-topology-smoke',
      'git-source-tests',
      'release-fixture',
      'os-install-smoke',
    ];

    for (const job of jobs) expect(INSTALLER_WORKFLOW).toContain(`  ${job}:\n`);
    expect(INSTALLER_WORKFLOW).not.toContain('  lint:\n');
  });

  it('gives every workflow, job, and action step a diagnostic name', () => {
    expect(RELEASE_WORKFLOW).toContain('run-name: CI and release');
    expect(INSTALLER_WORKFLOW).toContain('run-name: Installer and operator CI');
    expect(CODEQL_WORKFLOW).toContain('run-name: CodeQL security analysis');

    for (const workflow of [
      RELEASE_WORKFLOW,
      INSTALLER_WORKFLOW,
      CODEQL_WORKFLOW,
    ]) {
      expectEveryActionStepToHaveAName(workflow);
      expect(workflow).not.toMatch(/^  [a-z][a-z0-9-]+:\n    runs-on:/mu);
    }
  });
});
