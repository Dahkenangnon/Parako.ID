import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Return whether an ES module is the process entrypoint, resolving symlinks on
 * both sides. Installed commands are launched through the mutable `current`
 * symlink while Node reports import.meta.url from the immutable release path.
 */
export function isMainModule(
  moduleUrl: string,
  argvEntry = process.argv[1]
): boolean {
  if (!argvEntry) return false;

  const modulePath = fileURLToPath(moduleUrl);
  try {
    return (
      fs.realpathSync(path.resolve(argvEntry)) === fs.realpathSync(modulePath)
    );
  } catch {
    return path.resolve(argvEntry) === path.resolve(modulePath);
  }
}
