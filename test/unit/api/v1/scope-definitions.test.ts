/**
 * Tests for scope definitions and Management API resource constants.
 */

import { describe, it, expect } from 'vitest';
import {
  SCOPES,
  SCOPE_DEFINITIONS,
  ALL_MANAGEMENT_API_SCOPES,
  classifyScope,
  isPlatformOnlyScope,
  PLATFORM_ONLY_SCOPES,
} from '../../../../src/api/v1/scopes.js';

describe('api/v1/scope-definitions', () => {
  describe('ALL_MANAGEMENT_API_SCOPES', () => {
    it('should be a space-separated string of all scopes', () => {
      const allScopeValues = Object.values(SCOPES);
      const scopeArray = ALL_MANAGEMENT_API_SCOPES.split(' ');

      expect(scopeArray).toHaveLength(allScopeValues.length);
      for (const scopeValue of allScopeValues) {
        expect(scopeArray).toContain(scopeValue);
      }
    });

    it('should not contain duplicates', () => {
      const scopeArray = ALL_MANAGEMENT_API_SCOPES.split(' ');
      const uniqueScopes = new Set(scopeArray);
      expect(uniqueScopes.size).toBe(scopeArray.length);
    });
  });

  describe('SCOPE_DEFINITIONS', () => {
    it('should have a definition for every scope in SCOPES', () => {
      const definedValues = new Set(SCOPE_DEFINITIONS.map(d => d.value));
      const allScopeValues = Object.values(SCOPES);

      for (const scopeValue of allScopeValues) {
        expect(
          definedValues.has(scopeValue),
          `Missing definition for scope: ${scopeValue}`
        ).toBe(true);
      }
    });

    it('should not define scopes that are not in SCOPES', () => {
      const allScopeValues = new Set(Object.values(SCOPES));

      for (const def of SCOPE_DEFINITIONS) {
        expect(
          allScopeValues.has(def.value as any),
          `Extra definition for unknown scope: ${def.value}`
        ).toBe(true);
      }
    });

    it('should have required fields on every definition', () => {
      for (const def of SCOPE_DEFINITIONS) {
        expect(def.value).toBeTruthy();
        expect(def.label).toBeTruthy();
        expect(def.description).toBeTruthy();
        expect(def.domain).toBeTruthy();
        expect(['read', 'write', 'destructive']).toContain(def.classification);
      }
    });

    it('should have classifications matching classifyScope()', () => {
      for (const def of SCOPE_DEFINITIONS) {
        expect(
          def.classification,
          `Scope ${def.value}: expected ${classifyScope(def.value)}, got ${def.classification}`
        ).toBe(classifyScope(def.value));
      }
    });

    it('should group scopes by domain', () => {
      const domains = new Set(SCOPE_DEFINITIONS.map(d => d.domain));
      // We expect multiple domains
      expect(domains.size).toBeGreaterThan(3);
    });

    it('should have unique values (no duplicate scope definitions)', () => {
      const values = SCOPE_DEFINITIONS.map(d => d.value);
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });

    it('should mark platform-only scopes correctly', () => {
      const platformDefs = SCOPE_DEFINITIONS.filter(d =>
        isPlatformOnlyScope(d.value)
      );

      // All PLATFORM_ONLY_SCOPES should have definitions
      for (const scope of PLATFORM_ONLY_SCOPES) {
        expect(
          platformDefs.some(d => d.value === scope),
          `Platform-only scope ${scope} not in definitions`
        ).toBe(true);
      }
    });
  });
});
