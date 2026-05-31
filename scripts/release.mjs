#!/usr/bin/env node
/**
 * Release helper — bumps the root package.json version, stamps a new
 * dated section into CHANGELOG.md from the git log, and commits both
 * changes locally.
 *
 * This script does NOT tag, push, or build artifacts. Tagging is owned
 * by .github/workflows/auto-tag-release.yml (fires on push to main when
 * the head-commit subject matches `chore(release): vX.Y.Z`). Artifact
 * build is owned by .github/workflows/release.yml (fires on tag push).
 *
 *   Usage:  pnpm release <patch|minor|major>
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' });
}

/**
 * Returns the most recent annotated tag matching `<prefix>*.*.*` that
 * is an ancestor of HEAD, or empty string when no such tag exists.
 */
export function previousTagFor(prefix) {
  try {
    return execFileSync(
      'git',
      ['describe', '--tags', `--match=${prefix}*.*.*`, '--abbrev=0', 'HEAD'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
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
export function generateBody(fromRef) {
  const range = fromRef ? `${fromRef}..HEAD` : 'HEAD';
  const out = git('log', '--no-merges', '--pretty=format:%H%x09%s', range)
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

function runInherit(file, args) {
  execFileSync(file, args, { stdio: 'inherit' });
}

function isDirty() {
  return git('status', '--porcelain').trim().length > 0;
}

function readVersion(dir) {
  return JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')).version;
}

function currentBranch() {
  return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    encoding: 'utf8',
  }).trim();
}

function main() {
  const args = process.argv.slice(2);
  const bump = args.find(a => !a.startsWith('-'));
  const noPush = args.includes('--no-push');
  const valid = ['patch', 'minor', 'major'];
  if (!valid.includes(bump)) {
    process.stderr.write(
      `Usage: pnpm release <${valid.join('|')}> [--no-push]\n`
    );
    process.exit(1);
  }

  if (isDirty()) {
    process.stderr.write(
      'Working tree is dirty. Commit or stash changes before running pnpm release.\n'
    );
    process.exit(1);
  }

  const prevTag = previousTagFor('v');

  runInherit('npm', ['version', bump, '--no-git-tag-version']);

  const version = readVersion('.');
  const body = generateBody(prevTag);
  const src = readFileSync('CHANGELOG.md', 'utf8');
  const stamped = stampChangelog(src, version, body);
  writeFileSync('CHANGELOG.md', stamped);

  runInherit('git', ['add', 'package.json', 'CHANGELOG.md']);
  runInherit('git', ['commit', '-m', `chore(release): v${version}`]);

  if (noPush) {
    process.stdout.write(
      `\nCommitted chore(release): v${version} locally (no push).\n` +
        `  Review: git show HEAD\n` +
        `  Push:   git push origin ${currentBranch()}\n` +
        `\nThe release.yml workflow fires on the chore(release) commit push.\n`
    );
    return;
  }

  const branch = currentBranch();
  process.stdout.write(
    `\nPushing chore(release): v${version} → origin/${branch}…\n`
  );
  runInherit('git', ['push', 'origin', branch]);
  process.stdout.write(
    `\nReleased v${version} (commit pushed).\n` +
      `Watch the workflow at: https://github.com/Dahkenangnon/Parako.ID/actions\n`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
