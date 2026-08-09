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
  it('contains no focused or todo tests', () => {
    const prohibited = scanTestDirectives(process.cwd()).filter(
      ({ directive }) => directive !== 'skipped-test'
    );

    expect(prohibited).toEqual([]);
  });

  it('registers every skipped test with ownership and a review date', () => {
    const registry = JSON.parse(
      readFileSync(
        resolve(process.cwd(), 'test/coverage/test-exceptions.json'),
        'utf8'
      )
    ) as {
      version: number;
      exceptions: Array<
        TestDirectiveOccurrence & {
          reason: string;
          requiredEnvironment: string;
          approver: string;
          reviewDate: string;
        }
      >;
    };
    const registeredOccurrences = registry.exceptions.map(
      ({ file, line, directive }) => ({ file, line, directive })
    );
    const actualOccurrences = scanTestDirectives(process.cwd()).filter(
      ({ directive }) => directive === 'skipped-test'
    );

    expect(registry.version).toBe(1);
    expect(registeredOccurrences).toEqual(actualOccurrences);
    for (const exception of registry.exceptions) {
      expect(exception.reason).not.toBe('');
      expect(exception.requiredEnvironment).not.toBe('');
      expect(exception.approver).not.toBe('');
      expect(exception.reviewDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
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
