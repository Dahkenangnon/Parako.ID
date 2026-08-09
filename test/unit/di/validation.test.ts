import { Container } from 'inversify';
import { describe, expect, it, vi } from 'vitest';

import { TYPES } from '../../../src/di/types.js';
import {
  assertContainerValid,
  validateContainer,
} from '../../../src/di/validation.js';

function bindEveryIdentifierExcept(...excludedNames: string[]): Container {
  const container = new Container();
  const excluded = new Set(excludedNames);

  for (const [name, identifier] of Object.entries(TYPES)) {
    if (!excluded.has(name)) {
      container.bind(identifier).toConstantValue({});
    }
  }

  return container;
}

describe('DI container validation', () => {
  it('rejects missing repositories required by every storage adapter', () => {
    const container = bindEveryIdentifierExcept(
      'UserRepository',
      'ActivityRepository',
      'SettingsRepository',
      'SocialIntegrationRepository'
    );

    expect(validateContainer(container)).toMatchObject({
      valid: false,
      missingCount: 4,
      missingSymbols: [
        'UserRepository',
        'ActivityRepository',
        'SettingsRepository',
        'SocialIntegrationRepository',
      ],
    });
  });

  it('rejects a missing PrismaClient binding for every storage adapter', () => {
    const container = bindEveryIdentifierExcept('PrismaClient');

    expect(validateContainer(container)).toMatchObject({
      valid: false,
      missingCount: 1,
      missingSymbols: ['PrismaClient'],
    });
  });

  it('rejects a missing Redis Pub/Sub service binding', () => {
    const container = bindEveryIdentifierExcept('RedisPubSubService');

    expect(validateContainer(container)).toMatchObject({
      valid: false,
      missingCount: 1,
      missingSymbols: ['RedisPubSubService'],
    });
  });

  it('accepts absent optional tenant and operations collaborators', () => {
    const container = bindEveryIdentifierExcept(
      'TenantActivityRedisClient',
      'ProviderFactory',
      'OpsRedisClient'
    );

    expect(validateContainer(container)).toMatchObject({
      valid: true,
      missingCount: 0,
      missingSymbols: [],
      skippedCount: 6,
    });
  });

  it('treats a failed symbol check as a missing required binding', () => {
    const container = bindEveryIdentifierExcept();
    const isBound = container.isBound.bind(container);
    vi.spyOn(container, 'isBound').mockImplementation(identifier => {
      if (identifier === TYPES.Logger) {
        throw new Error('container lookup failed');
      }

      return isBound(identifier);
    });

    expect(validateContainer(container)).toMatchObject({
      valid: false,
      missingCount: 1,
      missingSymbols: ['Logger'],
    });
  });

  it('fails fast with every missing required binding in the error', () => {
    const container = bindEveryIdentifierExcept('Logger', 'UserRepository');

    expect(() => assertContainerValid(container)).toThrow(
      'DI container validation failed: 2 missing bindings.\n' +
        'Missing symbols: Logger, UserRepository'
    );
  });

  it('accepts a complete container without throwing', () => {
    const container = bindEveryIdentifierExcept();

    expect(() => assertContainerValid(container)).not.toThrow();
  });
});
