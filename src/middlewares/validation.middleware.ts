/**
 * Query Parameter Validation Middleware
 *
 * Provides comprehensive validation for query parameters to prevent:
 * - NoSQL injection via regex patterns
 * - Open redirect vulnerabilities
 * - XSS through unvalidated parameters
 * - Invalid data types causing application errors
 *
 * All validators use express-validator for consistent validation patterns.
 */

import {
  query,
  validationResult,
  type ValidationChain,
} from 'express-validator';
import type { Request, Response, NextFunction } from 'express';

// VALIDATION ERROR HANDLER

/**
 * Middleware to check validation results and return 400 JSON if validation failed
 * Use this after validation chains in API route definitions
 */
export const handleValidationErrors = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array().map(e => ({
        field: 'path' in e ? e.path : 'unknown',
        message: e.msg,
      })),
    });
    return;
  }
  next();
};

/**
 * Factory function to create validation error handler for HTML view pages
 * Shows validation errors as flash messages and redirects back
 * @param sessionManager - Session manager instance for flash messages
 */
export const createValidationErrorsHandlerForViews = (sessionManager: {
  flash: (req: Request) => { error: (msg: string) => void };
}) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const errorMessages = errors
        .array()
        .map(e => `${'path' in e ? e.path : 'Field'}: ${e.msg}`)
        .join(', ');
      sessionManager.flash(req).error(`Validation error: ${errorMessages}`);
      // Referer is attacker-controlled — always redirect to the same path on this origin.
      res.redirect(req.originalUrl.split('?')[0]);
      return;
    }
    next();
  };
};

// COMMON VALIDATORS

/**
 * Pagination validators
 * Validates page and limit query parameters with bounds checking
 */
export const paginationValidators: ValidationChain[] = [
  query('page')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 10000 })
    .withMessage('Page must be a positive integer between 1 and 10000')
    .toInt(),
  query('limit')
    .optional({ values: 'falsy' })
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be a positive integer between 1 and 100')
    .toInt(),
];

// Sort field allowlists — exported so admin controllers can re-use them at
// the controller boundary (defense-in-depth against the validator being
// bypassed). Keep these in sync with the corresponding sortValidators(...)
// calls below.
export const ADMIN_USER_SORT_FIELDS = [
  'created_at',
  'username',
  'email',
  'last_login',
] as const;
export const ADMIN_SESSION_SORT_FIELDS = [
  'loginTime',
  'username',
  'expiresAt',
] as const;
export const ADMIN_ACTIVITY_SORT_FIELDS = [
  'timestamp',
  'created_at',
  'type',
  'status',
  'username',
] as const;
export const SORT_ORDER_VALUES = ['asc', 'desc'] as const;

/**
 * Create sort validators with allowed field whitelist
 * @param allowedFields - Array of field names that can be sorted
 */
export const sortValidators = (
  allowedFields: readonly string[]
): ValidationChain[] => [
  query('sortBy')
    .optional({ values: 'falsy' })
    .isIn(allowedFields)
    .withMessage(`sortBy must be one of: ${allowedFields.join(', ')}`),
  query('sortOrder')
    .optional({ values: 'falsy' })
    .isIn(['asc', 'desc'])
    .withMessage('sortOrder must be either "asc" or "desc"'),
];

/**
 * Search validator with regex character escaping
 * Prevents NoSQL injection via regex operators
 */
export const searchValidator: ValidationChain = query('search')
  .optional({ values: 'falsy' })
  .isString()
  .isLength({ max: 200 })
  .withMessage('Search query must be 200 characters or less')
  .customSanitizer((val: string | undefined) =>
    val?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );

/**
 * Date range validators for filtering by date
 * Uses { values: 'falsy' } to treat empty strings as missing values
 */
export const dateRangeValidators: ValidationChain[] = [
  query('dateFrom')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('dateFrom must be a valid ISO 8601 date'),
  query('dateTo')
    .optional({ values: 'falsy' })
    .isISO8601()
    .withMessage('dateTo must be a valid ISO 8601 date'),
];

/**
 * Username validator with regex escaping for safe database queries
 */
export const usernameValidator: ValidationChain = query('username')
  .optional({ values: 'falsy' })
  .isString()
  .isLength({ max: 100 })
  .withMessage('Username must be 100 characters or less')
  .customSanitizer((val: string | undefined) =>
    val?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );

// AUTH VALIDATORS

/**
 * Auth query parameter validators
 * Validates common authentication-related query parameters
 */
