export interface RedirectIntent {
  url: string;
  intent: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export interface RedirectValidationOptions {
  allowLocal?: boolean;
  requireHttps?: boolean;
  maxLength?: number;
  customValidator?: (url: string) => boolean;
}

export interface RedirectValidationResult {
  isValid: boolean;
  url: string | null;
  reason?: string;
}

export interface IRedirectBuilder {
  to(url: string | undefined): IRedirectBuilder;
  or(fallbackUrl: string): IRedirectBuilder;
  withOptions(options: RedirectValidationOptions): IRedirectBuilder;
}
