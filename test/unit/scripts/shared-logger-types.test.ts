import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import rootDir, {
  rootDir as namedRootDir,
} from '../../../scripts/manage/shared/file.js';
import { log } from '../../../scripts/manage/shared/logger.js';
import {
  BOX_DRAWING,
  COMMAND_SHORTCUTS,
  DEFAULT_BOX_WIDTH,
  SUB_CLIS,
} from '../../../scripts/manage/shared/types.js';

describe('shared management CLI logger', () => {
  const originalDebug = process.env.DEBUG;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalDebug === undefined) {
      delete process.env.DEBUG;
    } else {
      process.env.DEBUG = originalDebug;
    }
  });

  it.each([
    ['info', 'ℹ', 'information'],
    ['success', '✓', 'success'],
    ['warning', '⚠', 'warning'],
    ['error', '✗', 'error'],
    ['progress', '⏳', 'progress'],
  ] as const)('writes the %s marker and message', (method, marker, message) => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    log[method](message);

    expect(consoleLog).toHaveBeenCalledOnce();
    expect(consoleLog).toHaveBeenCalledWith(marker, message);
  });

  it.each(['subtitle', 'highlight', 'dim'] as const)(
    'writes the styled %s message as one console argument',
    method => {
      const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

      log[method]('message');

      expect(consoleLog).toHaveBeenCalledOnce();
      expect(consoleLog).toHaveBeenCalledWith('message');
    }
  );

  it('writes a title followed by its fixed-width divider', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});

    log.title('title');

    expect(consoleLog.mock.calls).toEqual([['\n🔧 title'], ['━'.repeat(60)]]);
  });

  it('only writes debug messages when debugging is enabled', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    delete process.env.DEBUG;

    log.debug('hidden');
    expect(consoleLog).not.toHaveBeenCalled();

    process.env.DEBUG = '1';
    log.debug('visible');
    expect(consoleLog).toHaveBeenCalledOnce();
    expect(consoleLog).toHaveBeenCalledWith('🐛', 'visible');
  });
});

describe('shared management CLI constants', () => {
  it('exports the current project root consistently', () => {
    expect(rootDir).toBe(process.cwd());
    expect(namedRootDir).toBe(rootDir);
  });

  it('defines the console layout contract', () => {
    expect(DEFAULT_BOX_WIDTH).toBe(80);
    expect(BOX_DRAWING).toEqual({
      topLeft: '╭',
      topRight: '╮',
      bottomLeft: '╰',
      bottomRight: '╯',
      horizontal: '─',
      vertical: '│',
      cross: '┼',
      teeUp: '┴',
      teeDown: '┬',
      teeLeft: '┤',
      teeRight: '├',
    });
  });

  it('maps every active management module and shortcut to a command', () => {
    expect(Object.keys(SUB_CLIS)).toEqual(['client', 'keys']);
    expect(SUB_CLIS.client.commands).toEqual({
      list: 'List all registered clients',
      add: 'Add a new OIDC client',
    });
    expect(SUB_CLIS.keys.commands).toEqual({
      generate: 'Generate JWKS keys interactively',
    });

    for (const shortcut of Object.values(COMMAND_SHORTCUTS)) {
      expect(SUB_CLIS[shortcut.module]?.commands).toHaveProperty(
        shortcut.command
      );
    }
  });

  it('maps every advertised management module to a packaged executable', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')
    ) as { bin: Record<string, string> };
    const packagedExecutables = new Set(Object.values(packageJson.bin));

    for (const config of Object.values(SUB_CLIS)) {
      expect(packagedExecutables).toContain(
        `./dist/scripts/manage/${config.script}`
      );
    }
  });
});
