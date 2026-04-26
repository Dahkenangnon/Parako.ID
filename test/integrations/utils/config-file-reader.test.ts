import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigFileReader } from '../../../src/utils/config-file-reader';
import type { IFileSystemUtils } from '../../../src/di/interfaces/file-system-utils.interface.js';

/**
 * Helper: create a ConfigFileReader instance with a mock rootDir
 * Bypasses DI by constructing via Object.create + manual property assignment
 */
function createReader(rootDir: string): ConfigFileReader {
  const reader = Object.create(ConfigFileReader.prototype) as ConfigFileReader;
  // Assign the minimal mock — only rootDir is used by the class
  (reader as any).fileSystemUtils = { rootDir } as IFileSystemUtils;
  return reader;
}

describe('ConfigFileReader', () => {
  let tmpDir: string;
  let reader: ConfigFileReader;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfr-test-'));
    reader = createReader(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // readJsoncFile
  // ==========================================================================
  describe('readJsoncFile', () => {
    it('should parse valid JSONC with comments and trailing commas', () => {
      const content = `{
        // line comment
        "name": "test",
        /* block comment */
        "value": 42,
      }`;
      const filePath = path.join(tmpDir, 'test.jsonc');
      fs.writeFileSync(filePath, content);

      const result = reader.readJsoncFile(filePath);
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should throw on missing file by default', () => {
      const filePath = path.join(tmpDir, 'nonexistent.jsonc');
      expect(() => reader.readJsoncFile(filePath)).toThrow(
        /Failed to read JSONC file/
      );
    });

    it('should return {} with throwOnError: false for missing file', () => {
      const filePath = path.join(tmpDir, 'nonexistent.jsonc');
      const result = reader.readJsoncFile(filePath, {
        throwOnError: false,
      });
      expect(result).toEqual({});
    });

    it('should throw on invalid syntax', () => {
      const filePath = path.join(tmpDir, 'bad.jsonc');
      fs.writeFileSync(filePath, '{{{invalid');
      expect(() => reader.readJsoncFile(filePath)).toThrow(
        /JSONC parsing errors/
      );
    });

    it('should parse nested structures and arrays', () => {
      const content = `{
        "db": {
          "hosts": ["localhost", "127.0.0.1"],
          "port": 5432,
        },
      }`;
      const filePath = path.join(tmpDir, 'nested.jsonc');
      fs.writeFileSync(filePath, content);

      const result = reader.readJsoncFile(filePath);
      expect(result.db.hosts).toEqual(['localhost', '127.0.0.1']);
      expect(result.db.port).toBe(5432);
    });
  });

  // ==========================================================================
  // readJsoncFileAsync
  // ==========================================================================
  describe('readJsoncFileAsync', () => {
    it('should parse valid JSONC asynchronously', async () => {
      const content = `{
        // async test
        "async": true,
        "count": 7,
      }`;
      const filePath = path.join(tmpDir, 'async.jsonc');
      fs.writeFileSync(filePath, content);

      const result = await reader.readJsoncFileAsync(filePath);
      expect(result).toEqual({ async: true, count: 7 });
    });

    it('should throw on missing file by default', async () => {
      const filePath = path.join(tmpDir, 'missing.jsonc');
      await expect(reader.readJsoncFileAsync(filePath)).rejects.toThrow(
        /Failed to read JSONC file/
      );
    });

    it('should return {} with throwOnError: false for missing file', async () => {
      const filePath = path.join(tmpDir, 'missing.jsonc');
      const result = await reader.readJsoncFileAsync(filePath, {
        throwOnError: false,
      });
      expect(result).toEqual({});
    });

    it('should throw on invalid syntax', async () => {
      const filePath = path.join(tmpDir, 'bad-async.jsonc');
      fs.writeFileSync(filePath, '{ not: valid: json }');
      await expect(reader.readJsoncFileAsync(filePath)).rejects.toThrow(
        /JSONC parsing errors/
      );
    });
  });

  // ==========================================================================
  // readYamlFile
  // ==========================================================================
  describe('readYamlFile', () => {
    it('should parse valid YAML', () => {
      const content = `
name: test
value: 42
`;
      const filePath = path.join(tmpDir, 'test.yaml');
      fs.writeFileSync(filePath, content);

      const result = reader.readYamlFile(filePath);
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should parse nested structures and arrays', () => {
      const content = `
database:
  hosts:
    - localhost
    - 127.0.0.1
  port: 5432
  options:
    ssl: true
    pool_size: 10
`;
      const filePath = path.join(tmpDir, 'nested.yaml');
      fs.writeFileSync(filePath, content);

      const result = reader.readYamlFile(filePath);
      expect(result.database.hosts).toEqual(['localhost', '127.0.0.1']);
      expect(result.database.port).toBe(5432);
      expect(result.database.options.ssl).toBe(true);
      expect(result.database.options.pool_size).toBe(10);
    });

    it('should throw on missing file by default', () => {
      const filePath = path.join(tmpDir, 'missing.yaml');
      expect(() => reader.readYamlFile(filePath)).toThrow(
        /Failed to read YAML file/
      );
    });

    it('should return {} with throwOnError: false for missing file', () => {
      const filePath = path.join(tmpDir, 'missing.yaml');
      const result = reader.readYamlFile(filePath, {
        throwOnError: false,
      });
      expect(result).toEqual({});
    });
  });

  // ==========================================================================
  // readYamlFileAsync
  // ==========================================================================
  describe('readYamlFileAsync', () => {
    it('should parse valid YAML asynchronously', async () => {
      const content = `
async: true
items:
  - one
  - two
`;
      const filePath = path.join(tmpDir, 'async.yaml');
      fs.writeFileSync(filePath, content);

      const result = await reader.readYamlFileAsync(filePath);
      expect(result).toEqual({ async: true, items: ['one', 'two'] });
    });

    it('should throw on missing file by default', async () => {
      const filePath = path.join(tmpDir, 'missing.yaml');
      await expect(reader.readYamlFileAsync(filePath)).rejects.toThrow(
        /Failed to read YAML file/
      );
    });

    it('should return {} with throwOnError: false for missing file', async () => {
      const filePath = path.join(tmpDir, 'missing.yaml');
      const result = await reader.readYamlFileAsync(filePath, {
        throwOnError: false,
      });
      expect(result).toEqual({});
    });
  });

  // ==========================================================================
  // readAppConfig — auto-detection priority: .yaml > .yml > .jsonc > .json
  // ==========================================================================
  describe('readAppConfig', () => {
    it('should prefer .yaml over .yml, .jsonc, .json', () => {
      fs.writeFileSync(path.join(tmpDir, 'parako.yaml'), 'source: yaml\n');
      fs.writeFileSync(path.join(tmpDir, 'parako.yml'), 'source: yml\n');
      fs.writeFileSync(
        path.join(tmpDir, 'parako.jsonc'),
        '{ "source": "jsonc" }'
      );
      fs.writeFileSync(
        path.join(tmpDir, 'parako.json'),
        '{ "source": "json" }'
      );

      const result = reader.readAppConfig();
      expect(result.source).toBe('yaml');
    });

    it('should fall back to .yml when .yaml is absent', () => {
      fs.writeFileSync(path.join(tmpDir, 'parako.yml'), 'source: yml\n');
      fs.writeFileSync(
        path.join(tmpDir, 'parako.jsonc'),
        '{ "source": "jsonc" }'
      );

      const result = reader.readAppConfig();
      expect(result.source).toBe('yml');
    });

    it('should fall back to .jsonc when YAML files are absent', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'parako.jsonc'),
        '{ "source": "jsonc" }'
      );
      fs.writeFileSync(
        path.join(tmpDir, 'parako.json'),
        '{ "source": "json" }'
      );

      const result = reader.readAppConfig();
      expect(result.source).toBe('jsonc');
    });

    it('should fall back to .json when others are absent', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'parako.json'),
        '{ "source": "json" }'
      );

      const result = reader.readAppConfig();
      expect(result.source).toBe('json');
    });

    it('should throw when no config file exists', () => {
      expect(() => reader.readAppConfig()).toThrow(
        /App configuration file not found/
      );
    });

    it('should actually parse YAML format correctly', () => {
      const content = `
application:
  title: Test App
  locales:
    default: en
`;
      fs.writeFileSync(path.join(tmpDir, 'parako.yaml'), content);

      const result = reader.readAppConfig();
      expect(result.application.title).toBe('Test App');
      expect(result.application.locales.default).toBe('en');
    });

    it('should actually parse JSONC format correctly', () => {
      const content = `{
        // JSONC comment
        "application": {
          "title": "Test App",
        },
      }`;
      fs.writeFileSync(path.join(tmpDir, 'parako.jsonc'), content);

      const result = reader.readAppConfig();
      expect(result.application.title).toBe('Test App');
    });
  });

  // ==========================================================================
  // readAppConfigAsync
  // ==========================================================================
  describe('readAppConfigAsync', () => {
    it('should prefer .yaml over other formats (async)', async () => {
      fs.writeFileSync(path.join(tmpDir, 'parako.yaml'), 'source: yaml\n');
      fs.writeFileSync(
        path.join(tmpDir, 'parako.jsonc'),
        '{ "source": "jsonc" }'
      );

      const result = await reader.readAppConfigAsync();
      expect(result.source).toBe('yaml');
    });

    it('should fall back to .jsonc async', async () => {
      fs.writeFileSync(
        path.join(tmpDir, 'parako.jsonc'),
        '{ "source": "jsonc" }'
      );

      const result = await reader.readAppConfigAsync();
      expect(result.source).toBe('jsonc');
    });

    it('should throw when no config file exists (async)', async () => {
      await expect(reader.readAppConfigAsync()).rejects.toThrow(
        /App configuration file not found/
      );
    });
  });

  // ==========================================================================
  // readParakoRpConfig
  // ==========================================================================
  describe('readParakoRpConfig', () => {
    it('should read parako-rp.jsonc file', () => {
      const content = `{
        // RP config
        "clients": [{ "id": "test-client" }],
      }`;
      fs.writeFileSync(path.join(tmpDir, 'parako-rp.jsonc'), content);

      const result = reader.readParakoRpConfig();
      expect(result.clients).toHaveLength(1);
      expect(result.clients[0].id).toBe('test-client');
    });

    it('should throw when parako-rp.jsonc is missing', () => {
      expect(() => reader.readParakoRpConfig()).toThrow(
        /Client registry configuration file not found/
      );
    });
  });

  // ==========================================================================
  // readParakoRpConfigAsync
  // ==========================================================================
  describe('readParakoRpConfigAsync', () => {
    it('should read parako-rp.jsonc file asynchronously', async () => {
      const content = `{
        "clients": [{ "id": "async-client" }],
      }`;
      fs.writeFileSync(path.join(tmpDir, 'parako-rp.jsonc'), content);

      const result = await reader.readParakoRpConfigAsync();
      expect(result.clients[0].id).toBe('async-client');
    });

    it('should throw when parako-rp.jsonc is missing (async)', async () => {
      await expect(reader.readParakoRpConfigAsync()).rejects.toThrow(
        /Client registry configuration file not found/
      );
    });
  });

  // ==========================================================================
  // isFileReadable
  // ==========================================================================
  describe('isFileReadable', () => {
    it('should return true for a readable file', () => {
      const filePath = path.join(tmpDir, 'readable.txt');
      fs.writeFileSync(filePath, 'hello');

      expect(reader.isFileReadable(filePath)).toBe(true);
    });

    it('should return false for a non-existent file', () => {
      const filePath = path.join(tmpDir, 'nonexistent.txt');
      expect(reader.isFileReadable(filePath)).toBe(false);
    });
  });

  // ==========================================================================
  // stripJsonComments
  // ==========================================================================
  describe('stripJsonComments', () => {
    it('should strip line comments and return clean JSON', () => {
      const input = `{
        // This is a comment
        "key": "value"
      }`;

      const result = reader.stripJsonComments(input);
      const parsed = JSON.parse(result);
      expect(parsed).toEqual({ key: 'value' });
    });

    it('should strip block comments and return clean JSON', () => {
      const input = `{
        /* block comment */
        "a": 1,
        "b": /* inline */ 2
      }`;

      const result = reader.stripJsonComments(input);
      const parsed = JSON.parse(result);
      expect(parsed).toEqual({ a: 1, b: 2 });
    });

    it('should handle trailing commas', () => {
      const input = `{
        "items": [1, 2, 3,],
        "nested": { "x": true, },
      }`;

      const result = reader.stripJsonComments(input);
      const parsed = JSON.parse(result);
      expect(parsed.items).toEqual([1, 2, 3]);
      expect(parsed.nested.x).toBe(true);
    });

    it('should return valid JSON string', () => {
      const input = '{ "simple": true }';
      const result = reader.stripJsonComments(input);
      expect(() => JSON.parse(result)).not.toThrow();
    });
  });
});
