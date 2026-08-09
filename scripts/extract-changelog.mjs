#!/usr/bin/env node
/**
 * Extracts the section body for a given version from CHANGELOG.md and
 * prints it to stdout. Used by .github/workflows/release.yml to populate
 * the GitHub Release body via softprops/action-gh-release.
 *
 *   Usage:  node scripts/extract-changelog.mjs <version>
 *
 * Exit codes:
 *   0  success (stdout has the body, trailing newline)
 *   1  no matching section found for the version
 *   2  invalid arguments
 */

import { existsSync, readFileSync } from 'node:fs';

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Returns the body under `## [<version>] ...` up to (but excluding) the
 * next `## [` heading. Returns null when the version heading is absent.
 * The heading line itself is not included; surrounding blank lines are
 * trimmed.
 */
export function extractSectionFromText(src, version) {
  const lines = src.split('\n');
  const startRe = new RegExp(`^## \\[${escapeRegExp(version)}\\]`);
  const nextRe = /^## \[/;
  const start = lines.findIndex(l => startRe.test(l));
  if (start === -1) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (nextRe.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines
    .slice(start + 1, end)
    .join('\n')
    .trim();
}

/**
 * Filesystem-backed wrapper. Returns null when the file is missing or
 * no matching section exists.
 */
export function extractSection(path, version) {
  if (!existsSync(path)) return null;
  return extractSectionFromText(readFileSync(path, 'utf8'), version);
}

/**
 * @param {{
 *   argv?: string[],
 *   changelogPath?: string,
 *   stdout?: { write(chunk: string): unknown },
 *   stderr?: { write(chunk: string): unknown }
 * }} [options]
 */
export function main({
  argv = process.argv.slice(2),
  changelogPath = 'CHANGELOG.md',
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const version = argv[0];
  if (!version) {
    stderr.write('Usage: extract-changelog.mjs <version>\n');
    return 2;
  }
  const body = extractSection(changelogPath, version);
  if (body === null) {
    stderr.write(`No section [${version}] in CHANGELOG.md\n`);
    return 1;
  }
  stdout.write(`${body}\n`);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = main();
}
