import { describe, expect, it } from 'vitest';

import {
  getHttpStatusErrorMessage,
  getUserFriendlyError,
  SocialLoginError,
} from '../../../src/integration/social-login-errors.js';
import type { SocialProvider } from '../../../src/types/social-integration.js';

describe('social login error mapping', () => {
  it('prefers provider-specific guidance over a generic OAuth error', () => {
    expect(getUserFriendlyError('google', 'invalid_grant')).toBe(
      'Your Google authorization has expired. Please sign in again.'
    );
  });

  it.each<{
    provider: SocialProvider;
    error: string;
    expected: string;
  }>([
    {
      provider: 'google',
      error: 'ACCESS_DENIED',
      expected: 'You denied access to your Google account. Please try again.',
    },
    {
      provider: 'google',
      error: 'rate-limit reached',
      expected:
        'Too many sign-in attempts. Please wait a moment and try again.',
    },
    {
      provider: 'google',
      error: 'user cancelled',
      expected: 'Sign-in was cancelled. Please try again.',
    },
    {
      provider: 'google',
      error: 'popup closed',
      expected: 'The sign-in window was closed. Please try again.',
    },
    {
      provider: 'google',
      error: 'origin mismatch',
      expected: 'Configuration error. Please contact support.',
    },
    {
      provider: 'google',
      error: 'redirect URI mismatch',
      expected: 'Configuration error. Please contact support.',
    },
    {
      provider: 'github',
      error: 'bad verification code',
      expected: 'Your GitHub authorization has expired. Please sign in again.',
    },
    {
      provider: 'github',
      error: 'incorrect client credentials',
      expected: 'Configuration error. Please contact support.',
    },
    {
      provider: 'github',
      error: 'redirect uri mismatch',
      expected: 'Configuration error. Please contact support.',
    },
    {
      provider: 'github',
      error: 'rate limit',
      expected:
        'Too many sign-in attempts. Please wait a moment and try again.',
    },
    {
      provider: 'github',
      error: 'access_denied',
      expected: 'You denied access to your GitHub account. Please try again.',
    },
    {
      provider: 'github',
      error: 'bad_credentials',
      expected: 'Invalid credentials. Please try again.',
    },
    {
      provider: 'github',
      error: 'requires authentication',
      expected: 'Authentication required. Please sign in again.',
    },
    {
      provider: 'facebook',
      error: 'user-cancelled',
      expected: 'Sign-in was cancelled. Please try again.',
    },
    {
      provider: 'facebook',
      error: 'rate limit',
      expected:
        'Too many sign-in attempts. Please wait a moment and try again.',
    },
    {
      provider: 'linkedin',
      error: 'user cancelled',
      expected: 'Sign-in was cancelled. Please try again.',
    },
    {
      provider: 'linkedin',
      error: 'rate-limit',
      expected:
        'Too many sign-in attempts. Please wait a moment and try again.',
    },
    {
      provider: 'twitter',
      error: 'user cancelled',
      expected: 'Sign-in was cancelled. Please try again.',
    },
    {
      provider: 'microsoft',
      error: 'user-cancelled',
      expected: 'Sign-in was cancelled. Please try again.',
    },
    {
      provider: 'microsoft',
      error: 'consent required',
      expected: 'Additional permissions are required. Please try again.',
    },
    {
      provider: 'microsoft',
      error: 'interaction required',
      expected: 'Additional verification required. Please sign in again.',
    },
    {
      provider: 'microsoft',
      error: 'invalid_grant',
      expected:
        'Your Microsoft authorization has expired. Please sign in again.',
    },
    {
      provider: 'microsoft',
      error: 'access_denied',
      expected:
        'You denied access to your Microsoft account. Please try again.',
    },
    {
      provider: 'microsoft',
      error: 'AADSTS50020',
      expected: 'Microsoft authentication error. Please try again.',
    },
    {
      provider: 'microsoft',
      error: 'tenant not found',
      expected: 'Organization not found. Please check your account.',
    },
    {
      provider: 'microsoft',
      error: 'user not found',
      expected: 'Account not found. Please check your Microsoft account.',
    },
    {
      provider: 'microsoft',
      error: 'invalid client',
      expected: 'Configuration error. Please contact support.',
    },
    {
      provider: 'microsoft',
      error: 'redirect URI mismatch',
      expected: 'Configuration error. Please contact support.',
    },
    {
      provider: 'apple',
      error: 'user cancelled',
      expected: 'Sign-in was cancelled. Please try again.',
    },
  ])(
    'maps $provider provider error "$error" without leaking technical details',
    ({ provider, error, expected }) => {
      expect(getUserFriendlyError(provider, error)).toBe(expected);
    }
  );

  it.each([
    [
      'access_denied',
      'You denied access to your account. Please try again and grant the required permissions.',
    ],
    ['invalid_request', 'The sign-in request was invalid. Please try again.'],
    [
      'unauthorized_client',
      'This application is not authorized to use this sign-in method.',
    ],
    [
      'unsupported_response_type',
      'The sign-in method is not supported. Please contact support.',
    ],
    [
      'invalid_scope',
      'The requested permissions are not available. Please contact support.',
    ],
    [
      'server_error',
      'The authentication server encountered an error. Please try again later.',
    ],
    [
      'temporarily_unavailable',
      'The authentication service is temporarily unavailable. Please try again later.',
    ],
    [
      'invalid_grant',
      'The authorization code has expired. Please try signing in again.',
    ],
    ['invalid_token', 'Your session has expired. Please sign in again.'],
    ['token_exchange_failed', 'Unable to complete sign-in. Please try again.'],
    [
      'invalid_client',
      'There is a configuration issue with this sign-in method. Please contact support.',
    ],
    [
      'network_error',
      'Unable to connect to the authentication service. Please check your internet connection.',
    ],
    ['timeout', 'The sign-in request timed out. Please try again.'],
    ['state_mismatch', 'Your sign-in session has expired. Please try again.'],
    ['csrf_error', 'Security validation failed. Please try again.'],
  ])('maps the standard error code %s', (error, expected) => {
    expect(getUserFriendlyError('twitter', `Provider returned ${error}`)).toBe(
      expected
    );
  });

  it.each([
    [
      'getaddrinfo ENOTFOUND accounts.example.test',
      'Unable to connect to the authentication service. Please check your internet connection.',
    ],
    [
      'connect ECONNREFUSED 127.0.0.1:443',
      'Unable to connect to the authentication service. Please check your internet connection.',
    ],
    ['request ETIMEDOUT', 'The sign-in request timed out. Please try again.'],
    [
      'certificate has expired',
      'Secure connection error. Please try again or contact support.',
    ],
    [
      'SSL handshake failed',
      'Secure connection error. Please try again or contact support.',
    ],
    [
      'TLS negotiation failed',
      'Secure connection error. Please try again or contact support.',
    ],
  ])('maps transport failure %s', (error, expected) => {
    expect(getUserFriendlyError('apple', error)).toBe(expected);
  });

  it('returns a provider-labelled generic message without technical details', () => {
    const technicalError = 'secret upstream implementation detail';

    expect(getUserFriendlyError('linkedin', technicalError)).toBe(
      'Unable to complete Linkedin sign-in. Please try again.'
    );
    expect(getUserFriendlyError('linkedin', technicalError, false)).toBe(
      'Unable to complete Linkedin sign-in.'
    );
  });

  it('safely falls back when an unknown provider reaches the runtime boundary', () => {
    expect(
      getUserFriendlyError(
        'custom-provider' as SocialProvider,
        'unclassified provider error'
      )
    ).toBe('Unable to complete Custom-provider sign-in. Please try again.');
  });
});

