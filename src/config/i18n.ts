import i18n from 'i18n';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IFileSystemUtils } from '../di/interfaces/file-system-utils.interface.js';

/**
 * Factory function to create and configure an i18n instance
 * @param configManager - The configuration manager dependency
 * @param fileSystemUtils - The file system utilities dependency
 * @returns Configured i18n instance
 */
export function createI18n(
  configManager: IConfigManager,
  fileSystemUtils: IFileSystemUtils
) {
  const config = configManager.getConfig();
  const localesPath = fileSystemUtils.join(
    fileSystemUtils.rootDir,
    'runtime/locales'
  );

  i18n.configure({
    locales: config.application.locales.available,
    defaultLocale: config.application.locales.default,
    directory: localesPath,
    objectNotation: true,
    updateFiles: false,
    cookie: config.deployment.cookies.types.locale.name,
    queryParameter: 'lang',
    api: {
      __: 't',
      __n: 'tn',
    },
  });

  return i18n;
}
