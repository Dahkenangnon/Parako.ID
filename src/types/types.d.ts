import type { NextFunction, Request, Response } from 'express';
import type {
  FlashContainer,
  SessionData as ParakoSessionData,
} from './session-data.js';

/**
 * Extend Express Response to include translation method
 */
declare global {
  namespace Express {
    interface Response {
      t(key: string, options?: any): string;
      locals: {
        flash?: FlashContainer;
        csrfToken?: string;
        [key: string]: any;
      };
    }
    interface Request {
      t(key: string, options?: any): string;
    }
  }
}

/**
 * Extend Express Request to include translation methods
 */
declare module 'express-serve-static-core' {
  interface Request {
    t(phrase: string, ...replace: any[]): string;
    tn(
      singular: string,
      plural: string,
      count: number,
      ...replace: any[]
    ): string;
  }
}

declare module 'express-session' {
  interface SessionData extends ParakoSessionData {}
}

declare module 'i18n' {
  export interface I18n {
    init(req: Request, res: Response, next: NextFunction): void;
    getLocale(req?: Request): string;
    setLocale(locale: string | Request): void;
    getLocales(): string[];
  }
}

export {};
