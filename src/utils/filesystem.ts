import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import { constants, statSync, mkdirSync, readFileSync } from 'node:fs';
import { injectable } from 'inversify';
import { IFileSystemUtils } from '../di/interfaces/file-system-utils.interface.js';

@injectable()
export class FileSystemUtils implements IFileSystemUtils {
  private __dirname: string;
  private projectRoot: string = '';

  constructor() {
    this.__dirname = path.dirname(fileURLToPath(import.meta.url));

    // Go up until we find package.json, fallback to cwd if not found
    let currentDir = this.__dirname;
    let found = false;
    const maxIterations = 10;
    let iterations = 0;

    while (!found && iterations < maxIterations) {
      iterations++;
      const packageJsonPath = path.join(currentDir, 'package.json');
      try {
        if (statSync(packageJsonPath).isFile()) {
          found = true;
          this.projectRoot = currentDir;
          break;
        }
      } catch {
        // Silently continue searching - this is expected during the search process
        currentDir = path.dirname(currentDir);
      }
    }

    if (!found) {
      // Only log if we completely failed to find package.json
      console.warn(
        'Could not locate package.json, using process.cwd() as project root',
        {
          context: 'failed_to_get_package_json',
          searchedFrom: this.__dirname,
          fallbackTo: process.cwd(),
        }
      );
      this.projectRoot = process.cwd();
    }
  }

  public async getPackageJson(): Promise<any> {
    const packageJsonPath = path.resolve(this.projectRoot, 'package.json');
    const packageJson = await fs.readFile(packageJsonPath, 'utf-8');
    return JSON.parse(packageJson);
  }

  public getEnvFilePath(): string {
    return path.resolve(this.projectRoot, '.env');
  }

  public getProjectDir(): string {
    return this.projectRoot;
  }

  /**
   * The project root dir
   */
  get rootDir(): string {
    return this.projectRoot;
  }

  public getLogDir(): string {
    return path.resolve(this.projectRoot, 'logs');
  }

  public async createDir(dirPath: string): Promise<void> {
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
    }
  }

  public async removeFile(filePath: string): Promise<boolean> {
    try {
      await fs.unlink(filePath);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  public async removeDir(dirPath: string, recursive = false): Promise<boolean> {
    try {
      await fs.rm(dirPath, { recursive, force: true });
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
      }
      throw error;
    }
  }

  public async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  public async saveFile(
    filePath: string,
    data: string | Buffer
  ): Promise<boolean> {
    await fs.writeFile(filePath, data);
    return true;
  }

  public async readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf-8');
  }

  public readFileSync(filePath: string): string {
    return readFileSync(filePath, 'utf-8');
  }

  /**
  /**
   * Ensures that the given directory exists. If it does not exist, it will be created recursively.
   * @param dirPath - The path to the directory to ensure exists.
   * @returns boolean - True if the directory exists or was created, false otherwise.
   */
  public ensureDir(dirPath: string): boolean {
    try {
      mkdirSync(dirPath, { recursive: true });
      return true;
    } catch (error) {
      console.error((error as Error).message, {
        context: 'failed_to_ensure_dir',
        dirPath,
      });
      return false;
    }
  }

  /**
   * Abstraction to the nodejs join path method
   *
   * @param paths Paths to join in order
   * @returns Final path
   */
  public join(...paths: string[]): string {
    return path.join(...paths);
  }
}
export default FileSystemUtils;
