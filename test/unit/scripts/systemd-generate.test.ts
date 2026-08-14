import { describe, expect, it } from 'vitest';
import {
  generateUnitFiles,
  getConfigFromFlags,
} from '../../../scripts/manage/systemd/generate.js';

const config = {
  user: 'parako',
  workingDirectory: '/opt/parako-id/current',
  runtimeDirectory: '/opt/parako-id/runtime',
  envFile: '/opt/parako-id/runtime/.env',
  nodePath: '/opt/parako-id/current/node/bin/node',
  serviceName: 'parako-id',
};

describe('systemd unit generation', () => {
  it('requires an explicit mutable runtime directory in non-interactive mode', () => {
    expect(
      getConfigFromFlags({
        user: 'parako',
        dir: config.workingDirectory,
        envFile: config.envFile,
        nodePath: config.nodePath,
      })
    ).toBeNull();
    expect(
      getConfigFromFlags({
        user: 'parako',
        dir: config.workingDirectory,
        runtimeDir: config.runtimeDirectory,
        envFile: config.envFile,
        nodePath: config.nodePath,
      })
    ).toMatchObject(config);
  });

  it('accepts the Commander property produced by --environment-file', () => {
    expect(
      getConfigFromFlags({
        user: 'parako',
        dir: config.workingDirectory,
        runtimeDir: config.runtimeDirectory,
        environmentFile: config.envFile,
        nodePath: config.nodePath,
      })
    ).toMatchObject(config);
  });

  it('rejects path traversal in a non-interactive service name', () => {
    expect(() =>
      getConfigFromFlags({
        user: config.user,
        dir: config.workingDirectory,
        runtimeDir: config.runtimeDirectory,
        envFile: config.envFile,
        nodePath: config.nodePath,
        name: '../../malicious-unit',
      })
    ).toThrow(
      'Service name must start with a letter/digit and contain only lowercase letters, digits, dots, hyphens, or underscores'
    );
  });

  it('rejects directive injection in non-interactive path flags', () => {
    expect(() =>
      getConfigFromFlags({
        user: config.user,
        dir: `${config.workingDirectory}\nEnvironment=INJECTED=true`,
        runtimeDir: config.runtimeDirectory,
        envFile: config.envFile,
        nodePath: config.nodePath,
      })
    ).toThrow(
      'Working directory must not contain whitespace or control characters'
    );
  });

  it('rejects directive injection in the non-interactive service user', () => {
    expect(() =>
      getConfigFromFlags({
        user: `${config.user}\nEnvironment=INJECTED=true`,
        dir: config.workingDirectory,
        runtimeDir: config.runtimeDirectory,
        envFile: config.envFile,
        nodePath: config.nodePath,
      })
    ).toThrow('Service user contains unsupported characters');
  });

  it('rejects directive injection in non-interactive memory limits', () => {
    expect(() =>
      getConfigFromFlags({
        user: config.user,
        dir: config.workingDirectory,
        runtimeDir: config.runtimeDirectory,
        envFile: config.envFile,
        nodePath: config.nodePath,
        memoryApp: '1G\nEnvironment=INJECTED=true',
      })
    ).toThrow('Main app memory limit must be a single unit value');
  });

  it('uses the bundled runtime, blocks startup with pending migrations, and only writes runtime data', () => {
    const units = generateUnitFiles(config);

    expect(units.app).toContain(
      'ExecStartPre=/opt/parako-id/current/node/bin/node dist/scripts/manage/database.js status'
    );
    expect(units.app).toContain(
      'ExecStart=/opt/parako-id/current/node/bin/node'
    );
    expect(units.app).toContain('ReadWritePaths=/opt/parako-id/runtime');
    expect(units.app).toContain('ProtectSystem=strict');
    expect(units.app).toContain('ProtectHome=yes');
    expect(units.worker).toContain('ReadWritePaths=/opt/parako-id/runtime');
  });

  it('rejects unsafe configuration passed directly to unit generation', () => {
    expect(() =>
      generateUnitFiles({
        ...config,
        runtimeDirectory: `${config.runtimeDirectory}\nReadWritePaths=/`,
      })
    ).toThrow(
      'Runtime directory must not contain whitespace or control characters'
    );
  });

  it('falls back to the standard service name for legacy empty configuration', () => {
    const units = generateUnitFiles({ ...config, serviceName: '' });

    expect(units.app).toContain('SyslogIdentifier=parako-id');
    expect(units.worker).toContain('BindsTo=parako-id.service');
  });

  it('places restart rate limits in the systemd Unit section', () => {
    const units = generateUnitFiles(config);

    for (const unit of [units.app, units.worker]) {
      const [unitSection, serviceSection] = unit.split('[Service]');
      expect(unitSection).toContain('StartLimitBurst=10');
      expect(unitSection).toContain('StartLimitIntervalSec=300');
      expect(serviceSection).not.toContain('StartLimitBurst=10');
      expect(serviceSection).not.toContain('StartLimitIntervalSec=300');
    }
  });
});
