import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const canonicalSpinnerPath =
  'M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 0 1 4 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z';

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(entryPath) : [entryPath];
  });
}

describe('inline SVG paths', () => {
  it('uses unambiguous arc flags for every shared loading spinner', () => {
    const files = [
      ...sourceFiles(path.join(process.cwd(), 'src/assets')),
      ...sourceFiles(path.join(process.cwd(), 'src/views')),
    ];

    const occurrences = files.flatMap(file => {
      const source = readFileSync(file, 'utf8');
      return [...source.matchAll(/M4 12a8 8[^'"<\n]+/g)].map(match => ({
        file: path.relative(process.cwd(), file),
        path: match[0],
      }));
    });

    expect(occurrences.length).toBeGreaterThan(0);
    expect(occurrences).toEqual(
      occurrences.map(occurrence => ({
        ...occurrence,
        path: canonicalSpinnerPath,
      }))
    );
  });
});