export const authQueryValidators: ValidationChain[] = [
  query('step_message')
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage('step_message must be 200 characters or less'),
  query('continue')
    .optional()
    .custom((value: string) => {
      if (value.startsWith('/') && !value.startsWith('//')) {
        return true;
      }
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol);
      } catch {
        return false;
      }
    })
    .withMessage('continue must be a valid relative path or HTTP(S) URL'),
  query('redirectTo')
    .optional()
    .custom((value: string) => {
      if (value.startsWith('/') && !value.startsWith('//')) {
        return true;
      }
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol);
      } catch {
        return false;
      }
    })
    .withMessage('redirectTo must be a valid relative path or HTTP(S) URL'),
  query('redirect_uri')
    .optional()
    .isURL({ require_protocol: true, protocols: ['http', 'https'] })
    .withMessage('redirect_uri must be a valid HTTP(S) URL'),
  query('prompt')
    .optional()
    .isIn(['login', 'consent', 'none', 'select_account'])
    .withMessage('prompt must be one of: login, consent, none, select_account'),
  query('intent')
    .optional()
    .isIn(['login', 'register', 'add-account'])
    .withMessage('intent must be one of: login, register, add-account'),
  query('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('email must be a valid email address'),
  query('token')
    .optional()
    .isString()
    .isLength({ min: 10, max: 500 })
    .withMessage('token must be between 10 and 500 characters'),
  query('interaction_uid')
    .optional()
    .isString()
    .isLength({ min: 10, max: 100 })
    .withMessage('interaction_uid must be between 10 and 100 characters'),
  query('method')
    .optional()
    .isIn(['totp', 'sms', 'email', 'backup_codes'])
    .withMessage('method must be one of: totp, sms, email, backup_codes'),
  query('status')
    .optional()
    .isIn(['pending', 'active', 'disabled', 'all'])
    .withMessage('status must be one of: pending, active, disabled, all'),
  query('type')
    .optional()
    .isIn(['login', 'logout', 'register', 'mfa', 'password_reset'])
    .withMessage(
      'type must be one of: login, logout, register, mfa, password_reset'
    ),
];

// ADMIN VALIDATORS

/**
 * Admin user list validators
 */
export const adminUserValidators: ValidationChain[] = [
  ...paginationValidators,
  searchValidator,
  query('role')
    .optional({ values: 'falsy' })
    .isIn(['user', 'admin', 'moderator', 'all'])
    .withMessage('role must be one of: user, admin, moderator, all'),
  query('status')
    .optional({ values: 'falsy' })
    .isIn(['all', 'active', 'disabled', 'anonymized'])
    .withMessage('status must be one of: all, active, disabled, anonymized'),
  ...sortValidators(ADMIN_USER_SORT_FIELDS),
];

/**
 * Admin session list validators
 */
export const adminSessionValidators: ValidationChain[] = [
  ...paginationValidators,
  searchValidator,
  usernameValidator,
  query('status')
    .optional({ values: 'falsy' })
    .isIn(['all', 'active', 'expired'])
    .withMessage('status must be one of: all, active, expired'),
  ...sortValidators(ADMIN_SESSION_SORT_FIELDS),
];

/**
 * Admin activity list validators
 */
export const adminActivityValidators: ValidationChain[] = [
  ...paginationValidators,
  searchValidator,
  query('type')
    .optional({ values: 'falsy' })
    .isString()
    .isLength({ max: 50 })
    .withMessage('type must be 50 characters or less'),
  query('status')
    .optional({ values: 'falsy' })
    .isIn(['all', 'success', 'failed', 'info', 'warning'])
    .withMessage('status must be one of: all, success, failed, info, warning'),
  usernameValidator,
  ...dateRangeValidators,
  ...sortValidators(ADMIN_ACTIVITY_SORT_FIELDS),
];

/**
 * Admin grant list validators
 */
export const adminGrantValidators: ValidationChain[] = [
  ...paginationValidators,
  searchValidator,
  query('clientId')
    .optional({ values: 'falsy' })
    .isString()
    .isLength({ max: 100 })
    .withMessage('clientId must be 100 characters or less')
    .customSanitizer((val: string | undefined) =>
      val?.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    ),
  usernameValidator,
  ...sortValidators([
    'createdAt',
    'payload.iat',
    'payload.accountId',
    'payload.clientId',
  ]),
];

/**
 * Admin OIDC client list validators
 */
export const adminOidcClientValidators: ValidationChain[] = [
  ...paginationValidators,
  searchValidator,
  query('application_type')
    .optional({ values: 'falsy' })
    .isIn(['web', 'native', 'spa'])
    .withMessage('application_type must be one of: web, native, spa'),
  query('environment')
    .optional({ values: 'falsy' })
    .isIn(['development', 'staging', 'production', 'all'])
    .withMessage(
      'environment must be one of: development, staging, production, all'
    ),
  query('status')
    .optional({ values: 'falsy' })
    .isIn(['active', 'inactive', 'all'])
    .withMessage('status must be one of: active, inactive, all'),
  query('source')
    .optional({ values: 'falsy' })
    .isIn(['static', 'dynamic', 'database'])
    .withMessage('source must be one of: static, dynamic, database'),
  ...sortValidators([
    'created_at',
    'client_name',
    'application_type',
    'active',
  ]),
];

