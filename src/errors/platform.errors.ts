/**
 * Platform-specific error classes.
 * Used for clean error discrimination in platform admin operations.
 */

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

export class ReservedSlugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReservedSlugError';
  }
}

export class ProtectedTenantError extends Error {
  constructor(message = 'The platform master tenant cannot be modified') {
    super(message);
    this.name = 'ProtectedTenantError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}
