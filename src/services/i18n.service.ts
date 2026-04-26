import path from 'node:path';
import fs from 'node:fs';
import i18n from 'i18n';
import { injectable, inject } from 'inversify';
import { TYPES } from '../di/types.js';
import type { II18nService } from '../di/interfaces/i18n-service.interface.js';
import type { IConfigManager } from '../di/interfaces/config-manager.interface.js';
import type { IFileSystemUtils } from '../di/interfaces/file-system-utils.interface.js';
import { Request, Response, NextFunction } from 'express';

/**
 * I18n Service
 * Handles internationalization functionality including locale management and translation
 * Supports directory-based namespaces (common/, home/, email/, etc.)
 */
@injectable()
export class I18nService implements II18nService {
  private isConfigured = false;

  constructor(
    @inject(TYPES.ConfigManager) private readonly configManager: IConfigManager,
    @inject(TYPES.FileSystemUtils)
    private readonly fileSystemUtils: IFileSystemUtils
  ) {
    this.configure();

    this.configManager.subscribe('I18nService', updatedConfig => {
      console.info(
        '[I18nService] Configuration updated, reconfiguring i18n with new locale settings'
      );
      this.reconfigure(updatedConfig);
    });
  }

  /**
   * Reconfigure i18n with updated settings
   * Called when configuration changes to update locale settings
   */
  private reconfigure(updatedConfig: any): void {
    try {
      const localesPath = path.join(
        this.fileSystemUtils.rootDir,
        'runtime/locales'
      );

      const mergedPath = this.writeMergedLocales(
        localesPath,
        updatedConfig.application.locales.available
      );

      i18n.configure({
        locales: updatedConfig.application.locales.available,
        defaultLocale: updatedConfig.application.locales.default,
        directory: mergedPath,
        objectNotation: true,
        updateFiles: false,
        autoReload: process.env.NODE_ENV === 'development',
        cookie: updatedConfig.deployment.cookies.types.locale.name,
        queryParameter: 'lang',
        mustacheConfig: {
          tags: ['{{', '}}'],
          disable: false,
        },
        api: {
          __: 't',
          __n: 'tn',
        },
      });

      console.info('[I18nService] i18n reconfigured successfully', {
        availableLocales: updatedConfig.application.locales.available,
        defaultLocale: updatedConfig.application.locales.default,
      });
    } catch (error) {
      console.error('[I18nService] Failed to reconfigure i18n:', error);
    }
  }

  /**
   * Load and merge locale files from namespace directories
   * Reads from runtime/locales/NAMESPACE/lang.json and merges them into a single object
   */
  private loadNamespacedLocales(
    localesPath: string,
    locale: string
  ): Record<string, unknown> {
    const mergedTranslations: Record<string, unknown> = {};

    try {
      if (!fs.existsSync(localesPath)) {
        return mergedTranslations;
      }

      const namespaces = fs
        .readdirSync(localesPath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory() && !dirent.name.startsWith('.'))
        .map(dirent => dirent.name);

      for (const namespace of namespaces) {
        const localeFile = path.join(localesPath, namespace, `${locale}.json`);

        if (fs.existsSync(localeFile)) {
          try {
            const content = fs.readFileSync(localeFile, 'utf-8');
            const translations = JSON.parse(content);
            mergedTranslations[namespace] = translations;
          } catch (error) {
            console.error(`Error loading locale file ${localeFile}:`, error);
          }
        }
      }
    } catch (error) {
      console.error(`Error loading namespaced locales for ${locale}:`, error);
    }

    return mergedTranslations;
  }

  /**
   * Write merged locale files to a temporary directory for i18n library
   */
  private writeMergedLocales(
    localesPath: string,
    availableLocales: string[]
  ): string {
    const mergedPath = path.join(localesPath, '.merged');

    try {
      if (!fs.existsSync(mergedPath)) {
        fs.mkdirSync(mergedPath, { recursive: true });
      }

      for (const locale of availableLocales) {
        const mergedTranslations = this.loadNamespacedLocales(
          localesPath,
          locale
        );
        const outputFile = path.join(mergedPath, `${locale}.json`);
        fs.writeFileSync(
          outputFile,
          JSON.stringify(mergedTranslations, null, 2),
          'utf-8'
        );
      }
    } catch (error) {
      console.error('Error writing merged locale files:', error);
    }

    return mergedPath;
  }

  /**
   * Configure the i18n instance
   */
  configure(): void {
    if (this.isConfigured) {
      return;
    }

    const config = this.configManager.getConfig();
    const localesPath = path.join(
      this.fileSystemUtils.rootDir,
      'runtime/locales'
    );

    const mergedPath = this.writeMergedLocales(
      localesPath,
      config.application.locales.available
    );

    i18n.configure({
      locales: config.application.locales.available,
      defaultLocale: config.application.locales.default,
      directory: mergedPath,
      objectNotation: true,
      updateFiles: false,
      autoReload: process.env.NODE_ENV === 'development',
      cookie: config.deployment.cookies.types.locale.name,
      queryParameter: 'lang',
      mustacheConfig: {
        tags: ['{{', '}}'],
        disable: false,
      },
      api: {
        __: 't',
        __n: 'tn',
      },
    });

    this.isConfigured = true;
  }

  /**
   * Get the current locale
   */
  getLocale(req?: Request): string {
    if (req) {
      return i18n.getLocale(req);
    }
    return i18n.getLocale();
  }

  /**
   * Get all available locales
   */
  getLocales(): string[] {
    return i18n.getLocales();
  }

  /**
   * Set the current locale
   * Can be called with just a locale string (global) or with a Request and locale (per-request)
   */
  setLocale(localeOrReq: string | Request, locale?: string): void {
    if (typeof localeOrReq === 'string') {
      // Global locale set (backward compatibility)
      i18n.setLocale(localeOrReq);
    } else {
      // Request-specific locale set (preferred for per-request locale)
      i18n.setLocale(localeOrReq, locale!);
    }
  }

  /**
   * Initialize i18n for a request
   */
  init(req: Request, res: Response, next: NextFunction): void {
    i18n.init(req, res, next);
  }

  /**
   * Translate a phrase
   */
  __(phrase: string, ...args: any[]): string {
    return i18n.__(phrase, ...args);
  }

  /**
   * Translate a phrase with pluralization
   */
  __n(phrase: string, count: number, ...args: unknown[]): string {
    return i18n.__n(phrase, count, ...(args as []));
  }
}
