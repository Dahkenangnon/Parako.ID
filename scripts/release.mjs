#!/usr/bin/env node
/**
 * Release helper — bumps the root package.json version, stamps a new
 * dated section into CHANGELOG.md from the git log, synchronizes the
 * packaged operator helper version, commits the generated changes, and
 * optionally pushes that preparation commit for review.
 *
 * This script never tags or publishes. After the release commit is reviewed,
 * merged to protected main, and all gates pass, `pnpm release:tag -- vX.Y.Z
 * --push` performs the guarded immutable-tag operation. Only that tag push
 * starts .github/workflows/release.yml publication.
 *
 *   Usage:  pnpm release <patch|minor|major> [--no-push]
 *
 * Pass `--no-push` to keep the chore(release) commit local for review
 * (useful for hand-trimming the CHANGELOG section before pushing).
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * @typedef {(file: string, args: string[], options?: Record<string, unknown>) =>
 *   string | Buffer | null | undefined} CommandExecutor
 * @typedef {(path: string, encoding: 'utf8') => string} TextFileReader
 * @typedef {(path: string, contents: string) => void} TextFileWriter
 * @typedef {{ write(chunk: string): unknown }} TextWriter
 * @typedef {{ exitCode?: number }} ExitCodeTarget
 */

export const REMOTE = 'https://github.com/Dahkenangnon/Parako.ID';

const TYPE_TO_HEADING = {
  feat: '### Features',
  fix: '### Bug Fixes',
  perf: '### Performance',
  refactor: '### Refactor',
};

const HEADING_ORDER = [
  '### Features',
  '### Bug Fixes',
  '### Performance',
  '### Refactor',
];

const SUBJECT_RE =
  /^(feat|fix|perf|refactor|test|docs|build|ci|chore|style|revert)(\([^)]+\))?(!?):\s+(.+)$/;

/**
 * Parses a Conventional Commit subject. Returns null when the subject
 * does not match the conventional shape.
 */
export function parseSubject(subject) {
  const match = subject.match(SUBJECT_RE);
  if (!match) return null;
  return {
    type: match[1],
    scope: match[2] ? match[2].slice(1, -1) : null,
    breaking: match[3] === '!',
    description: match[4],
  };
}

/**
 * Returns the most recent annotated tag matching `<prefix>*.*.*` that
 * is an ancestor of HEAD, or empty string when no such tag exists.
 */
/** @param {string} prefix @param {CommandExecutor} [execute] */
export function previousTagFor(prefix, execute = execFileSync) {
  try {
    return String(
      execute(
        'git',
        ['describe', '--tags', `--match=${prefix}*.*.*`, '--abbrev=0', 'HEAD'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
      ) ?? ''
    ).trim();
  } catch {
    return '';
  }
}

/**
 * Renders the changelog body for the commit range `<fromRef>..HEAD`.
 * Bullets are grouped under `### Features` / `### Bug Fixes` /
 * `### Performance` / `### Refactor` in that order. Subjects whose type
 * is not in that allow-list are dropped from the rendered body
 * (chore / docs / ci / test / style / build / revert remain visible in
 * the git history but stay out of the changelog by design).
 */
/** @param {string} fromRef @param {CommandExecutor} [execute] */
export function generateBody(fromRef, execute = execFileSync) {
  const range = fromRef ? `${fromRef}..HEAD` : 'HEAD';
  const out = String(
    execute('git', ['log', '--no-merges', '--pretty=format:%H%x09%s', range], {
      encoding: 'utf8',
    }) ?? ''
  )
    .split('\n')
    .filter(line => line.length > 0);

  const grouped = {};
  for (const line of out) {
    const sep = line.indexOf('\t');
    if (sep < 0) continue;
    const sha = line.slice(0, sep);
    const subject = line.slice(sep + 1);
    const parsed = parseSubject(subject);
    if (parsed === null) continue;
    const heading = TYPE_TO_HEADING[parsed.type];
    if (!heading) continue;
    const bullet = `* ${parsed.description} ([${sha.slice(0, 7)}](${REMOTE}/commit/${sha}))`;
    (grouped[heading] ||= []).push(bullet);
  }

  const sections = [];
  for (const heading of HEADING_ORDER) {
    const lines = grouped[heading];
    if (!lines || lines.length === 0) continue;
    sections.push(`${heading}\n\n${lines.join('\n')}`);
  }
  return sections.join('\n\n');
}

/**
 * Inserts a new `## [<version>] - <YYYY-MM-DD>` section above the
 * `## [Unreleased]` marker. When `body` is empty, the section receives
 * a placeholder so the file remains valid Keep-a-Changelog markdown.
 * Returns the resulting CHANGELOG text. Returns the input unchanged
 * when no `## [Unreleased]` marker is present.
 */
export function stampChangelog(src, version, body) {
  const marker = '## [Unreleased]';
  if (!src.includes(marker)) return src;
  const date = new Date().toISOString().slice(0, 10);
  const block = body
    ? `## [Unreleased]\n\n## [${version}] - ${date}\n\n${body}\n`
    : `## [Unreleased]\n\n## [${version}] - ${date}\n\n_No user-visible changes — see git history for the maintenance commits in this release._\n`;
  return src.replace(marker, block);
}

const OPERATOR_VERSION_RE = /^PARAKO_VERSION="[^"]+"$/m;
const RELEASE_FILES = ['package.json', 'CHANGELOG.md', 'installer/parako.sh'];

