/**
 * Social Login Error Mapping
 *
 * Maps technical OAuth/provider errors to user-friendly messages.
 * This prevents exposing internal error details to users while
 * providing helpful guidance.
 */

import type { SocialProvider } from '../types/social-integration.js';
import { capitalizeFirstLetter } from '../utils/misc.js';

/**
 * Common OAuth error codes and their user-friendly messages
 */
const OAUTH_ERROR_MAP: Record<string, string> = {
  // OAuth 2.0 standard errors
  access_denied:
    'You denied access to your account. Please try again and grant the required permissions.',
  invalid_request: 'The sign-in request was invalid. Please try again.',
  unauthorized_client:
    'This application is not authorized to use this sign-in method.',
  unsupported_response_type:
    'The sign-in method is not supported. Please contact support.',
  invalid_scope:
    'The requested permissions are not available. Please contact support.',
  server_error:
    'The authentication server encountered an error. Please try again later.',
  temporarily_unavailable:
    'The authentication service is temporarily unavailable. Please try again later.',
  invalid_grant:
    'The authorization code has expired. Please try signing in again.',
  invalid_token: 'Your session has expired. Please sign in again.',

  token_exchange_failed: 'Unable to complete sign-in. Please try again.',
  invalid_client:
    'There is a configuration issue with this sign-in method. Please contact support.',

  network_error:
    'Unable to connect to the authentication service. Please check your internet connection.',
  timeout: 'The sign-in request timed out. Please try again.',

  state_mismatch: 'Your sign-in session has expired. Please try again.',
  csrf_error: 'Security validation failed. Please try again.',
};

/**
 * Provider-specific error patterns and their user-friendly messages
 */
const PROVIDER_ERROR_PATTERNS: Record<
  SocialProvider,
  Array<{ pattern: RegExp; message: string }>
> = {
  google: [
    {
      pattern: /invalid_grant/i,
      message: 'Your Google authorization has expired. Please sign in again.',
    },
    {
      pattern: /access_denied/i,
      message: 'You denied access to your Google account. Please try again.',
    },
    {
      pattern: /rate.?limit/i,
      message: 'Too many sign-in attempts. Please wait a moment and try again.',
    },
    {
      pattern: /user.?cancelled/i,
      message: 'Sign-in was cancelled. Please try again.',
    },
    {
      pattern: /popup.?closed/i,
      message: 'The sign-in window was closed. Please try again.',
    },
    {
      pattern: /origin.?mismatch/i,
      message: 'Configuration error. Please contact support.',
    },
    {
      pattern: /redirect.?uri.?mismatch/i,
      message: 'Configuration error. Please contact support.',
    },
  ],
  github: [
    {
      pattern: /bad.?verification.?code/i,
      message: 'Your GitHub authorization has expired. Please sign in again.',
    },
    {
      pattern: /incorrect.?client.?credentials/i,
      message: 'Configuration error. Please contact support.',
    },
    {
      pattern: /redirect.?uri.?mismatch/i,
      message: 'Configuration error. Please contact support.',
    },
    {
      pattern: /rate.?limit/i,
      message: 'Too many sign-in attempts. Please wait a moment and try again.',
    },
    {
      pattern: /access_denied/i,
      message: 'You denied access to your GitHub account. Please try again.',
    },
    {
      pattern: /bad_credentials/i,
      message: 'Invalid credentials. Please try again.',
    },
    {
      pattern: /requires.?authentication/i,
      message: 'Authentication required. Please sign in again.',
    },
  ],
  facebook: [
    {
      pattern: /user.?cancelled/i,
      message: 'Sign-in was cancelled. Please try again.',
    },
    {
      pattern: /rate.?limit/i,
      message: 'Too many sign-in attempts. Please wait a moment and try again.',
    },
  ],
  linkedin: [
    {
      pattern: /user.?cancelled/i,
      message: 'Sign-in was cancelled. Please try again.',
    },
    {
      pattern: /rate.?limit/i,
      message: 'Too many sign-in attempts. Please wait a moment and try again.',
    },
  ],
  twitter: [
    {
      pattern: /user.?cancelled/i,
      message: 'Sign-in was cancelled. Please try again.',
    },
  ],
  microsoft: [
    {
      pattern: /user.?cancelled/i,
      message: 'Sign-in was cancelled. Please try again.',
    },
    {
      pattern: /consent.?required/i,
      message: 'Additional permissions are required. Please try again.',
    },
    {
      pattern: /interaction.?required/i,
      message: 'Additional verification required. Please sign in again.',
    },
    {
      pattern: /invalid_grant/i,
      message:
        'Your Microsoft authorization has expired. Please sign in again.',
    },
    {
      pattern: /access_denied/i,
      message: 'You denied access to your Microsoft account. Please try again.',
    },
    {
      pattern: /AADSTS\d+/i,
      message: 'Microsoft authentication error. Please try again.',
    },
    {
      pattern: /tenant.?not.?found/i,
      message: 'Organization not found. Please check your account.',
    },
    {
      pattern: /user.?not.?found/i,
      message: 'Account not found. Please check your Microsoft account.',
    },
    {
      pattern: /invalid.?client/i,
      message: 'Configuration error. Please contact support.',
    },
    {
      pattern: /redirect.?uri.?mismatch/i,
      message: 'Configuration error. Please contact support.',
    },
  ],
  apple: [
    {
      pattern: /user.?cancelled/i,
      message: 'Sign-in was cancelled. Please try again.',
    },
  ],
};

