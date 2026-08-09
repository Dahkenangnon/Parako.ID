import 'reflect-metadata';

import { Container } from 'inversify';
import { describe, expect, it } from 'vitest';

import { BootstrapConfigProvider } from '../../../src/config/provider/bootstrap-provider.js';
import { configModule } from '../../../src/di/modules/config.module.js';
import { TYPES } from '../../../src/di/types.js';

describe('configModule', () => {
  it('registers every configuration component', () => {
    const container = new Container();

    container.load(configModule);

    expect(container.isBound(TYPES.ConfigManager)).toBe(true);
    expect(container.isBound(TYPES.BootstrapConfigProvider)).toBe(true);
    expect(container.isBound(TYPES.DatabaseConfigProvider)).toBe(true);
    expect(container.isBound(TYPES.FileConfigProvider)).toBe(true);
  });

  it('binds one bootstrap configuration provider instance', () => {
    const container = new Container();
    container.load(configModule);

    const first = container.get<BootstrapConfigProvider>(
      TYPES.BootstrapConfigProvider
    );
    const second = container.get<BootstrapConfigProvider>(
      TYPES.BootstrapConfigProvider
    );

    expect(first).toBeInstanceOf(BootstrapConfigProvider);
    expect(second).toBe(first);
  });
});
