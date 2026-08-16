import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import dotenv from 'dotenv';

type Environment = Record<string, string | undefined>;

function readEnvironmentFile(path: string): Environment {
  return existsSync(path) ? dotenv.parse(readFileSync(path, 'utf8')) : {};
}

/**
 * Resolve test infrastructure settings using the same local files as the app.
 * Explicit command or CI variables win over operator-owned local files.
 */
export function loadTestingEnvironment(
  root = process.cwd(),
  environment: Environment = process.env
): Environment {
  return {
    ...readEnvironmentFile(resolve(root, 'runtime/.env')),
    ...readEnvironmentFile(resolve(root, 'runtime/.env.local')),
    ...environment,
  };
}

/** Load local test settings into a command process without replacing overrides. */
export function applyTestingEnvironment(
  root = process.cwd(),
  environment: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  Object.assign(environment, loadTestingEnvironment(root, environment));
  return environment;
}
