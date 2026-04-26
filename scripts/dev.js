#!/usr/bin/env node

import { spawn, execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { watch } from 'chokidar';
import { globSync } from 'glob';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const WITH_WORKER = process.argv.includes('--with-worker');

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

const green = s => `\x1b[32m${s}\x1b[0m`;
const cyan = s => `\x1b[36m${s}\x1b[0m`;
const yellow = s => `\x1b[33m${s}\x1b[0m`;
const dim = s => `\x1b[2m${s}\x1b[0m`;
const bold = s => `\x1b[1m${s}\x1b[0m`;
const red = s => `\x1b[31m${s}\x1b[0m`;
const magenta = s => `\x1b[35m${s}\x1b[0m`;

function timestamp() {
  return dim(
    new Date().toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  );
}

function log(msg, tag) {
  const prefix = tag ? `${dim(`[${tag}]`)} ` : '';
  console.log(`  ${timestamp()} ${prefix}${msg}`);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BIN = join(ROOT, 'node_modules', '.bin');

function bin(tool, args) {
  execFileSync(join(BIN, tool), args, { cwd: ROOT, stdio: 'pipe' });
}

// SWC for fast transpilation (no type-checking)
function swcSync(srcDir, outDir, opts = {}) {
  const args = [
    srcDir,
    '-d',
    outDir,
    '--strip-leading-paths',
    '--config-file',
    '.swcrc',
    '--extensions',
    '.ts',
  ];
  if (opts.ignore) {
    args.push('--ignore', opts.ignore);
  }
  const result = spawnSync(join(BIN, 'swc'), args, {
    cwd: ROOT,
    stdio: 'pipe',
    encoding: 'utf-8',
  });
  if (result.status !== 0) {
    throw new Error(result.stdout || result.stderr || 'swc failed');
  }
}

function copyDirSync(src, dest) {
  mkdirSync(dest, { recursive: true });
  cpSync(src, dest, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Initial Build (same as production, but without minification)
// ---------------------------------------------------------------------------

async function initialBuild() {
  const start = performance.now();
  console.log();

  // Clean
  console.log('  cleaning dist...');
  rmSync(join(ROOT, 'dist'), { recursive: true, force: true });

  // Server transpile (SWC — fast, no type-checking)
  console.log('  compiling server...');
  swcSync('src', 'dist/src', { ignore: 'src/assets/**' });
  console.log('  server done');

  // Scripts transpile (SWC)
  swcSync('scripts/manage', 'dist/scripts');

  // Client JS (no minify in dev)
  const entries = globSync('src/assets/js/**/*.ts', { cwd: ROOT });
  if (entries.length > 0) {
    bin('esbuild', [
      ...entries,
      '--bundle',
      '--format=esm',
      '--target=es2020',
      '--outdir=public/js',
      '--outbase=src/assets/js',
    ]);
  }

  // Tailwind (no minify in dev)
  bin('tailwindcss', [
    '-i',
    './src/assets/css/app.css',
    '-o',
    './public/css/styles.css',
  ]);

  // Copy views
  copyDirSync(join(ROOT, 'src/views'), join(ROOT, 'dist/src/views'));

  const elapsed = ((performance.now() - start) / 1000).toFixed(1);
  console.log(
    `  ${green('\u2713')} ${bold('Initial build')}  ${dim(`${elapsed}s`)}`
  );
}

// ---------------------------------------------------------------------------
// Process Management
// ---------------------------------------------------------------------------

const children = [];

function spawnProcess(label, cmd, args, opts = {}) {
  const color =
    label === 'tsc'
      ? cyan
      : label === 'server'
        ? green
        : label === 'tailwind'
          ? magenta
          : label === 'worker'
            ? yellow
            : yellow;

  const child = spawn(cmd, args, {
    cwd: ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...opts.env },
  });

  child.stdout.on('data', data => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      // Filter noisy tsc output — only show errors and "Found 0 errors"
      if (label === 'tsc') {
        if (
          line.includes('error TS') ||
          line.includes('Found') ||
          line.includes('Starting')
        ) {
          log(color(line.trim()), label);
        }
        continue;
      }
      log(color(line.trim()), label);
    }
  });

  child.stderr.on('data', data => {
    const lines = data.toString().trim().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      // Filter Node deprecation warnings
      if (line.includes('[DEP0')) continue;
      // Filter tailwind "Done in" messages on stderr
      if (label === 'tailwind' && line.includes('Done in')) continue;
      log(red(line.trim()), label);
    }
  });

  child.on('exit', (code, signal) => {
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;
    if (code !== 0 && code !== null) {
      log(red(`exited with code ${code}`), label);
    }
  });

  children.push(child);
  return child;
}

