import { Request, Response, NextFunction } from 'express';

export interface II18nService {
  getLocale(req?: Request): string;
  getLocales(): string[];
  setLocale(localeOrReq: string | Request, locale?: string): void;
  init(req: Request, res: Response, next: NextFunction): void;
  __(phrase: string, ...args: any[]): string;
  __n(phrase: string, count: number, ...args: any[]): string;
  configure(): void;
}
