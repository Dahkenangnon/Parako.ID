import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateEnvVars,
  PARAKO_ENV_SPECS,
  type EnvVarSpec,
} from '../../../src/utils/env-validator';

describe('validateEnvVars', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...savedEnv };
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  it('should pass when all required vars are set', () => {
    process.env.DB_HOST = 'localhost';
    process.env.DB_PORT = '5432';
    const specs: EnvVarSpec[] = [
      { name: 'DB_HOST', required: true, description: 'Database host' },
      { name: 'DB_PORT', required: true, description: 'Database port' },
    ];
    expect(() => validateEnvVars(specs)).not.toThrow();
  });

  it('should throw when a required var is missing', () => {
    delete process.env.MISSING_VAR;
    const specs: EnvVarSpec[] = [
      { name: 'MISSING_VAR', required: true, description: 'A required var' },
    ];
    expect(() => validateEnvVars(specs)).toThrow(
      /Missing or invalid environment variables/
    );
    expect(() => validateEnvVars(specs)).toThrow(/MISSING_VAR/);
  });

  it('should throw when a required var is empty string', () => {
    process.env.EMPTY_VAR = '';
    const specs: EnvVarSpec[] = [
      { name: 'EMPTY_VAR', required: true, description: 'Should not be empty' },
    ];
    expect(() => validateEnvVars(specs)).toThrow(/EMPTY_VAR/);
  });

  it('should not throw for optional missing vars', () => {
    delete process.env.OPTIONAL_VAR;
    const specs: EnvVarSpec[] = [
      { name: 'OPTIONAL_VAR', required: false, description: 'Optional' },
    ];
    expect(() => validateEnvVars(specs)).not.toThrow();
  });

  it('should validate values with custom validator', () => {
    process.env.SHORT_SECRET = 'abc';
    const specs: EnvVarSpec[] = [
      {
        name: 'SHORT_SECRET',
        required: false,
        description: 'Min 32 chars',
        validator: (v: string) => v.length >= 32,
      },
    ];
    expect(() => validateEnvVars(specs)).toThrow(/SHORT_SECRET/);
    expect(() => validateEnvVars(specs)).toThrow(/invalid value/);
  });

  it('should pass validation when validator returns true', () => {
    process.env.GOOD_SECRET = 'a'.repeat(32);
    const specs: EnvVarSpec[] = [
      {
        name: 'GOOD_SECRET',
        required: false,
        description: 'Min 32 chars',
        validator: (v: string) => v.length >= 32,
      },
    ];
    expect(() => validateEnvVars(specs)).not.toThrow();
  });

  it('should not run validator when var is not set', () => {
    delete process.env.UNSET;
    const specs: EnvVarSpec[] = [
      {
        name: 'UNSET',
        required: false,
        description: 'Optional with validator',
        validator: () => false, // Would fail if called
      },
    ];
    expect(() => validateEnvVars(specs)).not.toThrow();
  });

  it('should list all missing vars in error message', () => {
    delete process.env.VAR_A;
    delete process.env.VAR_B;
    const specs: EnvVarSpec[] = [
      { name: 'VAR_A', required: true, description: 'First var' },
      { name: 'VAR_B', required: true, description: 'Second var' },
    ];
    try {
      validateEnvVars(specs);
      expect.unreachable('Should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain('VAR_A');
      expect(msg).toContain('VAR_B');
      expect(msg).toContain('First var');
      expect(msg).toContain('Second var');
    }
  });

  describe('PARAKO_ENV_SPECS validators', () => {
    it('should have an ENCRYPTION_KEY spec with hex validator', () => {
      const spec = PARAKO_ENV_SPECS.find(s => s.name === 'ENCRYPTION_KEY');
      expect(spec).toBeDefined();
      expect(spec!.validator).toBeDefined();
      // Valid: 64 hex chars
      expect(spec!.validator!('a'.repeat(64))).toBe(true);
      // Invalid: too short
      expect(spec!.validator!('abc')).toBe(false);
      // Invalid: non-hex
      expect(spec!.validator!('g'.repeat(64))).toBe(false);
    });

    it('should have COOKIE_SECRET specs with length validators', () => {
      const spec1 = PARAKO_ENV_SPECS.find(s => s.name === 'COOKIE_SECRET_1');
      const spec2 = PARAKO_ENV_SPECS.find(s => s.name === 'COOKIE_SECRET_2');
      expect(spec1).toBeDefined();
      expect(spec2).toBeDefined();
      expect(spec1!.validator).toBeDefined();
      // Valid: 16+ chars
      expect(spec1!.validator!('a'.repeat(16))).toBe(true);
      // Invalid: too short
      expect(spec1!.validator!('short')).toBe(false);
    });

    it('should have a JWT_SECRET spec with length validator', () => {
      const spec = PARAKO_ENV_SPECS.find(s => s.name === 'JWT_SECRET');
      expect(spec).toBeDefined();
      expect(spec!.validator).toBeDefined();
      expect(spec!.validator!('a'.repeat(32))).toBe(true);
      expect(spec!.validator!('short')).toBe(false);
    });
  });
});
