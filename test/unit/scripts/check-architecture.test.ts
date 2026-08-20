import { describe, expect, it } from 'vitest';

import {
  analyzeSourceModules,
  createArchitectureBaseline,
  evaluateArchitecturePolicy,
  isDirectExecution,
  parseArchitectureBaseline,
  type ArchitectureSnapshot,
} from '../../../scripts/testing/check-architecture.js';

describe('architecture policy', () => {
  it('recognizes the relative argv path used by direct Node execution', () => {
    const moduleUrl = new URL(
      '../../../scripts/testing/check-architecture.ts',
      import.meta.url
    ).href;

    expect(
      isDirectExecution(moduleUrl, 'scripts/testing/check-architecture.ts')
    ).toBe(true);
    expect(isDirectExecution(moduleUrl, 'scripts/testing/other.ts')).toBe(
      false
    );
    expect(isDirectExecution(moduleUrl, undefined)).toBe(false);
  });

  it('finds deterministic cycles through runtime-extension imports', () => {
    const snapshot = analyzeSourceModules([
      {
        path: 'src/roles/a.ts',
        source: "export { valueB } from './b.js'; export const valueA = 1;",
      },
      {
        path: 'src/roles/b.ts',
        source:
          "import { valueA } from './a.js'; export const valueB = valueA;",
      },
      {
        path: 'src/standalone.ts',
        source:
          "import type { Missing } from 'external'; export type Value = Missing;",
      },
    ]);

    expect(snapshot.sourceFiles).toBe(3);
    expect(snapshot.cycles).toEqual([['src/roles/a.ts', 'src/roles/b.ts']]);
    expect(snapshot.directEnvironmentModules).toEqual([]);
  });

  it('identifies modules that read the process environment directly', () => {
    const snapshot = analyzeSourceModules([
      {
        path: 'src/bootstrap.ts',
        source: 'export const port = process.env.PORT;',
      },
      {
        path: 'src/runtime.ts',
        source: "export const value = 'process.env is documentation';",
      },
    ]);

    expect(snapshot.directEnvironmentModules).toEqual(['src/bootstrap.ts']);
  });

  it('counts the audited TypeScript escape forms', () => {
    const snapshot = analyzeSourceModules([
      {
        path: 'src/unsafe.ts',
        source: `
          // @ts-expect-error -- fixture
          const asserted = value as any;
          const typed: any = asserted;
          const present = maybe!;
        `,
      },
    ]);

    expect(snapshot.typeEscapes).toEqual({
      explicitAny: 2,
      anyAssertions: 1,
      nonNullAssertions: 1,
      typescriptSuppressions: 1,
    });
  });

  it('allows reductions from the recorded baseline', () => {
    const baseline = createArchitectureBaseline({
      sourceFiles: 2,
      cycles: [['src/a.ts', 'src/b.ts']],
      directEnvironmentModules: ['src/bootstrap.ts'],
      typeEscapes: {
        explicitAny: 4,
        anyAssertions: 2,
        nonNullAssertions: 3,
        typescriptSuppressions: 1,
      },
    });
    const reduced: ArchitectureSnapshot = {
      sourceFiles: 2,
      cycles: [],
      directEnvironmentModules: ['src/bootstrap.ts'],
      typeEscapes: {
        explicitAny: 3,
        anyAssertions: 1,
        nonNullAssertions: 3,
        typescriptSuppressions: 0,
      },
    };

    expect(evaluateArchitecturePolicy(reduced, baseline)).toEqual([]);
  });

  it('rejects new cycle members and type-escape budget increases', () => {
    const baseline = createArchitectureBaseline({
      sourceFiles: 2,
      cycles: [['src/a.ts', 'src/b.ts']],
      directEnvironmentModules: ['src/bootstrap.ts'],
      typeEscapes: {
        explicitAny: 1,
        anyAssertions: 1,
        nonNullAssertions: 1,
        typescriptSuppressions: 0,
      },
    });
    const regressed: ArchitectureSnapshot = {
      sourceFiles: 3,
      cycles: [['src/a.ts', 'src/c.ts']],
      directEnvironmentModules: ['src/bootstrap.ts', 'src/runtime.ts'],
      typeEscapes: {
        explicitAny: 2,
        anyAssertions: 1,
        nonNullAssertions: 1,
        typescriptSuppressions: 1,
      },
    };

    expect(evaluateArchitecturePolicy(regressed, baseline)).toEqual([
      'New import cycle: src/a.ts -> src/c.ts',
      'Direct process.env access outside bootstrap boundary: src/runtime.ts',
      'Type escape budget exceeded: explicitAny 2 > 1',
      'Type escape budget exceeded: typescriptSuppressions 1 > 0',
    ]);
  });

  it('rejects malformed baseline data at the file boundary', () => {
    expect(() =>
      parseArchitectureBaseline({
        version: 1,
        sourceRoot: 'src',
        allowedCycles: [[]],
        maximumTypeEscapes: {
          explicitAny: -1,
        },
      })
    ).toThrow();
  });
});
