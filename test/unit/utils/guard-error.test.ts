import { describe, expect, it } from 'vitest';
import { GuardError } from '../../../src/utils/guard-error.js';

describe('GuardError', () => {
  it('carries an HTTP guard status and defaults to error-level rendering', () => {
    const error = new GuardError('Access denied', { status: 403 });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('GuardError');
    expect(error.message).toBe('Access denied');
    expect(error.status).toBe(403);
    expect(error.redirectTo).toBeUndefined();
    expect(error.flashMessage).toBeUndefined();
    expect(error.flashLevel).toBe('error');
  });

  it('preserves explicit flash-and-redirect options', () => {
    const error = new GuardError('Activity not found', {
      status: 404,
      redirectTo: '/admin/activities',
      flashMessage: 'Activity not found',
      flashLevel: 'warning',
    });

    expect(error.status).toBe(404);
    expect(error.redirectTo).toBe('/admin/activities');
    expect(error.flashMessage).toBe('Activity not found');
    expect(error.flashLevel).toBe('warning');
  });
});
