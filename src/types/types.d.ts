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

/**
 * Extend Express Session with our custom session data
 */
declare module 'express-session' {
  interface SessionData {
    /**
     * Container for authenticated user accounts
     * This is the primary source for user identity information
     */
    authenticatedUsers?: AuthenticatedUsers;
    /** Whether the user is currently authenticated */
    isAuthenticated?: boolean;
    /** Timestamp when authentication occurred */
    authTime?: number;
    /** Timestamp of last user activity */
    lastActivity?: number;
    /** Timestamp when the session was created */
    created?: number;
    /** User's IP address */
    ipAddress?: string;
    /** User's browser/client information */
    userAgent?: string;
    /** Unique device identifier */
    deviceId?: string;
    /** CSRF protection token */
    csrfToken?: string;
    /** Flash messages container */
    flash?: FlashContainer;
    /** Allow any additional custom properties */
    [key: string]: any;
  }
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