function cleanup() {
  for (const child of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      // ignore
    }
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// ---------------------------------------------------------------------------
// Asset Watcher (single chokidar instance)
// ---------------------------------------------------------------------------

function startAssetWatcher() {
  const viewsDir = join(ROOT, 'src/views');
  const clientJsDir = join(ROOT, 'src/assets/js');

  const watcher = watch([viewsDir, clientJsDir], {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    usePolling: false,
    depth: 10,
  });

  // Debounce map for esbuild calls
  const debounceTimers = new Map();

  watcher.on('change', filePath => {
    const relPath = relative(ROOT, filePath);

    // View file changed → copy to dist
    if (filePath.startsWith(viewsDir)) {
      const destPath = filePath.replace(
        join(ROOT, 'src'),
        join(ROOT, 'dist/src')
      );
      try {
        mkdirSync(dirname(destPath), { recursive: true });
        cpSync(filePath, destPath, { force: true });
        log(`${dim(relPath)} ${green('\u2192')} copied`, 'views');
      } catch (err) {
        log(red(`copy failed: ${err.message}`), 'views');
      }
      return;
    }

    // Client JS changed → esbuild that file
    if (filePath.startsWith(clientJsDir) && extname(filePath) === '.ts') {
      // Debounce per-file
      const existing = debounceTimers.get(filePath);
      if (existing) clearTimeout(existing);

      debounceTimers.set(
        filePath,
        setTimeout(() => {
          debounceTimers.delete(filePath);
          const entryRel = relative(ROOT, filePath);
          try {
            bin('esbuild', [
              entryRel,
              '--bundle',
              '--format=esm',
              '--target=es2020',
              '--outdir=public/js',
              '--outbase=src/assets/js',
            ]);
            log(`${dim(relPath)} ${green('\u2192')} rebuilt`, 'esbuild');
          } catch (err) {
            log(
              red(`build failed: ${err.stderr?.toString() || err.message}`),
              'esbuild'
            );
          }
        }, 150)
      );
    }
  });

  watcher.on('add', filePath => {
    // New view file → copy
    if (filePath.startsWith(viewsDir)) {
      const destPath = filePath.replace(
        join(ROOT, 'src'),
        join(ROOT, 'dist/src')
      );
      try {
        mkdirSync(dirname(destPath), { recursive: true });
        cpSync(filePath, destPath, { force: true });
        log(
          `${dim(relative(ROOT, filePath))} ${green('\u2192')} added`,
          'views'
        );
      } catch {
        // ignore
      }
    }
  });

  watcher.on('error', err => {
    log(red(`Watcher error: ${err.message}`), 'watch');
  });

  return watcher;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  try {
    await initialBuild();
  } catch (err) {
    console.error(
      red(`\nInitial build failed: ${err.stderr?.toString() || err.message}`)
    );
    process.exit(1);
  }

  console.log(`  ${cyan('\u25CB')} Watching for changes...\n`);

  // Process 1: tsc --watch --noEmit (type-checking only, no file output)
  // SWC handles transpilation — tsc only reports type errors
  spawnProcess('tsc', join(BIN, 'tsc'), [
    '--watch',
    '--noEmit',
    '--incremental',
    '--preserveWatchOutput',
    '-p',
    'tsconfig.build.json',
  ]);

  // Process 2: swc --watch (transpile changed .ts → dist/src/)
  spawnProcess('swc', join(BIN, 'swc'), [
    'src',
    '-d',
    'dist/src',
    '--strip-leading-paths',
    '--config-file',
    '.swcrc',
    '--extensions',
    '.ts',
    '--ignore',
    'src/assets/**',
    '--watch',
  ]);

  // Process 3: node --watch-path (auto-restart on dist/ changes)
  spawnProcess(
    'server',
    'node',
    ['--watch-path=dist/src', '--watch-preserve-output', 'dist/src/index.js'],
    {
      env: {
        NODE_OPTIONS: '--max-old-space-size=2048',
      },
    }
  );

  // Process 4: tailwindcss --watch
  spawnProcess('tailwind', join(BIN, 'tailwindcss'), [
    '-i',
    './src/assets/css/app.css',
    '-o',
    './public/css/styles.css',
    '--watch',
  ]);

  // Process 5: Single chokidar watcher for views + client JS
  startAssetWatcher();

  // Process 6 (optional): Worker process — starts after initial build
  if (WITH_WORKER) {
    spawnProcess(
      'worker',
      'node',
      [
        '--watch-path=dist/src',
        '--watch-preserve-output',
        'dist/src/worker.js',
      ],
      {
        env: {
          NODE_OPTIONS: '--max-old-space-size=1024',
        },
      }
    );
  }
}

main().catch(err => {
  console.error(red(err.message));
  process.exit(1);
});
