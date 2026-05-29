import { ParseOptions } from 'jsonc-parser';

/**
 * Options for reading JSONC files
 */
export interface JsoncReaderOptions {
  encoding?: BufferEncoding;
  throwOnError?: boolean;
  parseOptions?: ParseOptions;
}

/**
 * Options for reading YAML files
 */
export interface YamlReaderOptions {
  encoding?: BufferEncoding;
  throwOnError?: boolean;
}

/**
 * Interface for configuration file reader service
 * Supports JSONC, JSON, and YAML file formats with auto-detection
 */
export interface IConfigFileReader {
  /**
   * Read and parse a JSONC file using Microsoft's jsonc-parser
   * @param filePath - Path to the JSONC file
   * @param options - Options for reading the file
   * @returns Parsed JSON object
   */
  readJsoncFile<T = any>(filePath: string, options?: JsoncReaderOptions): T;

  /**
   * Read and parse a JSONC file asynchronously
   * @param filePath - Path to the JSONC file
   * @param options - Options for reading the file
   * @returns Promise that resolves to parsed JSON object
   */
  readJsoncFileAsync<T = any>(
    filePath: string,
    options?: JsoncReaderOptions
  ): Promise<T>;

  /**
   * Read and parse a YAML file
   * @param filePath - Path to the YAML file
   * @param options - Options for reading the file
   * @returns Parsed object
   */
  readYamlFile<T = any>(filePath: string, options?: YamlReaderOptions): T;

  /**
   * Read and parse a YAML file asynchronously
   * @param filePath - Path to the YAML file
   * @param options - Options for reading the file
   * @returns Promise that resolves to parsed object
   */
  readYamlFileAsync<T = any>(
    filePath: string,
    options?: YamlReaderOptions
  ): Promise<T>;

  /**
   * Check if a file exists and is readable
   * @param filePath - Path to check
   * @returns True if file exists and is readable
   */
  isFileReadable(filePath: string): boolean;

  /**
   * Read the main application configuration file (auto-detects format)
   * Searches for: parako.yaml, parako.yml, parako.jsonc, parako.json
   * @returns Parsed configuration object
   */
  readAppConfig<T = any>(): T;

  /**
   * Read the main application configuration file asynchronously (auto-detects format)
   * Searches for: parako.yaml, parako.yml, parako.jsonc, parako.json
   * @returns Promise that resolves to parsed configuration object
   */
  readAppConfigAsync<T = any>(): Promise<T>;

  /**
   * Read the client registry configuration file
   * @returns Parsed client registry configuration object
   */
  readParakoRpConfig<T = any>(): T;

  /**
   * Read the client registry configuration file asynchronously
   * @returns Promise that resolves to parsed client registry configuration object
   */
  readParakoRpConfigAsync<T = any>(): Promise<T>;

  /**
   * Strip comments from JSONC string (utility function using jsonc-parser)
   * @param jsonString - The JSONC string with comments
   * @returns Clean JSON string without comments
   */
  stripJsonComments(jsonString: string): string;
}
