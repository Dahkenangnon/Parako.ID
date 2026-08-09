import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import {
  listRepositoryFiles,
  writeProductionArtifactManifest,
} from './production-artifact-manifest.ts';

const repositoryRoot = process.cwd();
const configuredOutput = process.env.PARAKO_PRODUCTION_MANIFEST_OUTPUT;

if (!configuredOutput) {
  throw new Error('PARAKO_PRODUCTION_MANIFEST_OUTPUT is required');
}

const outputPath = resolve(repositoryRoot, configuredOutput);
mkdirSync(dirname(outputPath), { recursive: true });
writeProductionArtifactManifest(
  listRepositoryFiles(repositoryRoot),
  outputPath
);
