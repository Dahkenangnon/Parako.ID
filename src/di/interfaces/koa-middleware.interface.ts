import type { Context } from 'koa';

export type KoaRenderContext = Context & {
  oidc?: any;
  state: Record<string, any>;
  locals?: Record<string, any>;
  t?: (phrase: string, ...args: any[]) => string;
  req?: any;
  flash?: any;
  render: (template: string, locals?: Record<string, any>) => Promise<void>;
};

export type KoaI18nContext = Context & {
  oidc?: any;
  state: Record<string, any>;
  t: (phrase: string, ...args: any[]) => string;
  tn: (phrase: string, count: number, ...args: any[]) => string;
  query?: Record<string, string>;
  originalUrl?: string;
  showOIDCDebug?: boolean;
};

export interface IKoaMiddleware {
  getKoaLocale(ctx: KoaI18nContext): string;
  i18nKoaInit(ctx: KoaI18nContext, next: () => Promise<void>): Promise<void>;
  koaLanguageHandler(
    ctx: KoaI18nContext,
    next: () => Promise<void>
  ): Promise<void>;
  koaI18nMiddleware(
    ctx: KoaI18nContext,
    next: () => Promise<void>
  ): Promise<void>;
  renderMiddleware(
    ctx: KoaRenderContext,
    next: () => Promise<void>
  ): Promise<void>;
}
