import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { listRepositoryFiles } from '../../../scripts/testing/production-artifact-manifest.js';

type TestDirective = 'focused-test' | 'skipped-test' | 'todo-test';

interface TestDirectiveOccurrence {
  file: string;
  line: number;
  directive: TestDirective;
}

const DIRECTIVE_PATTERNS: Array<{
  directive: TestDirective;
  pattern: RegExp;
}> = [
  {
    directive: 'focused-test',
    pattern: /\b(?:describe|it|test)\.only\b/g,
  },
  {
    directive: 'skipped-test',
    pattern: /\b(?:describe|it|test|ctx)\.skip\b/g,
  },
  {
    directive: 'todo-test',
    pattern: /\b(?:describe|it|test)\.todo\b/g,
  },
];

function lineNumberAt(contents: string, index: number): number {
  return contents.slice(0, index).split('\n').length;
}

function scanTestDirectives(repositoryRoot: string): TestDirectiveOccurrence[] {
  return listRepositoryFiles(repositoryRoot)
    .filter(filePath => /^test\/.*\.(?:test|spec)\.(?:js|ts)$/.test(filePath))
    .flatMap(filePath => {
      const contents = readFileSync(resolve(repositoryRoot, filePath), 'utf8');

      return DIRECTIVE_PATTERNS.flatMap(({ directive, pattern }) =>
        Array.from(contents.matchAll(pattern), match => ({
          file: filePath,
          line: lineNumberAt(contents, match.index),
          directive,
        }))
      );
    })
    .sort((left, right) =>
      `${left.file}:${left.line}:${left.directive}`.localeCompare(
        `${right.file}:${right.line}:${right.directive}`
      )
    );
}

describe('test suite policy', () => {
  it('contains no focused, skipped, or todo tests', () => {
    expect(scanTestDirectives(process.cwd())).toEqual([]);
  });

  it('contains no unregistered inline coverage or mutation exclusions', () => {
    const forbiddenPattern = /(?:c8|istanbul)\s+ignore|Stryker\s+disable/g;
    const occurrences = listRepositoryFiles(process.cwd())
      .filter(filePath => /^(?:src|scripts)\//.test(filePath))
      .flatMap(filePath => {
        const contents = readFileSync(resolve(process.cwd(), filePath), 'utf8');
        return Array.from(contents.matchAll(forbiddenPattern), match => ({
          file: filePath,
          line: lineNumberAt(contents, match.index),
        }));
      });

    expect(occurrences).toEqual([]);
  });
});
