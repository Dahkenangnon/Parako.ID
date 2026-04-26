import { Request, Response, NextFunction } from 'express';

/**
 * MongoDB injection protection middleware
 * Replaces express-mongo-sanitize with Express 5 compatibility
 */

interface SanitizeOptions {
  replaceWith?: string;
  onSanitize?: (data: { req: Request; key: string }) => void;
  dryRun?: boolean;
  allowDots?: boolean;
}

interface SanitizeResult {
  isSanitized: boolean;
  target: any;
}

interface SanitizeCallbackResult {
  shouldRecurse: boolean;
  key?: string;
}

class MongoSanitizer {
  private static readonly TEST_REGEX = /\$|\./;
  private static readonly TEST_REGEX_WITHOUT_DOT = /\$/;
  private static readonly REPLACE_REGEX = /\$|\./g;

  /**
   * Check if an object is a plain object (not array, null, or primitive)
   */
  private static isPlainObject(obj: any): boolean {
    return typeof obj === 'object' && obj !== null && !Array.isArray(obj);
  }

  /**
   * Get the appropriate test regex based on allowDots option
   */
  private static getTestRegex(allowDots: boolean): RegExp {
    return allowDots ? this.TEST_REGEX_WITHOUT_DOT : this.TEST_REGEX;
  }

  /**
   * Recursively traverse and process objects/arrays
   */
  private static withEach(
    target: any,
    callback: (obj: any, val: any, key: string) => SanitizeCallbackResult
  ): void {
    const traverse = (obj: any): void => {
      if (Array.isArray(obj)) {
        obj.forEach(traverse);
      } else if (this.isPlainObject(obj)) {
        Object.keys(obj).forEach(key => {
          const val = obj[key];
          const result = callback(obj, val, key);
          if (result.shouldRecurse) {
            traverse(obj[result.key || key]);
          }
        });
      }
    };
    traverse(target);
  }

  /**
   * Check if target contains prohibited keys
   */
  public static hasProhibitedKeys(
    target: any,
    allowDots: boolean = false
  ): boolean {
    const regex = this.getTestRegex(allowDots);
    let hasProhibited = false;

    this.withEach(target, (obj, val, key) => {
      if (regex.test(key)) {
        hasProhibited = true;
        return { shouldRecurse: false };
      }
      return { shouldRecurse: true };
    });

    return hasProhibited;
  }

  /**
   * Sanitize target by removing or replacing prohibited keys
   * Only sanitizes object keys
   */
  private static sanitizeInternal(
    target: any,
    options: SanitizeOptions
  ): SanitizeResult {
    const regex = this.getTestRegex(options.allowDots || false);
    let isSanitized = false;
    let replaceWith: string | null = null;
    const dryRun = Boolean(options.dryRun);

    if (!regex.test(options.replaceWith || '') && options.replaceWith !== '.') {
      replaceWith = options.replaceWith || null;
    }

    this.withEach(target, (obj, val, key) => {
      let shouldRecurse = true;

      if (regex.test(key)) {
        isSanitized = true;

        // If dryRun is enabled, do not modify the target
        if (dryRun) {
          return { shouldRecurse, key };
        }

        delete obj[key];

        if (replaceWith) {
          const newKey = key.replace(this.REPLACE_REGEX, replaceWith);

          // Avoid prototype pollution
          if (
            newKey !== '__proto__' &&
            newKey !== 'constructor' &&
            newKey !== 'prototype'
          ) {
            obj[newKey] = val;
          }
        } else {
          shouldRecurse = false;
        }
      }

      return { shouldRecurse, key };
    });

    return { isSanitized, target };
  }

  /**
   * Public sanitize method
   */
  public static sanitize(target: any, options: SanitizeOptions = {}): any {
    return this.sanitizeInternal(target, options).target;
  }

  /**
   * Check if target contains prohibited keys
   */
  public static has(target: any, allowDots: boolean = false): boolean {
    return this.hasProhibitedKeys(target, allowDots);
  }

  /**
   * Create Express middleware for MongoDB injection protection
   */
  public static middleware(
    options: SanitizeOptions = {}
  ): (req: Request, res: Response, next: NextFunction) => void {
    const hasOnSanitize = typeof options.onSanitize === 'function';

    return (req: Request, res: Response, next: NextFunction): void => {
      try {
        const sanitizeTargets = ['body', 'params', 'headers', 'query'] as const;

        sanitizeTargets.forEach(key => {
          const targetValue = (req as any)[key];
          if (targetValue) {
            const { target, isSanitized } = this.sanitizeInternal(
              targetValue,
              options
            );

            // Only update if sanitization occurred and we're not in dry run mode
            if (isSanitized && !options.dryRun) {
              (req as any)[key] = target;

              if (hasOnSanitize) {
                options.onSanitize!({ req, key });
              }
            }
          }
        });

        next();
      } catch {
        // Silently continue if sanitization fails - don't break the request flow
        next();
      }
    };
  }
}

/**
 * Main middleware function
 */
function mongoSanitize(options: SanitizeOptions = {}) {
  return MongoSanitizer.middleware(options);
}

/**
 * Add static methods to the function
 */
mongoSanitize.sanitize = MongoSanitizer.sanitize;
mongoSanitize.has = MongoSanitizer.has;

/**
 * Default middleware instance with standard configuration
 * Note: Sanitization happens silently without logging to avoid noise
 */
export const mongoSanitizeDefault = MongoSanitizer.middleware({
  replaceWith: '_',
});

/**
 * Export the main function as default
 */
export default mongoSanitize;

/**
 * Export the class for advanced usage
 */
export { MongoSanitizer };

/**
 * Export types for external use
 */
export type { SanitizeOptions, SanitizeResult };
