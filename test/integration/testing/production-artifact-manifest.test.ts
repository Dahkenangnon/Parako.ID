import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  createProductionArtifactManifest,
  listRepositoryFiles,
  renderProductionArtifactManifest,
} from '../../../scripts/testing/production-artifact-manifest.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

describe('repository production artifact manifest', () => {
  it('has no unclassified tracked production artifacts', () => {
    expect(
      createProductionArtifactManifest(listRepositoryFiles(repositoryRoot))
        .unclassified
    ).toEqual([]);
  });

  it('generates the manifest through a hermetic CLI entry point', async () => {
    const temporaryDirectory = mkdtempSync(
      join(tmpdir(), 'parako-production-manifest-')
    );
    const outputPath = join(temporaryDirectory, 'production-artifacts.json');
    const previousOutput = process.env.PARAKO_PRODUCTION_MANIFEST_OUTPUT;

    try {
      process.env.PARAKO_PRODUCTION_MANIFEST_OUTPUT = outputPath;
      // A cache-busting query executes the CLI entry point for each scenario;
      // the production module itself remains a normal static import elsewhere.
      const entryPoint = pathToFileURL(
        resolve(
          repositoryRoot,
          'scripts/testing/generate-production-artifact-manifest.mjs'
        )
      );
      entryPoint.searchParams.set('test', String(Date.now()));

      await import(entryPoint.href);

      expect(readFileSync(outputPath, 'utf8')).toBe(
        renderProductionArtifactManifest(listRepositoryFiles(repositoryRoot))
      );
    } finally {
      if (previousOutput === undefined) {
        delete process.env.PARAKO_PRODUCTION_MANIFEST_OUTPUT;
      } else {
        process.env.PARAKO_PRODUCTION_MANIFEST_OUTPUT = previousOutput;
      }
      rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects CLI execution without an explicit output path', async () => {
    const previousOutput = process.env.PARAKO_PRODUCTION_MANIFEST_OUTPUT;

    try {
      delete process.env.PARAKO_PRODUCTION_MANIFEST_OUTPUT;
      const entryPoint = pathToFileURL(
        resolve(
          repositoryRoot,
          'scripts/testing/generate-production-artifact-manifest.mjs'
        )
      );
      entryPoint.searchParams.set('missing-output', String(Date.now()));

      await expect(import(entryPoint.href)).rejects.toThrow(
        'PARAKO_PRODUCTION_MANIFEST_OUTPUT is required'
      );
    } finally {
      if (previousOutput === undefined) {
        delete process.env.PARAKO_PRODUCTION_MANIFEST_OUTPUT;
      } else {
        process.env.PARAKO_PRODUCTION_MANIFEST_OUTPUT = previousOutput;
      }
    }
  });
});