export function stampOperatorVersion(src, version) {
  if (!OPERATOR_VERSION_RE.test(src)) {
    throw new Error(
      'installer/parako.sh has no PARAKO_VERSION marker to synchronize'
    );
  }

  return src.replace(OPERATOR_VERSION_RE, `PARAKO_VERSION="${version}"`);
}

/** @param {string} file @param {string[]} args @param {CommandExecutor} [execute] */
function runInherit(file, args, execute = execFileSync) {
  execute(file, args, { stdio: 'inherit' });
}

/** @param {string} file @param {string[]} args @param {CommandExecutor} [execute] */
function runSilent(file, args, execute = execFileSync) {
  execute(file, args, { stdio: 'ignore' });
}

/** @param {CommandExecutor} [execute] */
function isDirty(execute = execFileSync) {
  return (
    String(
      execute('git', ['status', '--porcelain'], { encoding: 'utf8' })
    ).trim().length > 0
  );
}

/** @param {string} dir @param {TextFileReader} [readFile] */
function readVersion(dir, readFile = readFileSync) {
  return JSON.parse(readFile(resolve(dir, 'package.json'), 'utf8')).version;
}

/** @param {CommandExecutor} [execute] */
function currentBranch(execute = execFileSync) {
  return String(
    execute('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
    }) ?? ''
  ).trim();
}

/** @param {CommandExecutor} [execute] */
export function resetGeneratedReleaseFiles(execute = execFileSync) {
  try {
    runSilent('git', ['restore', '--staged', ...RELEASE_FILES], execute);
  } catch {
    // Ignore cleanup errors so the original release failure remains visible.
  }

  try {
    runSilent('git', ['restore', ...RELEASE_FILES], execute);
  } catch {
    // Ignore cleanup errors so the original release failure remains visible.
  }
}

export class ReleasePreparationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleasePreparationError';
  }
}

/**
 * @param {{
 *   argv?: string[];
 *   execute?: CommandExecutor;
 *   readFile?: TextFileReader;
 *   writeFile?: TextFileWriter;
 *   stdout?: TextWriter;
 *   stderr?: TextWriter;
 * }} [dependencies]
 */
export function main({
  argv = process.argv.slice(2),
  execute = execFileSync,
  readFile = readFileSync,
  writeFile = writeFileSync,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const args = argv;
  const bump = args.find(a => !a.startsWith('-'));
  const noPush = args.includes('--no-push');
  const valid = ['patch', 'minor', 'major'];
  if (!valid.includes(bump)) {
    throw new ReleasePreparationError(
      `Usage: pnpm release <${valid.join('|')}> [--no-push]`
    );
  }

  if (isDirty(execute)) {
    throw new ReleasePreparationError(
      'Working tree is dirty. Commit or stash changes before running pnpm release.'
    );
  }

  const prevTag = previousTagFor('v', execute);

  let version;
  try {
    runInherit('npm', ['version', bump, '--no-git-tag-version'], execute);

    version = readVersion('.', readFile);
    const body = generateBody(prevTag, execute);
    const src = readFile('CHANGELOG.md', 'utf8');
    const stamped = stampChangelog(src, version, body);
    writeFile('CHANGELOG.md', stamped);
    const operatorPath = resolve('installer/parako.sh');
    const operatorSrc = readFile(operatorPath, 'utf8');
    writeFile(operatorPath, stampOperatorVersion(operatorSrc, version));

    runInherit(
      'npx',
      ['prettier', '--write', 'package.json', 'CHANGELOG.md'],
      execute
    );
    runInherit('git', ['add', ...RELEASE_FILES], execute);
    runInherit('git', ['commit', '-m', `chore(release): v${version}`], execute);
  } catch (error) {
    resetGeneratedReleaseFiles(execute);
    stderr.write(
      '\nRelease commit failed. Generated release files were reset so you can rerun the release command after fixing the reported issue.\n'
    );
    throw error;
  }

  if (noPush) {
    stdout.write(
      `\nCommitted chore(release): v${version} locally (no push).\n` +
        `  Review: git show HEAD\n` +
        `  Push:   git push origin ${currentBranch(execute)}\n` +
        `\nThis commit does not publish. Merge it through review, then use the guarded release:tag helper on main.\n`
    );
    return 0;
  }

  const branch = currentBranch(execute);
  stdout.write(`\nPushing chore(release): v${version} → origin/${branch}…\n`);
  runInherit('git', ['push', 'origin', branch], execute);
  stdout.write(
    `\nPushed the v${version} preparation commit for review. No tag or release was created.\n` +
      `After merge and protected checks, run: pnpm release:tag -- v${version} --push\n`
  );
  return 0;
}

/**
 * @param {{
 *   isEntrypoint: boolean;
 *   executeMain?: () => number;
 *   stderr?: TextWriter;
 *   processObject?: ExitCodeTarget;
 * }} dependencies
 */
export function runEntrypoint({
  isEntrypoint,
  executeMain = main,
  stderr = process.stderr,
  processObject = process,
}) {
  if (!isEntrypoint) return 0;

  try {
    return executeMain();
  } catch (error) {
    if (!(error instanceof ReleasePreparationError)) throw error;
    stderr.write(`${error.message}\n`);
    processObject.exitCode = 1;
    return 1;
  }
}

runEntrypoint({
  isEntrypoint: import.meta.url === `file://${process.argv[1]}`,
  executeMain: main,
  stderr: process.stderr,
  processObject: process,
});
