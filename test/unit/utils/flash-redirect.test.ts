import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';

import {
  flashAndRedirect,
  isSameOriginPath,
} from '../../../src/utils/flash-redirect.js';

function makeDeps() {
  const flashApi = {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  };
  const sessionManager = {
    flash: vi.fn().mockReturnValue(flashApi),
  };
  return { deps: { sessionManager }, flashApi };
}

function makeRes() {
  return { redirect: vi.fn() } as unknown as Response;
}

describe('isSameOriginPath', () => {
  it.each([['/'], ['/admin'], ['/admin/users'], ['/path?query=1']])(
    'accepts %s',
    path => {
      expect(isSameOriginPath(path)).toBe(true);
    }
  );

  it.each([
    ['//evil.com'],
    ['https://evil.com'],
    ['http://evil.com'],
    ['javascript:alert(1)'],
    ['data:text/html,<script>1</script>'],
    ['file:///etc/passwd'],
    ['admin/users'],
    [''],
    ['//attacker.example.com/login'],
    ['  /admin'],
  ])('rejects %s', path => {
    expect(isSameOriginPath(path)).toBe(false);
  });
});

describe('flashAndRedirect', () => {
  it('sets the flash and redirects on a same-origin pathname', () => {
    const { deps, flashApi } = makeDeps();
    const res = makeRes();
    flashAndRedirect(deps, {} as Request, res, 'success', 'all good', '/admin');
    expect(flashApi.success).toHaveBeenCalledWith('all good');
    expect(res.redirect).toHaveBeenCalledWith('/admin');
  });

  it('throws on a protocol-relative path', () => {
    const { deps } = makeDeps();
    expect(() =>
      flashAndRedirect(
        deps,
        {} as Request,
        makeRes(),
        'error',
        'oops',
        '//evil.com'
      )
    ).toThrow(/non-same-origin/);
  });

  it('throws on a fully-qualified URL', () => {
    const { deps } = makeDeps();
    expect(() =>
      flashAndRedirect(
        deps,
        {} as Request,
        makeRes(),
        'error',
        'oops',
        'https://evil.com/login'
      )
    ).toThrow(/non-same-origin/);
  });

  it('throws on javascript: scheme', () => {
    const { deps } = makeDeps();
    expect(() =>
      flashAndRedirect(
        deps,
        {} as Request,
        makeRes(),
        'error',
        'oops',
        'javascript:alert(1)'
      )
    ).toThrow(/non-same-origin/);
  });
});
