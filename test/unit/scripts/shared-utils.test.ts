import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createBox,
  createTable,
  deepMerge,
  detectConfigValueType,
  findConfigKeys,
  generateSecureSecret,
  getAllConfigKeys,
  getConfigByPath,
  getPackageInfo,
  setConfigByPath,
  showSubcommandHelp,
  stripAnsi,
  truncateText,
  validateUrl,
  wrapText,
  convertValueType,
} from '../../../scripts/manage/shared/utils.js';

describe('shared management CLI utilities', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (Object.prototype as Record<string, unknown>).polluted;
  });

  describe('package metadata', () => {
    it('reads the current package metadata', () => {
      expect(getPackageInfo()).toMatchObject({
        name: 'parako.id',
        version: expect.any(String),
      });
    });

    it('returns stable fallback metadata when package.json cannot be read', () => {
      vi.spyOn(fs, 'readFileSync').mockImplementationOnce(() => {
        throw new Error('unreadable');
      });

      expect(getPackageInfo()).toMatchObject({
        name: 'parako.id',
        version: '0.0.1',
        homepage: 'https://parako.id',
        repository: { url: 'https://github.com/Dahkenangnon/Parako.ID' },
      });
    });
  });

  describe('text and layout', () => {
    it('strips ANSI escapes and preserves plain text', () => {
      expect(stripAnsi('\u001b[31mDanger\u001b[0m')).toBe('Danger');
      expect(stripAnsi('plain')).toBe('plain');
    });

    it('returns short text unchanged and truncates visible ANSI text', () => {
      expect(truncateText('short', 8)).toBe('short');
      const truncated = truncateText('\u001b[31mabcdefghij\u001b[0m', 8);
      expect(stripAnsi(truncated)).toBe('abcde...');
      expect(stripAnsi(truncateText('abcdef', 3))).toBe('...');
      expect(stripAnsi(truncateText('abcdef', 2))).toBe('..');
    });

    it('counts unrecognized escape characters as visible text without hanging', () => {
      expect(stripAnsi(truncateText('\u001bXabcdef', 6)).endsWith('...')).toBe(
        true
      );
    });

    it('wraps words, truncates oversized words, and preserves short input', () => {
      expect(wrapText('short text', 20)).toEqual(['short text']);
      expect(wrapText('one two three four', 7)).toEqual([
        'one two',
        'three',
        'four',
      ]);
      expect(wrapText('oversizedword next', 8).map(stripAnsi)).toEqual([
        'overs...',
        'next',
      ]);
      expect(wrapText('oversizedword', 8).map(stripAnsi)).toEqual(['overs...']);
    });

    it('creates bounded boxes with blank and wrapped content', () => {
      const minimum = stripAnsi(
        createBox(['', 'a long line that must wrap'], 10)
      );
      const lines = minimum.split('\n');
      expect(lines[0]).toHaveLength(40);
      expect(lines.at(-1)).toHaveLength(40);
      expect(lines).toContain(`│${' '.repeat(38)}│`);

      const maximum = stripAnsi(createBox(['content'], 500));
      expect(maximum.split('\n')[0]).toHaveLength(120);
    });

    it('returns an empty table without headers', () => {
      expect(createTable([], [['ignored']])).toBe('');
    });

    it('renders colored and plain tables with sparse and truncated rows', () => {
      const colored = stripAnsi(
        createTable(
          ['Name', 'Description'],
          [['alpha', 'a description that is deliberately too long'], ['beta']],
          { width: 55, colors: true, maxColumnWidth: 16 }
        )
      );
      expect(colored).toContain('Name');
      expect(colored).toContain('alpha');
      expect(colored).toContain('...');

      const plain = stripAnsi(
        createTable(['Only'], [['value']], {
          width: 40,
          colors: false,
          maxColumnWidth: 40,
        })
      );
      expect(plain).toContain('Only');
      expect(plain).toContain('value');
      expect(
        createTable(['A', 'B', 'C', 'D', 'E'], [], {
          width: 40,
          colors: false,
          maxColumnWidth: 8,
        })
      ).toContain('A');
    });
  });

  describe('validation and secrets', () => {
    it('validates required absolute URLs', () => {
      expect(validateUrl('')).toBe('URL is required');
      expect(validateUrl('https://parako.id/callback')).toBe(true);
      expect(validateUrl('not a URL')).toBe('Please enter a valid URL');
    });

    it('generates secrets using the requested number of random bytes', () => {
      expect(generateSecureSecret()).toMatch(/^[a-f0-9]{64}$/);
      expect(generateSecureSecret(4)).toMatch(/^[a-f0-9]{8}$/);
    });
  });

  describe('configuration objects', () => {
    it('deep-merges nested objects while replacing arrays and scalar targets', () => {
      const target = {
        nested: { keep: true, replace: 'old' as unknown },
        list: ['old'],
      };

      expect(
        deepMerge(target, {
          nested: { replace: { deep: true } },
          list: ['new'],
        })
      ).toEqual({
        nested: { keep: true, replace: { deep: true } },
        list: ['new'],
      });
      expect(target).toEqual({
        nested: { keep: true, replace: 'old' },
        list: ['old'],
      });
    });

    it('blocks prototype-pollution keys during deep merge', () => {
      const source = JSON.parse(
        '{"safe":true,"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"prototype":{"polluted":true}}'
      );

      expect(deepMerge({}, source)).toEqual({ safe: true });
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('gets and creates nested configuration paths', () => {
      const config: Record<string, unknown> = {
        existing: { value: 1 },
        replace: 'scalar',
      };
      expect(getConfigByPath(config, 'existing.value')).toBe(1);
      expect(getConfigByPath(config, 'missing.value')).toBeUndefined();
      expect(setConfigByPath(config, 'replace.deep.value', 2)).toBe(config);
      expect(config.replace).toEqual({ deep: { value: 2 } });
      setConfigByPath(config, 'existing.second', 2);
      expect(config.existing).toEqual({ value: 1, second: 2 });
    });

    it('rejects unsafe nested paths instead of mutating object prototypes', () => {
      expect(() => setConfigByPath({}, '__proto__.polluted', true)).toThrow(
        /unsafe configuration path/i
      );
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it('finds matching and all nested object keys without descending arrays', () => {
      const config = {
        server: { publicUrl: 'https://parako.id', port: 9000 },
        clients: [{ id: 'one' }],
      };
      expect(findConfigKeys('PUBLIC', config)).toEqual(['server.publicUrl']);
      expect(findConfigKeys('server', config, 'root')).toEqual([
        'root.server',
        'root.server.publicUrl',
        'root.server.port',
      ]);
      expect(getAllConfigKeys(config)).toEqual([
        'server',
        'server.publicUrl',
        'server.port',
        'clients',
      ]);
      expect(getAllConfigKeys({ nested: { value: true } }, 'root')).toEqual([
        'root.nested',
        'root.nested.value',
      ]);
    });
  });

  describe('type conversion', () => {
    it.each([
      [undefined, 'null'],
      [null, 'null'],
      [[], 'array'],
      [{}, 'object'],
      [true, 'boolean'],
      [1, 'number'],
      ['value', 'string'],
    ])('detects %# as %s', (value, expected) => {
      expect(detectConfigValueType(value)).toBe(expected);
    });

    it.each([
      ['null', null],
      ['undefined', null],
      ['true', true],
      ['false', false],
      ['42', 42],
      ['1.5', 1.5],
      ['{"enabled":true}', { enabled: true }],
      ['[1,2]', [1, 2]],
      ['plain text', 'plain text'],
    ])('converts %j to its intended runtime type', (value, expected) => {
      expect(convertValueType(value)).toEqual(expected);
    });
  });

  it('renders every optional help section and omits absent optional sections', () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    showSubcommandHelp({
      name: 'Client',
      icon: '🔐',
      description: 'Manage OIDC clients',
      version: '1.2.3',
      quickStart: [
        { command: 'client add', description: 'Add one', time: '1m' },
        { command: 'client list', description: 'List all' },
      ],
      examples: [{ command: 'client list', description: 'List clients' }],
      features: [{ icon: '✓', title: 'Safe', description: 'Validated input' }],
      tips: ['Use HTTPS'],
      fileInfo: {
        configFile: 'runtime/.env',
        backupDir: 'runtime/backups',
        logFile: 'runtime/logs/cli.log',
      },
    });
    showSubcommandHelp({
      name: 'Keys',
      icon: '🔑',
      description: 'Manage keys',
      version: '1.0.0',
      examples: [],
      fileInfo: {},
    });
    showSubcommandHelp({
      name: 'System',
      icon: '🖥️',
      description: 'Inspect the system',
      version: '1.0.0',
      examples: [],
    });

    const output = consoleLog.mock.calls.flat().join('\n');
    expect(output).toContain('QUICK START');
    expect(output).toContain('FEATURES');
    expect(output).toContain('TIPS');
    expect(output).toContain('FILES');
    expect(output).toContain('runtime/.env');
    expect(output).toContain('runtime/backups');
    expect(output).toContain('runtime/logs/cli.log');
    expect(output).toContain('pnpm keys --help');
  });
});
