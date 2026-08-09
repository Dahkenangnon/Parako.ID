#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

function dependencyDirectories(nodeModules) {
  if (!fs.existsSync(nodeModules)) return [];
  const directories = [];
  for (const entry of fs.readdirSync(nodeModules, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const target = path.join(nodeModules, entry.name);
    if (entry.name.startsWith('@')) {
      for (const scoped of fs.readdirSync(target, { withFileTypes: true })) {
        if (scoped.isDirectory() || scoped.isSymbolicLink()) {
          directories.push(path.join(target, scoped.name));
        }
      }
    } else if (entry.isDirectory() || entry.isSymbolicLink()) {
      directories.push(target);
    }
  }
  return directories.sort();
}

export function createSpdxSbom(releaseDir, sourceDateEpoch) {
  const rootPackage = JSON.parse(
    fs.readFileSync(path.join(releaseDir, 'package.json'), 'utf8')
  );
  const dependencies = dependencyDirectories(
    path.join(releaseDir, 'node_modules')
  ).flatMap((directory, index) => {
    try {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(directory, 'package.json'), 'utf8')
      );
      return [
        {
          SPDXID: `SPDXRef-Dependency-${index + 1}`,
          name: packageJson.name ?? path.basename(directory),
          versionInfo: packageJson.version ?? 'unknown',
          downloadLocation: 'NOASSERTION',
          filesAnalyzed: false,
          licenseConcluded: packageJson.license ?? 'NOASSERTION',
          licenseDeclared: packageJson.license ?? 'NOASSERTION',
          copyrightText: 'NOASSERTION',
        },
      ];
    } catch {
      return [];
    }
  });
  const created = new Date(Number(sourceDateEpoch) * 1000).toISOString();
  const rootId = 'SPDXRef-Package-Parako-ID';
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `parako-id-${rootPackage.version}`,
    documentNamespace: `https://parako.id/spdx/${rootPackage.version}/${sourceDateEpoch}`,
    creationInfo: {
      created,
      creators: ['Tool: Parako.ID release builder'],
    },
    packages: [
      {
        SPDXID: rootId,
        name: rootPackage.name,
        versionInfo: rootPackage.version,
        downloadLocation: 'NOASSERTION',
        filesAnalyzed: false,
        licenseConcluded: rootPackage.license ?? 'NOASSERTION',
        licenseDeclared: rootPackage.license ?? 'NOASSERTION',
        copyrightText: 'NOASSERTION',
      },
      ...dependencies,
    ],
    relationships: dependencies.map(dependency => ({
      spdxElementId: rootId,
      relationshipType: 'DEPENDS_ON',
      relatedSpdxElement: dependency.SPDXID,
    })),
  };
}

const isEntrypoint =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
export function main({
  argv = process.argv.slice(2),
  env = process.env,
  stdout = console.log,
  stderr = console.error,
} = {}) {
  const [releaseDirArg] = argv;
  if (!releaseDirArg || !env.SOURCE_DATE_EPOCH) {
    stderr(
      'Usage: SOURCE_DATE_EPOCH=<unix> node scripts/create-sbom.mjs <release-dir>'
    );
    return 2;
  }
  const releaseDir = path.resolve(releaseDirArg);
  const target = path.join(releaseDir, 'SBOM.spdx.json');
  fs.writeFileSync(
    target,
    `${JSON.stringify(
      createSpdxSbom(releaseDir, env.SOURCE_DATE_EPOCH),
      null,
      2
    )}\n`
  );
  stdout(target);
  return 0;
}

if (isEntrypoint) {
  process.exitCode = main();
}
