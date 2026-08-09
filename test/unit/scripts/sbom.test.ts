import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSpdxSbom, main } from '../../../scripts/create-sbom.mjs';

const temporaryDirectories: string[] = [];

function fixture(packageJson: Record<string, unknown> = {}): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'parako-sbom-'));
  temporaryDirectories.push(root);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'parako.id', version: '1.2.3', ...packageJson })
  );
  return root;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('SPDX release SBOM', () => {
  it('records installed production dependencies deterministically', () => {
    const root = fixture({ license: 'MIT' });
    fs.mkdirSync(path.join(root, 'node_modules/example'), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'node_modules/example/package.json'),
      JSON.stringify({ name: 'example', version: '4.5.6', license: 'ISC' })
    );

    const sbom = createSpdxSbom(root, '1700000000');

    expect(sbom.spdxVersion).toBe('SPDX-2.3');
    expect(sbom.creationInfo.created).toBe('2023-11-14T22:13:20.000Z');
    expect(sbom.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'example',
          versionInfo: '4.5.6',
          licenseDeclared: 'ISC',
        }),
      ])
    );
    expect(sbom.relationships).toHaveLength(1);
  });

  it('handles absent dependencies and root license metadata', () => {
    const sbom = createSpdxSbom(fixture(), '1700000000');

    expect(sbom.packages).toEqual([
      expect.objectContaining({
        licenseConcluded: 'NOASSERTION',
        licenseDeclared: 'NOASSERTION',
      }),
    ]);
    expect(sbom.relationships).toEqual([]);
  });

  it('discovers scoped and linked packages while skipping invalid entries', () => {
    const root = fixture();
    const modules = path.join(root, 'node_modules');
    fs.mkdirSync(path.join(modules, '@scope/package'), { recursive: true });
    fs.writeFileSync(
      path.join(modules, '@scope/package/package.json'),
      JSON.stringify({})
    );
    fs.writeFileSync(path.join(modules, '@scope/not-a-package'), 'ignored');
    fs.mkdirSync(path.join(modules, 'invalid'), { recursive: true });
    fs.writeFileSync(path.join(modules, 'invalid/package.json'), '{invalid');
    fs.mkdirSync(path.join(modules, '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(modules, 'ordinary-file'), 'ignored');
    const linkedTarget = path.join(root, 'linked-target');
    fs.mkdirSync(linkedTarget);
    fs.writeFileSync(
      path.join(linkedTarget, 'package.json'),
      JSON.stringify({ name: 'linked', version: '2.0.0' })
    );
    fs.symlinkSync(linkedTarget, path.join(modules, 'linked'));

    const sbom = createSpdxSbom(root, '1700000000');

    expect(sbom.packages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'package',
          versionInfo: 'unknown',
          licenseDeclared: 'NOASSERTION',
        }),
        expect.objectContaining({ name: 'linked', versionInfo: '2.0.0' }),
      ])
    );
    expect(sbom.relationships).toHaveLength(2);
  });

  it.each([
    { argv: [], env: { SOURCE_DATE_EPOCH: '1700000000' } },
    { argv: ['/release'], env: {} },
  ])('returns usage exit code 2 for invalid CLI input %#', options => {
    const stderr = vi.fn();

    expect(main({ ...options, stderr })).toBe(2);
    expect(stderr).toHaveBeenCalledWith(
      'Usage: SOURCE_DATE_EPOCH=<unix> node scripts/create-sbom.mjs <release-dir>'
    );
  });

  it('writes the SBOM and returns zero for valid CLI input', () => {
    const root = fixture({ license: 'MIT' });
    const stdout = vi.fn();

    expect(
      main({
        argv: [root],
        env: { SOURCE_DATE_EPOCH: '1700000000' },
        stdout,
      })
    ).toBe(0);
    const target = path.join(root, 'SBOM.spdx.json');
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))).toMatchObject({
      spdxVersion: 'SPDX-2.3',
    });
    expect(stdout).toHaveBeenCalledWith(target);
  });

  it('runs the CLI when the module is invoked as the entrypoint', async () => {
    const root = fixture({ license: 'MIT' });
    const originalArgv = process.argv;
    const originalEpoch = process.env.SOURCE_DATE_EPOCH;
    const originalExitCode = process.exitCode;
    const stdout = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.argv = [
      process.execPath,
      path.resolve('scripts/create-sbom.mjs'),
      root,
    ];
    process.env.SOURCE_DATE_EPOCH = '1700000000';

    try {
      vi.resetModules();
      await import('../../../scripts/create-sbom.mjs');

      expect(process.exitCode).toBe(0);
      expect(stdout).toHaveBeenCalledWith(path.join(root, 'SBOM.spdx.json'));
    } finally {
      process.argv = originalArgv;
      process.exitCode = originalExitCode;
      if (originalEpoch === undefined) {
        delete process.env.SOURCE_DATE_EPOCH;
      } else {
        process.env.SOURCE_DATE_EPOCH = originalEpoch;
      }
    }
  });
});
