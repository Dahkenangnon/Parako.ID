/**
 * Type declarations for Helmet security middleware
 */

declare module 'helmet' {
  import { RequestHandler } from 'express';

  interface HelmetOptions {
    contentSecurityPolicy?:
      | boolean
      | { directives: Record<string, Array<string>> };
    crossOriginEmbedderPolicy?: boolean | { policy: string };
    crossOriginOpenerPolicy?: boolean | { policy: string };
    crossOriginResourcePolicy?: boolean | { policy: string };
    dnsPrefetchControl?: boolean | { allow: boolean };
    expectCt?:
      | boolean
      | { maxAge: number; enforce: boolean; reportUri?: string };
    frameguard?: boolean | { action: 'deny' | 'sameorigin' };
    hidePoweredBy?: boolean;
    hsts?:
      | boolean
      | {
          maxAge: number;
          includeSubDomains?: boolean;
          preload?: boolean;
        };
    ieNoOpen?: boolean;
    noSniff?: boolean;
    originAgentCluster?: boolean;
    permittedCrossDomainPolicies?: boolean | { permittedPolicies: string };
    referrerPolicy?: boolean | { policy: string | string[] };
    xssFilter?: boolean | { setOnOldIE: boolean };
    [key: string]: any;
  }

  /**
   * Helmet middleware function
   */
  function helmet(options?: HelmetOptions): RequestHandler;

  export = helmet;
}
