import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveEnvVars } from '../../../src/utils/env-interpolation';

describe('resolveEnvVars', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Clean slate for each test
    process.env = { ...savedEnv };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  describe('simple string interpolation', () => {
    it('should resolve a single ${VAR} reference', () => {
      process.env.MY_SECRET = 'hunter2';
      const result = resolveEnvVars('${MY_SECRET}');
      expect(result).toBe('hunter2');
    });

    it('should resolve ${VAR} embedded in a larger string', () => {
      process.env.HOST = 'localhost';
      process.env.PORT = '5432';
      const result = resolveEnvVars('postgres://${HOST}:${PORT}/db');
      expect(result).toBe('postgres://localhost:5432/db');
    });

    it('should throw when a required var is not set', () => {
      delete process.env.MISSING_VAR;
      expect(() => resolveEnvVars('${MISSING_VAR}')).toThrow(
        /environment variable \$\{MISSING_VAR\} is not set/
      );
    });

    it('should include the config path in error messages', () => {
      delete process.env.MISSING_VAR;
      expect(() =>
        resolveEnvVars('${MISSING_VAR}', 'security.secrets.jwt')
      ).toThrow(/Config error at "security\.secrets\.jwt"/);
    });
  });

  describe('default value syntax ${VAR:-default}', () => {
    it('should use env var when set', () => {
      process.env.MY_VAR = 'from-env';
      const result = resolveEnvVars('${MY_VAR:-fallback}');
      expect(result).toBe('from-env');
    });

    it('should use default when env var is not set', () => {
      delete process.env.UNSET_VAR;
      const result = resolveEnvVars('${UNSET_VAR:-fallback-value}');
      expect(result).toBe('fallback-value');
    });

    it('should allow empty default value', () => {
      delete process.env.UNSET_VAR;
      const result = resolveEnvVars('${UNSET_VAR:-}');
      expect(result).toBe('');
    });

    it('should allow default with special characters', () => {
      delete process.env.UNSET_VAR;
      const result = resolveEnvVars('${UNSET_VAR:-auto-generated-if-not-set}');
      expect(result).toBe('auto-generated-if-not-set');
    });
  });

  describe('nested objects', () => {
    it('should resolve vars in nested object values', () => {
      process.env.JWT_SECRET = 'secret123';
      process.env.COOKIE_1 = 'cookie-a';
      const result = resolveEnvVars({
        security: {
          secrets: {
            jwt_secret: '${JWT_SECRET}',
            cookie: '${COOKIE_1}',
          },
        },
      });
      expect(result).toEqual({
        security: {
          secrets: {
            jwt_secret: 'secret123',
            cookie: 'cookie-a',
          },
        },
      });
    });

    it('should report full path in error for nested missing var', () => {
      delete process.env.MISSING;
      expect(() =>
        resolveEnvVars({
          level1: {
            level2: '${MISSING}',
          },
        })
      ).toThrow(/Config error at "level1\.level2"/);
    });
  });

  describe('arrays', () => {
    it('should resolve vars in arrays', () => {
      process.env.SECRET_1 = 'aaa';
      process.env.SECRET_2 = 'bbb';
      const result = resolveEnvVars(['${SECRET_1}', '${SECRET_2}']);
      expect(result).toEqual(['aaa', 'bbb']);
    });

    it('should report array index in error path', () => {
      delete process.env.MISSING;
      expect(() => resolveEnvVars(['ok', '${MISSING}'])).toThrow(/\[1\]/);
    });
  });

  describe('non-string passthrough', () => {
    it('should pass through numbers unchanged', () => {
      expect(resolveEnvVars(42)).toBe(42);
    });

    it('should pass through booleans unchanged', () => {
      expect(resolveEnvVars(true)).toBe(true);
      expect(resolveEnvVars(false)).toBe(false);
    });

    it('should pass through null unchanged', () => {
      expect(resolveEnvVars(null)).toBe(null);
    });

    it('should pass through undefined unchanged', () => {
      expect(resolveEnvVars(undefined)).toBe(undefined);
    });

    it('should not touch strings without ${} syntax', () => {
      expect(resolveEnvVars('plain string')).toBe('plain string');
    });
  });

  describe('empty string handling', () => {
    it('should treat empty string env var as unset for required vars', () => {
      process.env.EMPTY_VAR = '';
      expect(() => resolveEnvVars('${EMPTY_VAR}')).toThrow(
        /environment variable \$\{EMPTY_VAR\} is not set/
      );
    });

    it('should use default when env var is empty string', () => {
      process.env.EMPTY_VAR = '';
      const result = resolveEnvVars('${EMPTY_VAR:-fallback}');
      expect(result).toBe('fallback');
    });

    it('should use env var value when non-empty', () => {
      process.env.NON_EMPTY = 'value';
      const result = resolveEnvVars('${NON_EMPTY}');
      expect(result).toBe('value');
    });
  });

  describe('variable name validation', () => {
    it('should reject invalid variable names', () => {
      expect(() => resolveEnvVars('${invalid-name}')).toThrow(
        /invalid variable name/i
      );
    });

    it('should reject variable names with spaces', () => {
      expect(() => resolveEnvVars('${HAS SPACE}')).toThrow(
        /invalid variable name/i
      );
    });

    it('should reject variable names starting with a number', () => {
      expect(() => resolveEnvVars('${1INVALID}')).toThrow(
        /invalid variable name/i
      );
    });

    it('should accept valid variable names with underscores and numbers', () => {
      process.env.VALID_VAR_123 = 'ok';
      expect(resolveEnvVars('${VALID_VAR_123}')).toBe('ok');
    });

    it('should validate variable name in default syntax too', () => {
      expect(() => resolveEnvVars('${bad name:-default}')).toThrow(
        /invalid variable name/i
      );
    });
  });

  describe('prototype pollution defense', () => {
    it('should skip __proto__ keys in objects', () => {
      const malicious = JSON.parse(
        '{"__proto__": {"polluted": true}, "safe": "value"}'
      );
      const result = resolveEnvVars(malicious) as Record<string, unknown>;
      expect(result).not.toHaveProperty('__proto__.polluted');
      expect(result).toHaveProperty('safe', 'value');
    });

    it('should skip constructor keys in objects', () => {
      const obj = { constructor: 'evil', normal: 'ok' };
      const result = resolveEnvVars(obj) as Record<string, unknown>;
      expect(result).not.toHaveProperty('constructor');
      expect(result).toHaveProperty('normal', 'ok');
    });

    it('should skip prototype keys in objects', () => {
      const obj = { prototype: 'evil', normal: 'ok' };
      const result = resolveEnvVars(obj) as Record<string, unknown>;
      expect(result).not.toHaveProperty('prototype');
      expect(result).toHaveProperty('normal', 'ok');
    });
  });

  describe('mixed object with non-string values', () => {
    it('should resolve only string values, leaving others intact', () => {
      process.env.NAME = 'parako';
      const result = resolveEnvVars({
        name: '${NAME}',
        port: 9007,
        enabled: true,
        tags: ['${NAME}', 'identity'],
      });
      expect(result).toEqual({
        name: 'parako',
        port: 9007,
        enabled: true,
        tags: ['parako', 'identity'],
      });
    });
  });
});
