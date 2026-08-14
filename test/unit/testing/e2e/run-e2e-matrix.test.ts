import { describe, expect, it, vi } from 'vitest';

import {
  buildMatrixInfrastructurePlan,
  runMatrixInfrastructureCli,
  runMatrixInfrastructurePlan,
} from '../../../../scripts/testing/run-e2e-matrix.js';
import { E2E_PROFILES } from '../../../e2e/config/matrix.js';

describe('E2E deployment matrix runner', () => {
  it('keeps every configuration-specific spec out of the default profile', () => {
    const configurationSpecificSpecs = Object.values(E2E_PROFILES)
      .filter(profile => profile.id !== 'default')
      .flatMap(profile => profile.testMatch ?? []);

    expect(E2E_PROFILES.default.testIgnore).toEqual(
      expect.arrayContaining(configurationSpecificSpecs)
    );
  });

  it('rejects a missing PostgreSQL administrator URL before running tests', () => {
    expect(() => buildMatrixInfrastructurePlan({})).toThrow(
      /PARAKO_E2E_POSTGRESQL_URL/
    );
  });

  it.each([
    'mysql://operator:secret@127.0.0.1/parako',
    'postgresql://127.0.0.1',
    'postgresql://operator@/parako',
  ])('rejects an unusable PostgreSQL URL: %s', postgresqlUrl => {
    expect(() =>
      buildMatrixInfrastructurePlan({
        PARAKO_E2E_POSTGRESQL_URL: postgresqlUrl,
      })
    ).toThrow(/valid PostgreSQL administrator URL/);
  });

  it('builds a deterministic PostgreSQL-generated matrix infrastructure plan', () => {
    const plan = buildMatrixInfrastructurePlan({
      PARAKO_E2E_POSTGRESQL_URL:
        'postgresql://operator:secret@127.0.0.1:5432/parako_e2e', // gitleaks:allow -- non-routable test fixture
    });

    expect(plan[0]).toEqual({
      command: 'pnpm',
      args: ['run', 'db:generate:pg'],
    });
    expect(plan[1]).toEqual({ command: 'pnpm', args: ['run', 'build'] });
    expect(plan[2]).toEqual({
      command: 'pnpm',
      args: ['exec', 'playwright', 'test', '--config=playwright.config.ts'],
      environment: {
        PARAKO_E2E_PROFILE: 'self-starting',
        PARAKO_E2E_POSTGRESQL_URL:
          'postgresql://operator:secret@127.0.0.1:5432/parako_e2e',
      },
    });

    const profileCommands = plan.slice(3);
    expect(profileCommands).toHaveLength(65);
    expect(
      new Set(profileCommands.map(command => command.args.at(-1)))
    ).toEqual(new Set(['--config=playwright.config.ts']));
    expect(
      new Set(
        profileCommands.map(command => command.environment?.PARAKO_E2E_PROFILE)
      )
    ).toEqual(
      new Set([
        'default',
        'database-configuration',
        'notification-policy',
        'phone-verification',
        'security-questions',
        'sms-recovery',
        'social',
        'social-policy-max',
        'social-policy-restricted',
        'background-jobs',
        'worker-drain',
        'operations',
        'webauthn',
      ])
    );
    expect(
      profileCommands.filter(
        command => command.environment?.PARAKO_E2E_STORAGE_ADAPTER === 'sqlite'
      )
    ).toHaveLength(13);
    expect(
      profileCommands.filter(
        command => command.environment?.PARAKO_E2E_STORAGE_ADAPTER === 'mongodb'
      )
    ).toHaveLength(26);
    expect(
      profileCommands.filter(
        command =>
          command.environment?.PARAKO_E2E_STORAGE_ADAPTER === 'postgresql'
      )
    ).toHaveLength(26);
    expect(
      profileCommands.filter(
        command =>
          command.environment?.PARAKO_E2E_PROFILE === 'database-configuration'
      )
    ).toHaveLength(5);
    expect(E2E_PROFILES['database-configuration']).toEqual({
      id: 'database-configuration',
      testMatch: ['admin-configuration.spec.ts'],
      environment: {
        PARAKO_E2E_DATABASE_CONFIG: 'true',
        PARAKO_E2E_SIBLING_TENANT_ID: 'browser-e2e-sibling',
      },
    });
    expect(
      profileCommands.filter(
        command => command.environment?.PARAKO_E2E_PROFILE === 'background-jobs'
      )
    ).toHaveLength(5);
    expect(E2E_PROFILES['background-jobs']).toMatchObject({
      testMatch: ['admin-data-import.spec.ts', 'admin-jwks-scheduler.spec.ts'],
      environment: { PARAKO_E2E_BACKGROUND_JOBS: 'true' },
    });
    expect(
      profileCommands.filter(
        command => command.environment?.PARAKO_E2E_PROFILE === 'worker-drain'
      )
    ).toHaveLength(5);
    expect(E2E_PROFILES['worker-drain']).toMatchObject({
      testMatch: ['worker-graceful-shutdown.spec.ts'],
      environment: {
        PARAKO_E2E_BACKGROUND_JOBS: 'true',
        PARAKO_E2E_WORKER_DRAIN: 'true',
      },
    });
    expect(E2E_PROFILES.default.testIgnore).toContain(
      'worker-graceful-shutdown.spec.ts'
    );
    expect(
      profileCommands.filter(
        command => command.environment?.PARAKO_E2E_PROFILE === 'operations'
      )
    ).toHaveLength(5);
    expect(E2E_PROFILES.operations).toEqual({
      id: 'operations',
      testMatch: ['ops-infrastructure.spec.ts'],
      environment: {
        PARAKO_E2E_OPERATIONS: 'true',
        PARAKO_E2E_HMAC_SECRET: 'parako-browser-e2e-ops-hmac-secret',
      },
    });
    expect(profileCommands.at(-1)?.environment).toMatchObject({
      PARAKO_E2E_STORAGE_ADAPTER: 'postgresql',
      PARAKO_E2E_MULTI_TENANCY: 'true',
      PARAKO_E2E_POSTGRESQL_URL:
        'postgresql://operator:secret@127.0.0.1:5432/parako_e2e',
      PARAKO_E2E_TENANT_ID: 'browser-e2e',
      PARAKO_E2E_IDP_ORIGIN: 'http://browser-e2e.idp.localhost:19007',
      PARAKO_E2E_DEPLOYMENT_URL: 'http://idp.localhost:19007',
      PARAKO_E2E_CELL: 'postgresql-multi',
      PARAKO_E2E_PROFILE: 'webauthn',
    });
  });

  it('stops at the first failed command and returns its exit status', () => {
    const plan = buildMatrixInfrastructurePlan({
      PARAKO_E2E_POSTGRESQL_URL:
        'postgresql://operator:secret@127.0.0.1:5432/parako_e2e', // gitleaks:allow -- non-routable test fixture
    });
    const execute = vi
      .fn()
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce({ status: 7 });

    expect(runMatrixInfrastructurePlan(plan, execute)).toBe(7);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('treats a terminated command as a runner failure', () => {
    const execute = vi.fn().mockReturnValue({ status: null });

    expect(
      runMatrixInfrastructurePlan(
        [{ command: 'pnpm', args: ['run', 'build'] }],
        execute
      )
    ).toBe(1);
  });

  it('reports prerequisite failures without invoking a command', () => {
    const execute = vi.fn();
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(runMatrixInfrastructureCli({}, execute)).toBe(1);
    expect(execute).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      expect.stringContaining('PARAKO_E2E_POSTGRESQL_URL')
    );

    reportError.mockRestore();
  });

  it('returns success only after every planned command succeeds', () => {
    const execute = vi.fn().mockReturnValue({ status: 0 });

    expect(
      runMatrixInfrastructureCli(
        {
          PARAKO_E2E_POSTGRESQL_URL:
            'postgresql://operator:secret@127.0.0.1:5432/parako_e2e', // gitleaks:allow -- non-routable test fixture
        },
        execute
      )
    ).toBe(0);
    expect(execute).toHaveBeenCalledTimes(68);
  });
});
