import 'reflect-metadata';

import { containerReady } from '../../../dist/src/di/index.js';
import { TYPES } from '../../../dist/src/di/types.js';
import { stripBootstrapFields } from '../../../dist/src/config/validation/persistence-validator.js';

const container = await containerReady;
const configManager = container.get(TYPES.ConfigManager);
const databaseManager = container.get(TYPES.DatabaseConnectionManager);
const fileProvider = container.get(TYPES.FileConfigProvider);
const settingsService = container.get(TYPES.SettingsService);

let connected = false;
try {
  const bootstrapConfig = await configManager.getBootstrapConfig();
  databaseManager.initializeWithBootstrapConfig(bootstrapConfig);
  await databaseManager.connect();
  connected = true;

  // Exercise Parako's real parser, default merge, schema validation,
  // encryption, versioning, and active-settings repository. The disposable
  // harness only selects which already-supported source seeds the database.
  const fileConfig = await fileProvider.loadConfiguration();
  await settingsService.migrateFromFile(
    stripBootstrapFields(fileConfig),
    'browser-e2e',
    'Seed deterministic browser E2E configuration'
  );
} finally {
  configManager.cleanup();
  if (connected) await databaseManager.disconnect();
}
