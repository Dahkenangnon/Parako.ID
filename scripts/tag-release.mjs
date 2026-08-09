#!/usr/bin/env node
/**
 * Guarded stable-tag publisher. Publication is owned exclusively by a pushed
 * vX.Y.Z tag; manual workflow dispatches are validation-only.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * @typedef {(file: string, args: string[], options?: Record<string, unknown>) =>
 *   string | Buffer | null | undefined} CommandExecutor
 * @typedef {(path: string, encoding: 'utf8') => string} TextFileReader
 * @typedef {{ write(chunk: string): unknown }} TextWriter
 * @typedef {{ exitCode?: number }} ExitCodeTarget
 */

const REPOSITORY = 'Dahkenangnon/Parako.ID';
const STABLE_TAG = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function isStableTag(tag) {
  return STABLE_TAG.test(tag);
}

export function normalizeCommandOutput(output) {
  return output == null ? '' : String(output).trim();
}

/**
 * @param {string} file
 * @param {string[]} args
 * @param {Record<string, unknown>} [options]
 * @param {CommandExecutor} [execute]
 */
export function run(file, args, options = {}, execute = execFileSync) {
  return normalizeCommandOutput(
    execute(file, args, { encoding: 'utf8', ...options })
  );
}

export class ReleaseTagError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ReleaseTagError';
  }
}

function fail(message) {
  throw new ReleaseTagError(message);
}

/** @param {string} file @param {string[]} args @param {CommandExecutor} [execute] */
export function succeeds(file, args, execute = execFileSync) {
  try {
    run(file, args, { stdio: 'ignore' }, execute);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} tag @param {CommandExecutor} [execute] */
export function remoteTagExists(tag, execute = execFileSync) {
  try {
    return (
      run(
        'git',
        [
          'ls-remote',
          '--exit-code',
          '--tags',
          'origin',
          `refs/tags/${tag}`,
          `refs/tags/${tag}^{}`,
        ],
        {},
        execute
      ).length > 0
    );
  } catch (error) {
    if (error?.status === 2) return false;
    throw error;
  }
}

/** @param {string} tag @param {CommandExecutor} [execute] */
export function releaseExists(tag, execute = execFileSync) {
  try {
    run('gh', ['api', `repos/${REPOSITORY}/releases/tags/${tag}`], {}, execute);
    return true;
  } catch (error) {
    const diagnostic = `${String(error?.stdout ?? '')}\n${String(error?.stderr ?? '')}`;
    if (/HTTP 404|release not found/i.test(diagnostic)) return false;
    throw error;
  }
}

/**
 * @param {{
 *   argv?: string[];
 *   execute?: CommandExecutor;
 *   readFile?: TextFileReader;
 *   stdout?: TextWriter;
 * }} [dependencies]
 */
export function main({
  argv = process.argv.slice(2),
  execute = execFileSync,
  readFile = readFileSync,
  stdout = process.stdout,
} = {}) {
  const args = argv;
  const tag = args.find(argument => !argument.startsWith('-'));
  const push = args.includes('--push');
  const checkOnly = args.includes('--check') || !push;
  const unknown = args.filter(
    argument => argument !== tag && !['--push', '--check'].includes(argument)
  );

  if (!tag || !isStableTag(tag) || unknown.length > 0) {
    fail('usage: pnpm release:tag -- vX.Y.Z [--check|--push]');
  }

  if (run('git', ['status', '--porcelain'], {}, execute) !== '') {
    fail('working tree must be clean');
  }
  if (
    run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {}, execute) !== 'main'
  ) {
    fail('tags may be created only from main');
  }

  run(
    'git',
    ['fetch', '--quiet', 'origin', 'main', '--tags'],
    { stdio: 'inherit' },
    execute
  );
  const head = run('git', ['rev-parse', 'HEAD'], {}, execute);
  const remoteMain = run('git', ['rev-parse', 'origin/main'], {}, execute);
  if (head !== remoteMain) {
    fail(`HEAD ${head} does not equal origin/main ${remoteMain}`);
  }

  const version = JSON.parse(readFile('package.json', 'utf8')).version;
  if (tag !== `v${version}`) {
    fail(`tag ${tag} does not match package.json version ${version}`);
  }
  const changelog = readFile('CHANGELOG.md', 'utf8');
  if (!changelog.includes(`## [${version}] - `)) {
    fail(`CHANGELOG.md has no ${version} release section`);
  }
  if (
    succeeds(
      'git',
      ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`],
      execute
    )
  ) {
    fail(`local tag ${tag} already exists`);
  }
  let hasRemoteTag;
  try {
    hasRemoteTag = remoteTagExists(tag, execute);
  } catch {
    fail(`could not verify that remote tag ${tag} is absent`);
  }
  if (hasRemoteTag) fail(`remote tag ${tag} already exists`);

  if (!succeeds('gh', ['auth', 'status'], execute)) {
    fail('GitHub CLI authentication is required to verify release absence');
  }
  let hasRelease;
  try {
    hasRelease = releaseExists(tag, execute);
  } catch {
    fail(`could not verify that GitHub Release ${tag} is absent`);
  }
  if (hasRelease) fail(`GitHub Release ${tag} already exists`);

  if (checkOnly) {
    stdout.write(
      `Tag checks passed for ${tag} at ${head}. Re-run with --push after all protected checks pass.\n`
    );
    return 0;
  }

  execute('git', ['tag', '-a', tag, '-m', `release: ${tag}`], {
    stdio: 'inherit',
  });
  execute('git', ['push', 'origin', `refs/tags/${tag}`], {
    stdio: 'inherit',
  });
  stdout.write(
    `Pushed immutable tag ${tag}. The tag-only release workflow now owns publication.\n`
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
    if (!(error instanceof ReleaseTagError)) throw error;
    stderr.write(`Release tag check failed: ${error.message}\n`);
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
