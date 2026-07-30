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
});
