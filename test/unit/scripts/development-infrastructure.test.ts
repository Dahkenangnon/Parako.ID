import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ensureDevelopmentTestInfrastructure,
  createLocalDevelopmentInfrastructureAdapter,
  type DevelopmentInfrastructureAdapter,
  type DevelopmentInfrastructureSystem,
} from '../../../scripts/testing/development-infrastructure.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('development test infrastructure', () => {
  it('persists reusable PostgreSQL and Redis settings after provisioning', async () => {
    const root = mkdtempSync(join(tmpdir(), 'parako-test-infrastructure-'));
    temporaryRoots.push(root);
    mkdirSync(join(root, 'runtime'));
    writeFileSync(
      join(root, 'runtime/.env'),
      'REDIS_HOST=127.0.0.1\nREDIS_PORT=6379\nREDIS_DATABASE=0\n'
    );
    const postgresqlUrl = 'postgresql://parako@127.0.0.1:55432/parako_e2e';
    const adapter: DevelopmentInfrastructureAdapter = {
      ensurePostgresql: vi.fn().mockResolvedValue(postgresqlUrl),
      ensureRedis: vi.fn().mockResolvedValue(undefined),
    };

    await expect(
      ensureDevelopmentTestInfrastructure({
        root,
        environment: {
          REDIS_HOST: '127.0.0.1',
          REDIS_PORT: '6379',
          REDIS_DATABASE: '0',
        },
        adapter,
      })
    ).resolves.toMatchObject({
      postgresqlUrl,
      redis: { host: '127.0.0.1', port: 6379, database: 15 },
    });

    expect(adapter.ensurePostgresql).toHaveBeenCalledWith({
      configuredUrl: undefined,
      root,
    });
    expect(adapter.ensureRedis).toHaveBeenCalledWith({
      root,
      config: { host: '127.0.0.1', port: 6379, database: 15 },
    });
    expect(readFileSync(join(root, 'runtime/.env'), 'utf8')).toContain(
      `PARAKO_E2E_POSTGRESQL_URL=${postgresqlUrl}`
    );
    expect(readFileSync(join(root, 'runtime/.env'), 'utf8')).toContain(
      'PARAKO_E2E_REDIS_DATABASE=15'
    );
  });

  it('creates an isolated PostgreSQL service without exposing its password in arguments', async () => {
    const root = mkdtempSync(join(tmpdir(), 'parako-managed-postgresql-'));
    temporaryRoots.push(root);
    const run = vi.fn((command: string, args: string[]) =>
      command.endsWith('pg_config')
        ? { status: 0, stdout: '/postgres/bin' }
        : command.endsWith('pg_ctl') && args[0] === 'status'
          ? { status: 3 }
          : { status: 0 }
    );
    const system: DevelopmentInfrastructureSystem = {
      createPostgresqlDatabase: vi.fn().mockResolvedValue(undefined),
      findCommand: vi.fn((name: string) =>
        name === 'pg_config' ? '/usr/bin/pg_config' : undefined
      ),
      isPortAvailable: vi
        .fn()
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true),
      probePostgresql: vi.fn().mockResolvedValue(undefined),
      probeRedis: vi.fn().mockResolvedValue(undefined),
      run,
    };
    const adapter = createLocalDevelopmentInfrastructureAdapter({
      randomSecret: () => 'a'.repeat(64),
      system,
    });

    const url = await adapter.ensurePostgresql({
      configuredUrl: undefined,
      root,
    });

    expect(new URL(url)).toMatchObject({
      hostname: '127.0.0.1',
      pathname: '/parako_e2e',
      port: '55433',
      username: 'parako_e2e',
    });
    expect(system.createPostgresqlDatabase).toHaveBeenCalledOnce();
    expect(system.probePostgresql).toHaveBeenCalledWith(url);
    const initdbCall = run.mock.calls.find(([command]) =>
      command.endsWith('initdb')
    );
    expect(initdbCall?.[1]).toContain('--pwfile');
    expect(initdbCall?.[1]).not.toContain('a'.repeat(64));
    const passwordArgument = initdbCall?.[1].indexOf('--pwfile') ?? -1;
    expect(initdbCall?.[1][passwordArgument + 1]).toBe(
      join(root, 'runtime/data/.test-postgresql-initial-password')
    );
    expect(
      readFileSync(
        join(root, 'runtime/data/test-postgresql/connection.json'),
        'utf8'
      )
    ).toContain(url);
  });

  it('starts an installed local Redis service from a private configuration', async () => {
    const root = mkdtempSync(join(tmpdir(), 'parako-managed-redis-'));
    temporaryRoots.push(root);
    const probeRedis = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection refused'))
      .mockResolvedValue(undefined);
    const run = vi.fn().mockReturnValue({ status: 0 });
    const system: DevelopmentInfrastructureSystem = {
      createPostgresqlDatabase: vi.fn().mockResolvedValue(undefined),
      findCommand: vi.fn((name: string) =>
        name === 'redis-server' ? '/usr/bin/redis-server' : undefined
      ),
      isPortAvailable: vi.fn().mockResolvedValue(true),
      probePostgresql: vi.fn().mockResolvedValue(undefined),
      probeRedis,
      run,
    };
    const adapter = createLocalDevelopmentInfrastructureAdapter({ system });

    await adapter.ensureRedis({
      root,
      config: {
        host: '127.0.0.1',
        port: 56379,
        database: 15,
        password: 'local-test-password', // gitleaks:allow -- deterministic fixture
      },
    });

    const configuration = join(root, 'runtime/data/test-redis/redis.conf');
    expect(run).toHaveBeenCalledWith('/usr/bin/redis-server', [configuration]);
    expect(readFileSync(configuration, 'utf8')).toContain(
      'requirepass "local-test-password"'
    );
    expect(probeRedis).toHaveBeenCalledTimes(2);
  });
});
