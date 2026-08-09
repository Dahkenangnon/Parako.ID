import fs from 'node:fs';
import path from 'node:path';
import {
  parse as parseJsonc,
  printParseErrorCode,
  type ParseError,
  type ParseErrorCode,
} from 'jsonc-parser';
import { injectable, inject } from 'inversify';
import type { IFileSystemUtils } from '../di/interfaces/file-system-utils.interface.js';
import type {
  IConfigFileReader,
  JsoncReaderOptions,
} from '../di/interfaces/config-file-reader.interface.js';
import { TYPES } from '../di/types.js';
import { resolveEnvVars } from './env-interpolation.js';

/**
 * Configuration file reader utility class
 * Handles reading and parsing JSONC and JSON configuration files
 * with auto-detection of format by file extension
 */
@injectable()
export class ConfigFileReader implements IConfigFileReader {
  /**
   * Injected dependencies
   */
  private fileSystemUtils: IFileSystemUtils;

  /**
   * Constructor with dependency injection
   * @param fileSystemUtils - File system utilities instance
   */
  constructor(
    @inject(TYPES.FileSystemUtils) fileSystemUtils: IFileSystemUtils
  ) {
    this.fileSystemUtils = fileSystemUtils;
  }

  /**
   * Read and parse a JSONC file using Microsoft's jsonc-parser
   *
   * @param filePath - Path to the JSONC file
   * @param options - Options for reading the file
   * @returns Parsed JSON object
   * @throws Error if file cannot be read or parsed
   */
  readJsoncFile<T = any>(
    filePath: string,
    options: JsoncReaderOptions = {}
  ): T {
    const {
      encoding = 'utf8',
      throwOnError = true,
      parseOptions = {
        allowTrailingComma: true,
        disallowComments: false,
        allowEmptyContent: false,
      },
    } = options;

    try {
      const fileContent = fs.readFileSync(filePath, encoding);

      const errors: ParseError[] = [];
      const result = parseJsonc(fileContent, errors, parseOptions);

      if (errors.length > 0 && throwOnError) {
        throw new Error(
          `JSONC parsing errors: ${this.formatParseErrors(errors)}`
        );
      }

      return result as T;
    } catch (error) {
      if (throwOnError) {
        throw new Error(
          `Failed to read JSONC file '${filePath}': ${error instanceof Error ? error.message : String(error)}`
        );
      }
      return {} as T;
    }
  }

  /**
   * Read and parse a JSONC file asynchronously
   *
   * @param filePath - Path to the JSONC file
   * @param options - Options for reading the file
   * @returns Promise that resolves to parsed JSON object
   */
  async readJsoncFileAsync<T = any>(
    filePath: string,
    options: JsoncReaderOptions = {}
  ): Promise<T> {
    const {
      encoding = 'utf8',
      throwOnError = true,
      parseOptions = {
        allowTrailingComma: true,
        disallowComments: false,
        allowEmptyContent: false,
      },
    } = options;

    try {
      const fileContent = await fs.promises.readFile(filePath, encoding);

      const errors: ParseError[] = [];
      const result = parseJsonc(fileContent, errors, parseOptions);

      if (errors.length > 0 && throwOnError) {
        throw new Error(
          `JSONC parsing errors: ${this.formatParseErrors(errors)}`
        );
      }

      return result as T;
    } catch (error) {
      if (throwOnError) {
        throw new Error(
          `Failed to read JSONC file '${filePath}': ${error instanceof Error ? error.message : String(error)}`
        );
      }
      return {} as T;
    }
  }

  /**
   * Convert ParseErrorCode to human-readable error message
   *
   * @param errorCode - Error code from jsonc-parser
   * @returns Human-readable error message
   */
  private getErrorMessage(errorCode: ParseErrorCode): string {
    return printParseErrorCode(errorCode).replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  private formatParseErrors(errors: ParseError[]): string {
    return errors
      .map(
        error =>
          `${this.getErrorMessage(error.error)} at offset ${error.offset} (length: ${error.length})`
      )
      .join('; ');
  }

  /**
   * Check if a file exists and is readable
   *
   * @param filePath - Path to check
   * @returns True if file exists and is readable
   */
  isFileReadable(filePath: string): boolean {
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read the main application configuration file (auto-detects format)
   * Searches for: runtime/parako.jsonc, runtime/parako.json
   *
   * @returns Parsed configuration object
   */
  readAppConfig<T = any>(): T {
    const extensions = ['jsonc', 'json'];
    for (const ext of extensions) {
      const configPath = path.join(
        this.fileSystemUtils.rootDir,
        'runtime',
        `parako.${ext}`
      );
      if (this.isFileReadable(configPath)) {
        const parsed = this.readJsoncFile<T>(configPath);
        return resolveEnvVars(parsed) as T;
      }
    }
    throw new Error(
      'App configuration file not found. Expected: runtime/parako.jsonc or runtime/parako.json'
    );
  }

  /**
   * Read the main application configuration file asynchronously (auto-detects format)
   * Searches for: runtime/parako.jsonc, runtime/parako.json
   *
   * @returns Promise that resolves to parsed configuration object
   */
  async readAppConfigAsync<T = any>(): Promise<T> {
    const extensions = ['jsonc', 'json'];
    for (const ext of extensions) {
      const configPath = path.join(
        this.fileSystemUtils.rootDir,
        'runtime',
        `parako.${ext}`
      );
      if (this.isFileReadable(configPath)) {
        const parsed = await this.readJsoncFileAsync<T>(configPath);
        return resolveEnvVars(parsed) as T;
      }
    }
    throw new Error(
      'App configuration file not found. Expected: runtime/parako.jsonc or runtime/parako.json'
    );
  }

  /**
   * Read the client registry configuration file
   *
   * @returns Parsed client registry configuration object
   */
  readParakoRpConfig<T = any>(): T {
    const configPath = path.join(
      this.fileSystemUtils.rootDir,
      'runtime',
      'parako-rp.jsonc'
    );

    if (!this.isFileReadable(configPath)) {
      throw new Error(
        `Client registry configuration file not found at: ${configPath}`
      );
    }

    return this.readJsoncFile<T>(configPath);
  }

  /**
   * Read the client registry configuration file asynchronously
   *
   * @returns Promise that resolves to parsed client registry configuration object
   */
  async readParakoRpConfigAsync<T = any>(): Promise<T> {
    const configPath = path.join(
      this.fileSystemUtils.rootDir,
      'runtime',
      'parako-rp.jsonc'
    );

    if (!this.isFileReadable(configPath)) {
      throw new Error(
        `Client registry configuration file not found at: ${configPath}`
      );
    }

    return this.readJsoncFileAsync<T>(configPath);
  }

  /**
   * Strip comments from JSONC string (utility function using jsonc-parser)
   *
   * @param jsonString - The JSONC string with comments
   * @returns Clean JSON string without comments
   */
  stripJsonComments(jsonString: string): string {
    try {
      const errors: ParseError[] = [];
      const parsed = parseJsonc(jsonString, errors, {
        allowTrailingComma: true,
        disallowComments: false,
        allowEmptyContent: false,
      });

      if (errors.length > 0) {
        throw new Error(
          `JSONC parsing errors: ${this.formatParseErrors(errors)}`
        );
      }

      return JSON.stringify(parsed, null, 2);
    } catch (error) {
      throw new Error(
        `Failed to strip comments: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

export default ConfigFileReader;