/**
 * User activities validators (for /users/:id/activities)
 */
export const userActivityValidators: ValidationChain[] = [
  ...paginationValidators,
  query('type')
    .optional()
    .isString()
    .isLength({ max: 50 })
    .withMessage('type must be 50 characters or less'),
];

/**
 * OIDC client source validator (for view/edit/delete operations)
 */
export const oidcClientSourceValidator: ValidationChain = query('source')
  .optional()
  .isIn(['static', 'dynamic', 'database'])
  .withMessage('source must be one of: static, dynamic, database');

/**
 * Logout query validators
 */
export const logoutValidators: ValidationChain[] = [
  query('type')
    .optional()
    .isIn(['single', 'all'])
    .withMessage('type must be either single or all'),
  query('account_id')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('account_id must be 100 characters or less'),
  query('redirect_uri')
    .optional()
    .custom((value: string) => {
      if (value.startsWith('/') && !value.startsWith('//')) {
        return true;
      }
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol);
      } catch {
        return false;
      }
    })
    .withMessage('redirect_uri must be a valid relative path or HTTP(S) URL'),
  query('cancel_url')
    .optional()
    .custom((value: string) => {
      if (value.startsWith('/') && !value.startsWith('//')) {
        return true;
      }
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol);
      } catch {
        return false;
      }
    })
    .withMessage('cancel_url must be a valid relative path or HTTP(S) URL'),
  query('email')
    .optional()
    .isEmail()
    .withMessage('email must be a valid email address'),
  query('name')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('name must be 100 characters or less'),
  query('info')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('info must be true or false'),
  query('secondary')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('secondary must be true or false'),
  query('confirmed')
    .optional()
    .isIn(['true', 'false'])
    .withMessage('confirmed must be true or false'),
  query('next')
    .optional()
    .custom((value: string) => {
      if (value.startsWith('/') && !value.startsWith('//')) {
        return true;
      }
      try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol);
      } catch {
        return false;
      }
    })
    .withMessage('next must be a valid relative path or HTTP(S) URL'),
];

// OAUTH/SOCIAL LOGIN VALIDATORS

/**
 * OAuth callback validators
 * Validates OAuth callback query parameters
 */
export const oauthCallbackValidators: ValidationChain[] = [
  query('code')
    .optional()
    .isString()
    .isLength({ max: 2000 })
    .withMessage('code must be 2000 characters or less'),
  query('state')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('state must be 500 characters or less'),
  query('error')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('error must be 100 characters or less'),
  query('error_description')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('error_description must be 500 characters or less'),
];

/**
 * OIDC interaction validators
 */
export const oidcInteractionValidators: ValidationChain[] = [
  query('uid')
    .optional()
    .isString()
    .isLength({ min: 10, max: 100 })
    .withMessage('uid must be between 10 and 100 characters'),
  query('client_id')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('client_id must be 100 characters or less'),
  query('acr_values')
    .optional()
    .isString()
    .isLength({ max: 200 })
    .withMessage('acr_values must be 200 characters or less'),
];

// MFA METHOD VALIDATOR

/**
 * MFA method validator for account routes
 */
export const mfaMethodValidator: ValidationChain = query('method')
  .optional()
  .isIn(['totp', 'sms', 'email', 'backup_codes'])
  .withMessage('method must be one of: totp, sms, email, backup_codes');

// EXPORTS SUMMARY

/**
 * Available validators:
 *
 * Common:
 * - paginationValidators: page, limit with bounds
 * - sortValidators(fields): sortBy, sortOrder with whitelist
 * - searchValidator: search with regex escaping
 * - dateRangeValidators: dateFrom, dateTo ISO 8601
 * - usernameValidator: username with regex escaping
 *
 * Auth:
 * - authQueryValidators: step_message, continue, redirectTo, prompt, intent, etc.
 * - logoutValidators: type, account_id, redirect_uri, cancel_url, etc.
 *
 * Admin:
 * - adminUserValidators: user listing
 * - adminSessionValidators: session listing
 * - adminActivityValidators: activity listing
 * - adminGrantValidators: grant listing
 * - adminOidcClientValidators: OIDC client listing
 * - userActivityValidators: user activities sub-listing
 * - oidcClientSourceValidator: source parameter for client operations
 *
 * OAuth:
 * - oauthCallbackValidators: code, state, error, error_description
 * - oidcInteractionValidators: uid, client_id, acr_values
 *
 * MFA:
 * - mfaMethodValidator: method selection
 *
 * Error Handling:
 * - handleValidationErrors: middleware to return 400 on validation failure
 *
 * Usage:
 * router.get('/users', [...adminUserValidators, handleValidationErrors], controller.list);
 */
