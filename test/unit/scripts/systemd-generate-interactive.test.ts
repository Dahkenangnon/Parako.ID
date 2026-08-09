import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dependencies = vi.hoisted(() => ({
  assertInteractiveTty: vi.fn(),
  executeCommand: vi.fn(),
  logInfo: vi.fn(),
  prompt: vi.fn(),
}));

vi.mock('inquirer', () => ({
  default: { prompt: dependencies.prompt },
}));
vi.mock('../../../scripts/manage/shared/file.js', () => ({
  default: '/srv/parako-id',
}));
vi.mock('../../../scripts/manage/shared/logger.js', () => ({
  log: { info: dependencies.logInfo },
}));
vi.mock('../../../scripts/manage/shared/utils.js', () => ({
  assertInteractiveTty: dependencies.assertInteractiveTty,
  executeCommand: dependencies.executeCommand,
}));

import {
  promptForConfig,
  resolveConfig,
} from '../../../scripts/manage/systemd/generate.js';

const ORIGINAL_ENV = { ...process.env };

type PromptQuestion = {
  default: string;
  name: string;
  validate: (input: string) => true | string;
};

const promptedConfig = {
  user: 'parako',
  workingDirectory: '/srv/parako-id',
  runtimeDirectory: '/srv/parako-id/runtime',
  envFile: '/srv/parako-id/runtime/.env',
  nodePath: '/opt/node/bin/node',
  serviceName: 'parako-id',
};

describe('systemd interactive configuration', () => {
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, USER: 'operator' };
    dependencies.executeCommand.mockResolvedValue({
      success: true,
      stdout: ' /opt/node/bin/node\n',
      stderr: '',
      exitCode: 0,
    });
    dependencies.prompt.mockResolvedValue(promptedConfig);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.clearAllMocks();
  });

  it('prompts with detected defaults and exposes strict field validators', async () => {
    await expect(promptForConfig()).resolves.toEqual(promptedConfig);

    expect(dependencies.assertInteractiveTty).toHaveBeenCalledWith(
      'systemd generate'
    );
    expect(dependencies.executeCommand).toHaveBeenCalledWith('which', ['node']);

    const questions = dependencies.prompt.mock
      .calls[0]?.[0] as PromptQuestion[];
    const byName = Object.fromEntries(
      questions.map(question => [question.name, question])
    ) as Record<string, PromptQuestion>;

    expect(byName.serviceName?.default).toBe('parako-id');
    expect(byName.serviceName?.validate('')).toBe('Service name is required');
    expect(byName.serviceName?.validate('../bad')).toContain(
      'only lowercase letters'
    );
    expect(byName.serviceName?.validate('parako-id')).toBe(true);

    expect(byName.user?.default).toBe('operator');
    expect(byName.user?.validate('')).toBe('Service user is required');
    expect(byName.user?.validate('bad user')).toContain(
      'unsupported characters'
    );
    expect(byName.user?.validate('_parako')).toBe(true);

    for (const name of [
      'workingDirectory',
      'envFile',
      'runtimeDirectory',
      'nodePath',
    ]) {
      const question = byName[name]!;
      expect(question.validate('')).toContain('required');
      expect(question.validate('relative/path')).toContain('absolute path');
      expect(question.validate('/safe/path\nInjected=true')).toContain(
        'whitespace or control characters'
      );
      expect(question.validate('/safe/path')).toBe(true);
    }
    expect(byName.nodePath?.default).toBe('/opt/node/bin/node');
  });

  it('uses safe fallbacks when the service user and Node path are not detected', async () => {
    delete process.env.USER;
    dependencies.executeCommand.mockResolvedValue({
      success: false,
      stdout: '',
      stderr: 'not found',
      exitCode: 1,
    });

    await promptForConfig();

    const questions = dependencies.prompt.mock
      .calls[0]?.[0] as PromptQuestion[];
    const byName = Object.fromEntries(
      questions.map(question => [question.name, question])
    ) as Record<string, PromptQuestion>;
    expect(byName.user?.default).toBe('parako');
    expect(byName.nodePath?.default).toBe('/usr/bin/node');
  });

  it('uses complete flags and prompts only when required flags are incomplete', async () => {
    const options = {
      user: 'parako',
      dir: '/opt/parako-id/current',
      runtimeDir: '/opt/parako-id/runtime',
      envFile: '/opt/parako-id/runtime/.env',
      nodePath: '/usr/bin/node',
    };

    await expect(resolveConfig(options)).resolves.toMatchObject({
      serviceName: 'parako-id',
      workingDirectory: options.dir,
    });
    expect(dependencies.logInfo).toHaveBeenCalledWith(
      'Using configuration from flags'
    );
    expect(dependencies.prompt).not.toHaveBeenCalled();

    await expect(resolveConfig({ user: 'parako' })).resolves.toEqual(
      promptedConfig
    );
    expect(dependencies.prompt).toHaveBeenCalledOnce();
  });
});
