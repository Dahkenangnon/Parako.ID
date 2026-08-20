import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BROWSER_ENTRY_POINTS,
  SERVICE_WORKER_ENTRY_POINT,
  logicalAssetForEntry,
  sourceEntryForLogicalAsset,
} from '../../../scripts/browser-entry-manifest.js';

const repositoryRoot = join(import.meta.dirname, '../../..');
const viewRoot = join(repositoryRoot, 'src/views');

function collectTemplateBrowserAssets(): string[] {
  const assets = new Set<string>();
  const stack = [viewRoot];
  const assetPattern = /asset\(['"](js\/[^'"]+\.js)['"]\)/g;

  while (stack.length > 0) {
    const directory = stack.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.name.endsWith('.njk')) continue;

      const template = readFileSync(path, 'utf8');
      for (const match of template.matchAll(assetPattern)) {
        assets.add(match[1]!);
      }
    }
  }

  return [...assets].sort();
}

describe('browser entry manifest', () => {
  it('contains unique, existing TypeScript entry roots', () => {
    expect(new Set(BROWSER_ENTRY_POINTS).size).toBe(
      BROWSER_ENTRY_POINTS.length
    );
    expect(BROWSER_ENTRY_POINTS).toEqual([...BROWSER_ENTRY_POINTS].sort());
    expect(BROWSER_ENTRY_POINTS).not.toContain(SERVICE_WORKER_ENTRY_POINT);

    for (const entryPoint of BROWSER_ENTRY_POINTS) {
      expect(entryPoint).toMatch(/^src\/assets\/js\/.+\.ts$/);
      expect(entryPoint).not.toMatch(/\.d\.ts$/);
      expect(existsSync(join(repositoryRoot, entryPoint))).toBe(true);
    }
  });

  it('matches every browser asset loaded directly by a template', () => {
    const declaredAssets =
      BROWSER_ENTRY_POINTS.map(logicalAssetForEntry).sort();
    expect(declaredAssets).toEqual(collectTemplateBrowserAssets());
  });

  it('maps logical assets and source entries reversibly', () => {
    for (const entryPoint of BROWSER_ENTRY_POINTS) {
      expect(sourceEntryForLogicalAsset(logicalAssetForEntry(entryPoint))).toBe(
        entryPoint
      );
    }
  });

  it('rejects paths outside the browser source and asset namespaces', () => {
    expect(() => logicalAssetForEntry('src/app.ts')).toThrow(
      'Invalid browser entry point'
    );
    expect(() => logicalAssetForEntry('src/assets/js/main.js')).toThrow(
      'Invalid browser entry point'
    );
    expect(() => sourceEntryForLogicalAsset('css/styles.css')).toThrow(
      'Invalid browser asset path'
    );
  });

  it('keeps the test anchored at the repository root', () => {
    expect(relative(repositoryRoot, viewRoot)).toBe('src/views');
  });
});