/**
 * Get a user-friendly error message for a social login error
 *
 * @param provider - The social provider (google, github, etc.)
 * @param technicalError - The technical error message
 * @param includeRetry - Whether to include retry suggestion (default true)
 * @returns User-friendly error message
 */
export function getUserFriendlyError(
  provider: SocialProvider,
  technicalError: string,
  includeRetry: boolean = true
): string {
  const errorLower = technicalError.toLowerCase();

  for (const [code, message] of Object.entries(OAUTH_ERROR_MAP)) {
    if (errorLower.includes(code)) {
      return message;
    }
  }

  const providerPatterns = PROVIDER_ERROR_PATTERNS[provider] || [];
  for (const { pattern, message } of providerPatterns) {
    if (pattern.test(technicalError)) {
      return message;
    }
  }

  if (errorLower.includes('enotfound') || errorLower.includes('econnrefused')) {
    return 'Unable to connect to the authentication service. Please check your internet connection.';
  }

  if (errorLower.includes('etimedout') || errorLower.includes('timeout')) {
    return 'The sign-in request timed out. Please try again.';
  }

  if (
    errorLower.includes('certificate') ||
    errorLower.includes('ssl') ||
    errorLower.includes('tls')
  ) {
    return 'Secure connection error. Please try again or contact support.';
  }

  // Generic fallback - don't expose technical details
  const providerName = capitalizeFirstLetter(provider);
  const baseMessage = `Unable to complete ${providerName} sign-in.`;

  return includeRetry ? `${baseMessage} Please try again.` : baseMessage;
}

/**
 * Create a social login error with both technical and user-friendly messages
 */
export class SocialLoginError extends Error {
  public readonly provider: SocialProvider;
  public readonly technicalMessage: string;
  public readonly userMessage: string;

  constructor(provider: SocialProvider, technicalMessage: string) {
    const userMessage = getUserFriendlyError(provider, technicalMessage);
    super(userMessage);
    this.name = 'SocialLoginError';
    this.provider = provider;
    this.technicalMessage = technicalMessage;
    this.userMessage = userMessage;
  }
}

/**
 * HTTP status code to error message mapping for provider API errors
 */
export function getHttpStatusErrorMessage(
  provider: SocialProvider,
  status: number,
  _statusText?: string
): string {
  const providerName = capitalizeFirstLetter(provider);

  switch (status) {
    case 400:
      return `Invalid request to ${providerName}. Please try again.`;
    case 401:
      return `Authentication with ${providerName} failed. Please try signing in again.`;
    case 403:
      return `Access to ${providerName} was denied. Please check your account permissions.`;
    case 404:
      return `${providerName} service not found. Please contact support.`;
    case 429:
      return 'Too many sign-in attempts. Please wait a moment and try again.';
    case 500:
    case 502:
    case 503:
    case 504:
      return `${providerName} is temporarily unavailable. Please try again later.`;
    default:
      return `${providerName} sign-in failed. Please try again.`;
  }
}