describe('SocialLoginError', () => {
  it('preserves diagnostics separately while exposing only the safe message', () => {
    const error = new SocialLoginError(
      'google',
      'invalid_grant: confidential upstream response'
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SocialLoginError');
    expect(error.provider).toBe('google');
    expect(error.technicalMessage).toBe(
      'invalid_grant: confidential upstream response'
    );
    expect(error.userMessage).toBe(
      'Your Google authorization has expired. Please sign in again.'
    );
    expect(error.message).toBe(error.userMessage);
  });
});

describe('HTTP status error mapping', () => {
  it.each([
    [400, 'Invalid request to Github. Please try again.'],
    [401, 'Authentication with Github failed. Please try signing in again.'],
    [
      403,
      'Access to Github was denied. Please check your account permissions.',
    ],
    [404, 'Github service not found. Please contact support.'],
    [429, 'Too many sign-in attempts. Please wait a moment and try again.'],
    [500, 'Github is temporarily unavailable. Please try again later.'],
    [502, 'Github is temporarily unavailable. Please try again later.'],
    [503, 'Github is temporarily unavailable. Please try again later.'],
    [504, 'Github is temporarily unavailable. Please try again later.'],
    [418, 'Github sign-in failed. Please try again.'],
  ])('maps HTTP status %i', (status, expected) => {
    expect(getHttpStatusErrorMessage('github', status, 'ignored')).toBe(
      expected
    );
  });
});
