import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const entrypoint = vi.hoisted(() => ({
  isMain: false,
  parseAsync: vi.fn(),
}));

vi.mock('../../../scripts/manage/shared/entrypoint.js', () => ({
  isMainModule: () => entrypoint.isMain,
}));
vi.mock('../../../scripts/manage/database.js', () => ({
  findProjectRoot: vi.fn(),
  loadRuntimeEnvironment: vi.fn(),
}));
vi.mock('../../../scripts/manage/shared/operator-audit.js', () => ({
  writeOperatorAudit: vi.fn(),
}));
vi.mock('../../../scripts/manage/shared/redis-config.js', () => ({
  resolveRedisDiagnosticConfig: vi.fn(),
}));
vi.mock('../../../scripts/manage/shared/utils.js', () => ({
  getPackageInfo: () => ({ version: '0.0.0-test' }),
}));
vi.mock('express-rate-limit', () => ({ ipKeyGenerator: vi.fn() }));
vi.mock('ioredis', () => ({ Redis: vi.fn() }));
vi.mock('commander', () => ({
  Command: class {
    name(): this {
      return this;
    }

    description(): this {
      return this;
    }

    version(): this {
      return this;
    }

    command(): this {
      return this;
    }

    requiredOption(): this {
      return this;
    }

    option(): this {
      return this;
    }

    action(): this {
      return this;
    }

    parseAsync(argv: string[]): Promise<void> {
      return entrypoint.parseAsync(argv);
    }
  },
}));

describe('security CLI process entrypoint', () => {
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    entrypoint.isMain = false;
    entrypoint.parseAsync.mockReset();
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it('runs automatically when evaluated as the process entrypoint', async () => {
    entrypoint.isMain = true;
    vi.resetModules();

    // Re-evaluation is required to exercise the ESM process-entrypoint guard.
    await import('../../../scripts/manage/security.js');

    await vi.waitFor(() => expect(entrypoint.parseAsync).toHaveBeenCalled());
  });
});
