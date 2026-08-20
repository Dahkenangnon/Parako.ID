import { injectable } from 'inversify';

import type { IBootstrapEnvironment } from '../di/interfaces/bootstrap-environment.interface.js';

export function readEnvironmentVariable(name: string): string | undefined {
  return process.env[name];
}

function normalizedSecret(name: string): string | undefined {
  const value = readEnvironmentVariable(name)?.trim();
  return value || undefined;
}

@injectable()
export class BootstrapEnvironment implements IBootstrapEnvironment {
  get nodeEnvironment(): string | undefined {
    return readEnvironmentVariable('NODE_ENV');
  }

  get encryptionKey(): string | undefined {
    return readEnvironmentVariable('ENCRYPTION_KEY');
  }

  get ipinfoApiToken(): string | undefined {
    return normalizedSecret('IPINFO_API_TOKEN');
  }

  get ipQualityScoreApiKey(): string | undefined {
    return normalizedSecret('IPQUALITYSCORE_API_KEY');
  }
}
