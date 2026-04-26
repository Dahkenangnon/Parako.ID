import { Express, Request } from 'express';
import { Provider } from 'oidc-provider';
import { KoaContextWithOIDC } from 'oidc-provider';

export interface IOIDCMiddleware {
  applyOidcMiddleware(app: Express, provider: Provider): void;
  postMiddleware(ctx: KoaContextWithOIDC): Promise<void>;
  preMiddleware(ctx: KoaContextWithOIDC): Promise<void>;
  safelyDestroySession(req: Request, callback: () => void): Promise<void>;
}
