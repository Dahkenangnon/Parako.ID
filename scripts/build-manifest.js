// Manifest helpers for the production build.
//
// The manifest is a JSON file at public/manifest.json mapping the logical
// asset path that a template references ("css/styles.css") to the
// content-hashed path that the build actually emitted ("css/styles-3f8a21c4.css").
// The Nunjucks asset() helper reads this file at runtime to resolve URLs and
// the build's clean step reads the prior manifest so a fresh build does not
// orphan its predecessor's emitted files.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative } from 'node:path';

const HASH_LENGTH = 8;

export function readManifest(manifestPath) {
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch {
    return null;
  }
}

export function writeManifest(manifestPath, mapping) {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(mapping, null, 2));
}

export function cleanPriorOutputs(publicRoot, priorManifest) {
  if (!priorManifest) return 0;
  let removed = 0;
  for (const hashedPath of Object.values(priorManifest)) {
    const absPath = join(publicRoot, hashedPath);
    if (existsSync(absPath)) {
      rmSync(absPath, { force: true });
      removed++;
    }
  }
  return removed;
}

function sha256Hex(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Compute the SHA-256 hash of a file and rename it so the basename includes
 * the truncated hash. Returns the new path relative to the provided root.
 */
export function hashFile(absolutePath, rootDir) {
  const buffer = readFileSync(absolutePath);
  const hash = sha256Hex(buffer).slice(0, HASH_LENGTH);
  const ext = extname(absolutePath);
  const base = absolutePath.slice(0, -ext.length);
  const hashedPath = `${base}-${hash}${ext}`;
  renameSync(absolutePath, hashedPath);
  return relative(rootDir, hashedPath).replace(/\\/g, '/');
}

/**
 * Walk an esbuild metafile and produce the logical->hashed mapping for the
 * JavaScript bundles it emitted under the given prefix. The logical name is
 * derived from the entry point relative to its outbase so it matches the
 * path templates use to reference the asset.
 */
export function manifestFromEsbuildMeta(metaPath, publicRoot, prefix, outbase) {
  const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
  const mapping = {};

  for (const [outputPath, info] of Object.entries(meta.outputs)) {
    if (!info?.entryPoint) continue;

    const absOutput = join(publicRoot, '..', outputPath);
    const relOutput = relative(publicRoot, absOutput).replace(/\\/g, '/');
    if (!relOutput.startsWith(`${prefix}/`)) continue;

    const entryRel = relative(outbase, info.entryPoint).replace(/\\/g, '/');
    const logical = `${prefix}/${entryRel.replace(/\.ts$/, '.js')}`;
    mapping[logical] = relOutput;
  }

  return mapping;
}

/**
 * Recursively collect file paths beneath the given root that match an
 * extension allowlist.
 */
export function collectFiles(rootDir, extensions) {
  const out = [];
  if (!existsSync(rootDir)) return out;
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      const info = statSync(full);
      if (info.isDirectory()) {
        stack.push(full);
      } else if (extensions.includes(extname(entry))) {
        out.push(full);
      }
    }
  }
  return out;
}
