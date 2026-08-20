import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import mongoSanitize, {
  MongoSanitizer,
} from '../../../src/middlewares/mongo-sanitize.middleware.js';

describe('mongoSanitize', () => {
  it('sanitizes prohibited keys nested below a renamed prohibited parent', () => {
    const input = {
      $account: {
        $where: 'this.password.length > 0',
        profile: {
          'display.name': 'Maria',
        },
      },
    };

    const sanitized = mongoSanitize.sanitize(input, { replaceWith: '_' });

    expect(sanitized).toEqual({
      _account: {
        _where: 'this.password.length > 0',
        profile: {
          display_name: 'Maria',
        },
      },
    });
    expect(mongoSanitize.has(sanitized)).toBe(false);
  });

  it('detects prohibited keys recursively in objects and arrays', () => {
    expect(
      mongoSanitize.has({
        safe: [{ nested: true }, { deeper: { $operator: 1 } }],
      })
    ).toBe(true);
    expect(MongoSanitizer.has({ profile: { name: 'Maria' } })).toBe(false);
    expect(MongoSanitizer.has(null)).toBe(false);
    expect(MongoSanitizer.has('plain value')).toBe(false);
  });

  it('allows dotted keys only when explicitly configured', () => {
    const value = { 'profile.name': 'Maria' };

    expect(mongoSanitize.has(value)).toBe(true);
    expect(mongoSanitize.has(value, true)).toBe(false);
    expect(mongoSanitize.has({ $profile: 'Maria' }, true)).toBe(true);
  });

  it('removes prohibited keys when no safe replacement is requested', () => {
    const input = {
      safe: true,
      $where: 'return true',
      nested: { 'profile.name': 'Maria', keep: 'value' },
    };

    expect(mongoSanitize.sanitize(input)).toEqual({
      safe: true,
      nested: { keep: 'value' },
    });
  });

  it.each(['$', '.', 'bad$key', 'bad.key'])(
    'rejects unsafe replacement token %s and removes prohibited keys',
    replaceWith => {
      const input = { $where: 'return true' };

      expect(mongoSanitize.sanitize(input, { replaceWith })).toEqual({});
    }
  );

  it.each([
    { key: 'construct.r', replaceWith: 'o' },
    { key: '__prot.__', replaceWith: 'o' },
    { key: 'prototyp.', replaceWith: 'e' },
  ])(
    'does not create prototype-sensitive key from $key',
    ({ key, replaceWith }) => {
      const input = { [key]: { $nested: true } };

      const sanitized = mongoSanitize.sanitize(input, { replaceWith });

      expect(sanitized).toEqual({});
      expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype);
    }
  );

  it('does not overwrite an existing safe key during replacement', () => {
    const input = {
      _where: 'legitimate value',
      $where: 'malicious value',
    };

    expect(mongoSanitize.sanitize(input, { replaceWith: '_' })).toEqual({
      _where: 'legitimate value',
    });
  });

  it('supports dry-run detection without mutating the input', () => {
    const input = { $where: { 'profile.name': 'Maria' } };
    const snapshot = structuredClone(input);

    const result = mongoSanitize.sanitize(input, {
      replaceWith: '_',
      dryRun: true,
    });

    expect(result).toBe(input);
    expect(input).toEqual(snapshot);
    expect(mongoSanitize.has(input)).toBe(true);
  });

  it('preserves dots while removing dollar-prefixed keys when dots are allowed', () => {
    const input = {
      'profile.name': 'Maria',
      $where: 'return true',
      nested: [{ 'contact.email': 'maria@example.test' }],
    };

    expect(mongoSanitize.sanitize(input, { allowDots: true })).toEqual({
      'profile.name': 'Maria',
      nested: [{ 'contact.email': 'maria@example.test' }],
    });
  });

  it('preserves allowed dots when replacing a dollar sign', () => {
    const input = { '$profile.name': 'Maria' };

    expect(
      mongoSanitize.sanitize(input, { allowDots: true, replaceWith: '_' })
    ).toEqual({ '_profile.name': 'Maria' });
  });

  it('sanitizes every populated Express request target and reports each target', () => {
    const onSanitize = vi.fn();
    const middleware = mongoSanitize({ replaceWith: '_', onSanitize });
    const req = {
      body: { $body: { $nested: true } },
      params: { 'param.name': 'value' },
      headers: { $header: 'value' },
      query: { safe: 'value' },
    } as unknown as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(req.body).toEqual({ _body: { _nested: true } });
    expect(req.params).toEqual({ param_name: 'value' });
    expect(req.headers).toEqual({ _header: 'value' });
    expect(req.query).toEqual({ safe: 'value' });
    expect(onSanitize.mock.calls.map(([event]) => event.key)).toEqual([
      'body',
      'params',
      'headers',
    ]);
    expect(onSanitize.mock.calls.every(([event]) => event.req === req)).toBe(
      true
    );
    expect(next).toHaveBeenCalledOnce();
  });

  it('sanitizes request targets when no callback is configured', () => {
    const req = { body: { $where: 'return true' } } as Request;
    const next = vi.fn() as NextFunction;

    mongoSanitize()(req, {} as Response, next);

    expect(req.body).toEqual({});
    expect(next).toHaveBeenCalledOnce();
  });

  it('sanitizes and reports an inherited getter-only req.query from Express 5', () => {
    const query = { $where: 'return true' };
    const prototype = Object.create(null) as Record<string, unknown>;
    Object.defineProperty(prototype, 'query', {
      configurable: true,
      get: () => query,
    });
    const req = Object.create(prototype) as Request;
    const onSanitize = vi.fn();
    const next = vi.fn() as NextFunction;

    mongoSanitize({ replaceWith: '_', onSanitize })(req, {} as Response, next);

    expect(req.query).toEqual({ _where: 'return true' });
    expect(onSanitize).toHaveBeenCalledWith({ req, key: 'query' });
    expect(next).toHaveBeenCalledOnce();
  });

  it('skips absent request targets', () => {
    const middleware = mongoSanitize();
    const req = {} as Request;
    const next = vi.fn() as NextFunction;

    middleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it('does not mutate or report request targets in dry-run mode', () => {
    const onSanitize = vi.fn();
    const middleware = mongoSanitize({ dryRun: true, onSanitize });
    const req = { body: { $where: 'return true' } } as Request;
    const next = vi.fn() as NextFunction;

    middleware(req, {} as Response, next);

    expect(req.body).toEqual({ $where: 'return true' });
    expect(onSanitize).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledOnce();
  });

  it('propagates target traversal failures instead of continuing unsanitized', () => {
    const error = new Error('unreadable body');
    const middleware = mongoSanitize();
    const req = {
      body: new Proxy(
        {},
        {
          ownKeys() {
            throw error;
          },
        }
      ),
    } as Request;
    const next = vi.fn() as NextFunction;

    expect(() => middleware(req, {} as Response, next)).not.toThrow();
    expect(next).toHaveBeenCalledWith(error);
  });
});
