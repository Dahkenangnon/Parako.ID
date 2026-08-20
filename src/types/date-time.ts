export type SupportedLanguage = 'en' | 'fr';

export interface DateTimeFormatOptions {
  includeTime?: boolean;
  includeYear?: boolean;
  useRelativeTime?: boolean;
  language?: SupportedLanguage;
  /** IANA timezone identifier, for example `America/New_York`. */
  timezone?: string;
  /** Use the server timezone instead of the user's timezone. */
  serverTimezone?: boolean;
}

export interface FormattedDateTimeResult {
  formatted: string;
  isRelative: boolean;
  relativeType?: 'today' | 'yesterday' | 'recent' | 'full';
  timezone?: string;
}
