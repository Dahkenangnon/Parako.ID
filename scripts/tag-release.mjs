#!/usr/bin/env node
/**
 * Guarded stable-tag publisher. Publication is owned exclusively by a pushed
 * vX.Y.Z tag; manual workflow dispatches are validation-only.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REPOSITORY = 'Dahkenangnon/Parako.ID';
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isStableTag(tag) {
  return STABLE_TAG.test(tag);
}

function run(file, args, options = {}) {
  return execFileSync(file, args, { encoding: 'utf8', ...options }).trim();
}

function fail(message) {
  process.stderr.write(`Release tag check failed: ${message}\n`);
  process.exit(1);
}

function succeeds(file, args) {
  try {
    run(file, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function remoteTagExists(tag) {
  try {
    return (
      run('git', [
        'ls-remote',
        '--exit-code',
        '--tags',
        'origin',
        `refs/tags/${tag}`,
        `refs/tags/${tag}^{}`,
      ]).length > 0
    );
  } catch (error) {
    if (error?.status === 2) return false;
    throw error;
  }
}

function releaseExists(tag) {
  try {
    run('gh', ['api', `repos/${REPOSITORY}/releases/tags/${tag}`]);
    return true;
  } catch (error) {
    const diagnostic = `${String(error?.stdout ?? '')}\n${String(error?.stderr ?? '')}`;
    if (/HTTP 404|release not found/i.test(diagnostic)) return false;
    throw error;
  }
}

function main() {
  const args = process.argv.slice(2);
  const tag = args.find(argument => !argument.startsWith('-'));
  const push = args.includes('--push');
  const checkOnly = args.includes('--check') || !push;
  const unknown = args.filter(
    argument => argument !== tag && !['--push', '--check'].includes(argument)
  );

  if (!tag || !isStableTag(tag) || unknown.length > 0) {
    fail('usage: pnpm release:tag -- vX.Y.Z [--check|--push]');
  }

  if (run('git', ['status', '--porcelain']) !== '') {
    fail('working tree must be clean');
  }
  if (run('git', ['rev-parse', '--abbrev-ref', 'HEAD']) !== 'main') {
    fail('tags may be created only from main');
  }

  run('git', ['fetch', '--quiet', 'origin', 'main', '--tags'], {
    stdio: 'inherit',
  });
  const head = run('git', ['rev-parse', 'HEAD']);
  const remoteMain = run('git', ['rev-parse', 'origin/main']);
  if (head !== remoteMain) {
    fail(`HEAD ${head} does not equal origin/main ${remoteMain}`);
  }

  const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
  if (tag !== `v${version}`) {
    fail(`tag ${tag} does not match package.json version ${version}`);
  }
  const changelog = readFileSync('CHANGELOG.md', 'utf8');
  if (!changelog.includes(`## [${version}] - `)) {
    fail(`CHANGELOG.md has no ${version} release section`);
  }
  if (
    succeeds('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`])
  ) {
    fail(`local tag ${tag} already exists`);
  }
  try {
    if (remoteTagExists(tag)) fail(`remote tag ${tag} already exists`);
  } catch {
    fail(`could not verify that remote tag ${tag} is absent`);
  }

  if (!succeeds('gh', ['auth', 'status'])) {
    fail('GitHub CLI authentication is required to verify release absence');
  }
  try {
    if (releaseExists(tag)) fail(`GitHub Release ${tag} already exists`);
  } catch {
    fail(`could not verify that GitHub Release ${tag} is absent`);
  }

  if (checkOnly) {
    process.stdout.write(
      `Tag checks passed for ${tag} at ${head}. Re-run with --push after all protected checks pass.\n`
    );
    return;
  }

  execFileSync('git', ['tag', '-a', tag, '-m', `release: ${tag}`], {
    stdio: 'inherit',
  });
  execFileSync('git', ['push', 'origin', `refs/tags/${tag}`], {
    stdio: 'inherit',
  });
  process.stdout.write(
    `Pushed immutable tag ${tag}. The tag-only release workflow now owns publication.\n`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
