/**
 * Interface for filesystem utils service
 * Defines the contract for filesystem operations
 */
export interface IFileSystemUtils {
  /**
   * The project root directory
   */
  readonly rootDir: string;

  /**
   * Get package.json content
   * @returns Package.json content as object
   */
  getPackageJson(): Promise<any>;

  /**
   * Get environment file path
   * @returns Path to .env file
   */
  getEnvFilePath(): string;

  /**
   * Get project directory
   * @returns Project root directory path
   */
  getProjectDir(): string;

  /**
   * Get logs directory
   * @returns Path to logs directory
   */
  getLogDir(): string;

  /**
   * Create directory
   * @param dirPath - Directory path to create
   * @returns Promise that resolves when directory is created
   */
  createDir(dirPath: string): Promise<void>;

  /**
   * Remove file
   * @param filePath - File path to remove
   * @returns True if file was removed, false if file didn't exist
   */
  removeFile(filePath: string): Promise<boolean>;

  /**
   * Remove directory
   * @param dirPath - Directory path to remove
   * @param recursive - Whether to remove recursively
   * @returns True if directory was removed, false if directory didn't exist
   */
  removeDir(dirPath: string, recursive?: boolean): Promise<boolean>;

  /**
   * Check if file exists
   * @param filePath - File path to check
   * @returns True if file exists, false otherwise
   */
  fileExists(filePath: string): Promise<boolean>;

  /**
   * Save file
   * @param filePath - File path to save to
   * @param data - Data to save (string or Buffer)
   * @returns True if file was saved successfully
   */
  saveFile(filePath: string, data: string | Buffer): Promise<boolean>;

  /**
   * Read file
   * @param filePath - File path to read
   * @returns File content as string
   */
  readFile(filePath: string): Promise<string>;

  readFileSync(filePath: string): string;

  /**
   * Ensures that the given directory exists. If it does not exist, it will be created recursively.
   * @param dirPath - The path to the directory to ensure exists.
   * @returns boolean - True if the directory exists or was created, false otherwise.
   */
  ensureDir(dirPath: string): boolean;

  /**
   * Abstraction to the nodejs join path method
   *
   * @param paths Paths to join in order
   * @returns Final path
   */
  join(...paths: string[]): string;
}
