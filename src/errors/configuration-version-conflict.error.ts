/**
 * Raised when a configuration write targets a revision that is no longer
 * active. The versions are diagnostic metadata only and must not be exposed in
 * public error responses.
 */
export class ConfigurationVersionConflictError extends Error {
  public readonly name = 'ConfigurationVersionConflictError';

  constructor(
    public readonly expectedVersion?: number,
    public readonly actualVersion?: number
  ) {
    super(
      'Configuration was modified by another user. Please refresh the page and try again.'
    );
  }
}
