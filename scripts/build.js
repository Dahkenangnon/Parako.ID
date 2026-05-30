#!/usr/bin/env node

// Production Build Orchestrator
//
// Uses SWC for fast transpilation, tsc for type-checking only:
//   Step 1: rimraf dist/
//   Step 2: swc src/ → dist/src/                    (server transpile, ~0.3s)
//   Step 3: swc scripts/manage/ → dist/scripts/     (CLI tools, ~0.1s)
//   Step 4: esbuild src/assets/js/*.ts              (browser bundles, minified, console-stripped)
//   Step 5: tailwindcss --minify                    (CSS to public/css/)
//   Step 6: cp -r src/views/ dist/src/views/        (Nunjucks templates, HTML comments stripped)
//   Step 7: BUILD_INFO.json                         (deployment traceability)
//   Parallel: tsc --noEmit                          (type-check, non-blocking by default)

import { execFileSync, spawnSync, spawn } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  readdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { globSync } from 'glob';
import {
  cleanPriorOutputs,
  hashFile,
  manifestFromEsbuildMeta,
  readManifest,
  writeManifest,
} from './build-manifest.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const STRICT = process.argv.includes('--strict');

// ---------------------------------------------------------------------------
// Environment check
// ---------------------------------------------------------------------------

if (process.env.NODE_ENV !== 'production') {
  console.error(
    '\x1b[31m%s\x1b[0m',
    'Build requires NODE_ENV=production. Use: cross-env NODE_ENV=production node scripts/build.js'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const green = s => `\x1b[32m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;
const red = s => `\x1b[31m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;

function step(label, fn) {
  const start = performance.now();
  try {
    const detail = fn();
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    const extra = detail ? dim(`  (${detail})`) : '';
    console.log(
      `  ${green('\u2713')} ${label.padEnd(16)} ${dim(`${elapsed}s`)}${extra}`
    );
  } catch (err) {
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);
    console.log(`  ${red('\u2717')} ${label.padEnd(16)} ${dim(`${elapsed}s`)}`);
    console.error(`\n${red(err.stderr?.toString() || err.message || err)}`);
    process.exit(1);
  }
}

const BIN = join(ROOT, 'node_modules', '.bin');

function bin(tool, args) {
  execFileSync(join(BIN, tool), args, { cwd: ROOT, stdio: 'pipe' });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countFiles(dir, ext) {
  try {
    let count = 0;
    const entries = readdirSync(dir, { withFileTypes: true, recursive: true });
    for (const e of entries) {
      if (e.isFile() && (!ext || e.name.endsWith(ext))) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

/** Copy directory, stripping HTML comments from .njk files in production */
function copyViewsSync(src, dest) {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true, recursive: true });
  for (const entry of entries) {
    const srcPath = join(entry.parentPath || entry.path, entry.name);
    const relPath = relative(src, srcPath);
    const destPath = join(dest, relPath);

    if (entry.isDirectory()) {
      mkdirSync(destPath, { recursive: true });
    } else if (entry.name.endsWith('.njk')) {
      // Strip HTML comments from Nunjucks templates (but preserve Nunjucks comments {# #})
      // Loop until stable so nested or sequential `<!--` reveals after rewrites are also stripped.
      let content = readFileSync(srcPath, 'utf-8');
      let previous;
      do {
        previous = content;
        content = content.replace(/<!--[\s\S]*?-->/g, '');
      } while (content !== previous);
      mkdirSync(dirname(destPath), { recursive: true });
      writeFileSync(destPath, content);
    } else {
      mkdirSync(dirname(destPath), { recursive: true });
      cpSync(srcPath, destPath, { force: true });
    }
  }
}

/** Get git SHA for build manifest */
function getGitSha() {
  try {
    return spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).stdout.trim();
  } catch {
    return 'unknown';
  }
}

// Run tsc --noEmit for one tsconfig as a background type-check, returns a promise.
function typecheckOne(project, label) {
  return new Promise(resolve => {
    const start = performance.now();
    const child = spawn(join(BIN, 'tsc'), ['--noEmit', '-p', project], {
      cwd: ROOT,
      stdio: 'pipe',
    });

    let stdout = '';
    child.stdout.on('data', data => {
      stdout += data.toString();
    });
    child.stderr.on('data', data => {
      stdout += data.toString();
    });

    child.on('close', code => {
      const elapsed = ((performance.now() - start) / 1000).toFixed(1);
      const errorLines = stdout.split('\n').filter(l => l.includes('error TS'));
      if (errorLines.length > 0) {
        const icon = STRICT ? red('\u2717') : yellow('\u26A0');
        console.log(
          `  ${icon} ${label.padEnd(16)} ${dim(`${elapsed}s`)}  ${yellow(`${errorLines.length} error(s)`)}`
        );
        if (STRICT) {
          console.error(
            `\n${red(`Typecheck failed (${label}, --strict mode):`)}`
          );
          for (const line of errorLines.slice(0, 20)) {
            console.error(`  ${red(line)}`);
          }
          if (errorLines.length > 20) {
            console.error(dim(`  ... and ${errorLines.length - 20} more`));
          }
        }
      } else {
        console.log(
          `  ${green('\u2713')} ${label.padEnd(16)} ${dim(`${elapsed}s`)}  ${dim('0 errors')}`
        );
      }
      resolve({ code, errorCount: errorLines.length });
    });
  });
}

// Run tsc --noEmit against both server and browser tsconfigs in parallel.
async function typecheckAsync() {
  const [server, browser] = await Promise.all([
    typecheckOne('tsconfig.build.json', 'typecheck:srv'),
    typecheckOne('tsconfig.assets.json', 'typecheck:web'),
  ]);
  return {
    code: server.code || browser.code,
    errorCount: server.errorCount + browser.errorCount,
  };
}

// ---------------------------------------------------------------------------
// Build Steps
// ---------------------------------------------------------------------------

async function main() {
  const totalStart = performance.now();
  console.log();

  const PUBLIC_ROOT = join(ROOT, 'public');
  const PUBLIC_JS = join(PUBLIC_ROOT, 'js');
  const PUBLIC_CSS = join(PUBLIC_ROOT, 'css');
  const ASSETS_JS_OUTBASE = join(ROOT, 'src/assets/js');
  const MANIFEST_PATH = join(PUBLIC_ROOT, 'manifest.json');
  const ESBUILD_META_PATH = join(PUBLIC_ROOT, '.esbuild-meta.json');
  const priorManifest = readManifest(MANIFEST_PATH);

  // Step 1: Clean. Remove dist/ entirely, every hashed asset emitted by a
  // prior build, the esbuild JS bundle directory in its entirety, and the
  // Tailwind CSS outputs. Other files under public/ (theme.css, favicon,
  // images, robots.txt, llms.txt) are left untouched.
  step('clean', () => {
    rmSync(join(ROOT, 'dist'), { recursive: true, force: true });
    cleanPriorOutputs(PUBLIC_ROOT, priorManifest);
    rmSync(PUBLIC_JS, { recursive: true, force: true });
    for (const name of readdirSync(PUBLIC_CSS).filter(n =>
      /^styles(-[A-Za-z0-9]+)?\.css$/.test(n)
    )) {
      rmSync(join(PUBLIC_CSS, name), { force: true });
    }
    rmSync(MANIFEST_PATH, { force: true });
    rmSync(ESBUILD_META_PATH, { force: true });
  });

  // Start type-check in background (non-blocking unless --strict)
  const typecheckPromise = typecheckAsync();

  // Step 2: Server TS → dist/src/ (SWC, production minify)
  step('server swc', () => {
    bin('swc', [
      'src',
      '-d',
      'dist/src',
      '--strip-leading-paths',
      '--config-file',
      '.swcrc.prod',
      '--extensions',
      '.ts',
      '--ignore',
      'src/assets/**',
    ]);
    return `${countFiles(join(ROOT, 'dist/src'), '.js')} files`;
  });

  // Step 3: CLI scripts → dist/scripts/ (SWC, production minify)
  step('scripts swc', () => {
    bin('swc', [
      'scripts/manage',
      '-d',
      'dist/scripts',
      '--strip-leading-paths',
      '--config-file',
      '.swcrc.prod',
      '--extensions',
      '.ts',
    ]);
    return `${countFiles(join(ROOT, 'dist/scripts'), '.js')} files`;
  });

  // Step 4: Client-side TS → public/js/ (esbuild, minified, console-stripped,
  // content-hashed filenames; the metafile lets the manifest step locate the
  // hashed outputs without having to re-scan the directory).
  step('client js', () => {
    const entries = globSync('src/assets/js/**/*.ts', { cwd: ROOT });
    if (entries.length === 0) return '0 files';

    bin('esbuild', [
      ...entries,
      '--bundle',
      '--minify',
      '--format=esm',
      '--target=es2020',
      '--outdir=public/js',
      '--outbase=src/assets/js',
      '--entry-names=[dir]/[name]-[hash]',
      `--metafile=${relative(ROOT, ESBUILD_META_PATH)}`,
      '--drop:console',
      '--legal-comments=none',
    ]);
    return `${entries.length} files to public/js/`;
  });

  // Step 5: Tailwind CSS → public/css/styles.css then content-hashed.
  // tailwindcss has no native hashing; the post-process renames the emitted
  // file so the basename includes the truncated sha256.
  let hashedTailwindCss = null;
  step('tailwind css', () => {
    bin('tailwindcss', [
      '-i',
      './src/assets/css/app.css',
      '-o',
      './public/css/styles.css',
      '--minify',
    ]);
    hashedTailwindCss = hashFile(
      join(PUBLIC_ROOT, 'css/styles.css'),
      PUBLIC_ROOT
    );
    return hashedTailwindCss;
  });

  // Step 6: Copy Nunjucks views → dist/src/views/ (strip HTML comments)
  step('copy views', () => {
    const src = join(ROOT, 'src/views');
    const dest = join(ROOT, 'dist/src/views');
    copyViewsSync(src, dest);
    return `${countFiles(dest)} files`;
  });

  // Step 7: Emit public/manifest.json mapping logical asset names to the
  // content-hashed paths just produced.
  step('manifest', () => {
    const mapping = manifestFromEsbuildMeta(
      ESBUILD_META_PATH,
      PUBLIC_ROOT,
      'js',
      ASSETS_JS_OUTBASE
    );
    if (hashedTailwindCss) {
      mapping['css/styles.css'] = hashedTailwindCss;
    }
    writeManifest(MANIFEST_PATH, mapping);
    rmSync(ESBUILD_META_PATH, { force: true });
    return `${Object.keys(mapping).length} entries`;
  });

  // Step 7: Build manifest for deployment traceability
  step('build info', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf-8'));
    const manifest = {
      name: pkg.name,
      version: pkg.version,
      gitSha: getGitSha(),
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
    };
    writeFileSync(
      join(ROOT, 'dist/BUILD_INFO.json'),
      JSON.stringify(manifest, null, 2)
    );
    return `v${pkg.version} @ ${manifest.gitSha}`;
  });

  // Wait for background type-check to finish
  const { errorCount } = await typecheckPromise;

  // In --strict mode, fail the build on type errors
  if (STRICT && errorCount > 0) {
    console.log(
      `\n  ${red(bold('Build failed:'))} typecheck errors in --strict mode\n`
    );
    process.exit(1);
  }

  // Summary
  const totalElapsed = ((performance.now() - totalStart) / 1000).toFixed(1);
  console.log(`\n  ${bold('Build complete')}  ${dim(`${totalElapsed}s`)}\n`);
}

main().catch(err => {
  console.error(red(err.message));
  process.exit(1);
});
