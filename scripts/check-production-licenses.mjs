#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const STRONG_COPYLEFT = /(?:^|[^A-Z])(?:AGPL|GPL)(?:[^A-Z]|$)/i;

export function findDisallowedLicenses(report) {
  const violations = [];

  for (const [license, packages] of Object.entries(report)) {
    if (
      license !== 'Unknown' &&
      license !== 'NOASSERTION' &&
      !STRONG_COPYLEFT.test(license)
    ) {
      continue;
    }

    for (const package_ of packages) {
      violations.push({
        license,
        name: package_.name,
        versions: package_.versions ?? [],
      });
    }
  }

  return violations.sort(
    (left, right) =>
      left.license.localeCompare(right.license) ||
      left.name.localeCompare(right.name)
  );
}

export function readProductionLicenseReport(directory = process.cwd()) {
  const output = execFileSync(
    'pnpm',
    ['licenses', 'list', '--prod', '--json'],
    {
      cwd: directory,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    }
  );
  const jsonStart = output.indexOf('{');
  if (jsonStart === -1) {
    throw new Error('pnpm did not return a JSON production-license report');
  }
  return JSON.parse(output.slice(jsonStart));
}

export function main(directory = process.argv[2] ?? process.cwd()) {
  const violations = findDisallowedLicenses(
    readProductionLicenseReport(directory)
  );
  if (violations.length === 0) {
    console.log('Production dependency license policy passed');
    return 0;
  }

  console.error('Production dependency license policy failed:');
  for (const violation of violations) {
    console.error(
      `- ${violation.name}@${violation.versions.join(',')} (${violation.license})`
    );
  }
  return 1;
}

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectExecution) {
  process.exitCode = main();
}
