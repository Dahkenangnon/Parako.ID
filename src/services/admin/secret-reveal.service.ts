import { isSensitiveField } from '../../utils/settings.helper.js';

export interface SecretRevealDependencies {
  loadDecryptedConfiguration(): Promise<unknown>;
}

export type SecretRevealResult =
  | {
      status: 'invalid';
      error: 'Field path is required' | 'Invalid field path';
    }
  | { status: 'not_found' }
  | { status: 'success'; fieldPath: string; value: unknown };

function getPathValue(source: unknown, path: string): unknown {
  let current = source;
  for (const key of path.split('.')) {
    if (
      typeof current !== 'object' ||
      current === null ||
      Array.isArray(current)
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

export class SecretRevealService {
  constructor(private readonly dependencies: SecretRevealDependencies) {}

  async reveal(fieldPath: unknown): Promise<SecretRevealResult> {
    if (!fieldPath || typeof fieldPath !== 'string') {
      return { status: 'invalid', error: 'Field path is required' };
    }
    if (!isSensitiveField(fieldPath)) {
      return { status: 'invalid', error: 'Invalid field path' };
    }

    const configuration = await this.dependencies.loadDecryptedConfiguration();
    if (!configuration) return { status: 'not_found' };

    return {
      status: 'success',
      fieldPath,
      value: getPathValue(configuration, fieldPath) ?? '',
    };
  }
}
