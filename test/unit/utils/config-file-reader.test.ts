import nodeFs from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IFileSystemUtils } from '../../../src/di/interfaces/file-system-utils.interface.js';
import { ConfigFileReader } from '../../../src/utils/config-file-reader.js';

function createReader(rootDir = process.cwd()): ConfigFileReader {
  return new ConfigFileReader({ rootDir } as IFileSystemUtils);
}

describe('ConfigFileReader', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'parako-config-reader-'));
  });

  afterEach(async () => {
    delete process.env.PARAKO_CONFIG_READER_VALUE;
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('rejects malformed JSONC instead of serializing a partial parse', () => {
    const reader = createReader();

    expect(() => reader.stripJsonComments('{"broken":')).toThrow(
      'Failed to strip comments: JSONC parsing errors:'
    );
  });

  it('strips comments and trailing commas into formatted JSON', () => {
    const reader = createReader();

    expect(
      reader.stripJsonComments(`{
        // application name
        "name": "Parako.ID",
        "enabled": true,
      }`)
    ).toBe(`{
  "name": "Parako.ID",
  "enabled": true
}`);
  });

  it('parses JSONC synchronously and asynchronously with default options', async () => {
    const filePath = path.join(tempDir, 'config.jsonc');
    await fs.writeFile(
      filePath,
      `{
        // comments are supported
        "name": "Parako.ID",
        "ports": [9007,],
      }`
    );
    const reader = createReader();
    const expected = { name: 'Parako.ID', ports: [9007] };

    expect(reader.readJsoncFile(filePath)).toEqual(expected);
    await expect(reader.readJsoncFileAsync(filePath)).resolves.toEqual(
      expected
    );
  });

  it('honors strict parse options and reports location details', async () => {
    const filePath = path.join(tempDir, 'strict.jsonc');
    await fs.writeFile(
      filePath,
      `{
        // forbidden comment
        "enabled": true
      }`
    );
    const reader = createReader();
    const options = {
      parseOptions: {
        allowTrailingComma: false,
        disallowComments: true,
        allowEmptyContent: false,
      },
    };
    const parseErrorPattern =
      /JSONC parsing errors: Invalid Comment Token at offset \d+ \(length: \d+\)/;

    expect(() => reader.readJsoncFile(filePath, options)).toThrow(
      parseErrorPattern
    );
    await expect(reader.readJsoncFileAsync(filePath, options)).rejects.toThrow(
      parseErrorPattern
    );
  });

  it('returns an empty object when error throwing is disabled', async () => {
    const missingPath = path.join(tempDir, 'missing.jsonc');
    const reader = createReader();

    expect(reader.readJsoncFile(missingPath, { throwOnError: false })).toEqual(
      {}
    );
    await expect(
      reader.readJsoncFileAsync(missingPath, { throwOnError: false })
    ).resolves.toEqual({});
  });

  it('wraps synchronous and asynchronous file read failures with path context', async () => {
    const missingPath = path.join(tempDir, 'missing.jsonc');
    const reader = createReader();

    expect(() => reader.readJsoncFile(missingPath)).toThrow(
      `Failed to read JSONC file '${missingPath}':`
    );
    await expect(reader.readJsoncFileAsync(missingPath)).rejects.toThrow(
      `Failed to read JSONC file '${missingPath}':`
    );
  });

  it('normalizes non-Error boundary failures', async () => {
    const filePath = path.join(tempDir, 'config.jsonc');
    const reader = createReader();
    const readFileSync = vi
      .spyOn(nodeFs, 'readFileSync')
      .mockImplementationOnce(() => {
        throw 'sync failure';
      });

    expect(() => reader.readJsoncFile(filePath)).toThrow(
      `Failed to read JSONC file '${filePath}': sync failure`
    );
    readFileSync.mockRestore();

    const readFile = vi
      .spyOn(nodeFs.promises, 'readFile')
      .mockRejectedValueOnce('async failure');
    await expect(reader.readJsoncFileAsync(filePath)).rejects.toThrow(
      `Failed to read JSONC file '${filePath}': async failure`
    );
    readFile.mockRestore();

    const stringify = vi.spyOn(JSON, 'stringify').mockImplementationOnce(() => {
      throw 'serialization failure';
    });
    expect(() => reader.stripJsonComments('{}')).toThrow(
      'Failed to strip comments: serialization failure'
    );
    stringify.mockRestore();
  });

  it('detects readable and missing files', async () => {
    const filePath = path.join(tempDir, 'readable.json');
    await fs.writeFile(filePath, '{}');
    const reader = createReader();

    expect(reader.isFileReadable(filePath)).toBe(true);
    expect(reader.isFileReadable(path.join(tempDir, 'missing'))).toBe(false);
  });

  it('prefers JSONC app config and resolves environment references', async () => {
    const runtimeDir = path.join(tempDir, 'runtime');
    await fs.mkdir(runtimeDir);
    await fs.writeFile(
      path.join(runtimeDir, 'parako.jsonc'),
      '{ "source": "jsonc", "value": "${PARAKO_CONFIG_READER_VALUE}" }'
    );
    await fs.writeFile(
      path.join(runtimeDir, 'parako.json'),
      '{ "source": "json" }'
    );
    process.env.PARAKO_CONFIG_READER_VALUE = 'resolved';
    const reader = createReader(tempDir);

    expect(reader.readAppConfig()).toEqual({
      source: 'jsonc',
      value: 'resolved',
    });
    await expect(reader.readAppConfigAsync()).resolves.toEqual({
      source: 'jsonc',
      value: 'resolved',
    });
  });

  it('falls back to JSON app config when JSONC is absent', async () => {
    const runtimeDir = path.join(tempDir, 'runtime');
    await fs.mkdir(runtimeDir);
    await fs.writeFile(
      path.join(runtimeDir, 'parako.json'),
      '{ "source": "json" }'
    );
    const reader = createReader(tempDir);

    expect(reader.readAppConfig()).toEqual({ source: 'json' });
    await expect(reader.readAppConfigAsync()).resolves.toEqual({
      source: 'json',
    });
  });

  it('reports a missing application configuration in both APIs', async () => {
    const reader = createReader(tempDir);
    const message =
      'App configuration file not found. Expected: runtime/parako.jsonc or runtime/parako.json';

    expect(() => reader.readAppConfig()).toThrow(message);
    await expect(reader.readAppConfigAsync()).rejects.toThrow(message);
  });

  it('reads the RP client registry synchronously and asynchronously', async () => {
    const runtimeDir = path.join(tempDir, 'runtime');
    await fs.mkdir(runtimeDir);
    await fs.writeFile(
      path.join(runtimeDir, 'parako-rp.jsonc'),
      '{ // registered client\n "clients": [{ "client_id": "demo" }] }'
    );
    const reader = createReader(tempDir);
    const expected = { clients: [{ client_id: 'demo' }] };

    expect(reader.readParakoRpConfig()).toEqual(expected);
    await expect(reader.readParakoRpConfigAsync()).resolves.toEqual(expected);
  });

  it('reports a missing RP client registry in both APIs', async () => {
    const reader = createReader(tempDir);
    const expectedPath = path.join(tempDir, 'runtime', 'parako-rp.jsonc');
    const message = `Client registry configuration file not found at: ${expectedPath}`;

    expect(() => reader.readParakoRpConfig()).toThrow(message);
    await expect(reader.readParakoRpConfigAsync()).rejects.toThrow(message);
  });
});
