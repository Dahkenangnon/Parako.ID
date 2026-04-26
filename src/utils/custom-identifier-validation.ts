/**
 * Custom identifier validation utilities
 *
 * Pure functions with no DI dependencies for validating and normalizing
 * custom identifier field values.
 */

/**
 * Custom identifier field configuration (subset needed for validation)
 */
export interface CustomIdentifierValidationConfig {
  validation_type: 'none' | 'regex' | 'charset_mask';
  pattern?: string;
  charset?: string;
  mask?: string;
  min_length?: number;
  max_length?: number;
  case_sensitive?: boolean;
}

/**
 * Predefined character sets for charset_mask validation
 */
export const CHARSETS: Record<string, string> = {
  digits: '0123456789',
  base20: '0123456789BCDFGHJKLMNPQRSTVWXYZ',
  alphanumeric:
    '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  uppercase_alphanumeric: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  hex: '0123456789ABCDEFabcdef',
};

/**
 * Normalize a value for storage: trim whitespace, convert empty/whitespace to null
 */
export function normalizeIdentifierForStorage(
  value: string | undefined | null
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Normalize a value for lookup: trim and optionally lowercase
 */
export function normalizeIdentifierForLookup(
  value: string,
  caseSensitive: boolean
): string {
  const trimmed = value.trim();
  return caseSensitive ? trimmed : trimmed.toLowerCase();
}

/**
 * Check if a regex pattern is safe (no ReDoS risk)
 * Rejects: nested quantifiers, backreferences, patterns > 200 chars
 */
export function isRegexSafe(pattern: string): boolean {
  if (pattern.length > 200) return false;

  // Reject backreferences
  if (/\\[1-9]/.test(pattern)) return false;

  // Reject nested quantifiers like (a+)+ or (a*)*
  // Simple heuristic: check for quantifier followed by another quantifier
  if (/(\+|\*|\{[^}]+\})(\+|\*|\{[^}]+\}|\?)/.test(pattern)) return false;

  // Reject patterns with multiple adjacent quantified groups
  if (/\([^)]*[+*][^)]*\)[+*?{]/.test(pattern)) return false;

  // Try to compile the regex to catch syntax errors
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

/**
 * Validate a value against a regex pattern
 * Caps value length at 100 chars to prevent excessive backtracking
 */
export function validateWithRegex(value: string, pattern: string): boolean {
  if (value.length > 100) return false;
  try {
    // Anchor the pattern to require a full match (prevent partial matches)
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return false;
  }
}

/**
 * Validate a value against a charset + mask pattern
 *
 * Mask uses '*' for value characters and any other char as a literal separator.
 * Example: charset='digits', mask='***-*-***' validates '123-4-567'
 */
export function validateCharsetMask(
  value: string,
  charsetName: string,
  mask: string
): boolean {
  const charsetChars = CHARSETS[charsetName];
  if (!charsetChars) return false;

  if (value.length !== mask.length) return false;

  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === '*') {
      // Value char must be in the charset
      if (!charsetChars.includes(value[i])) return false;
    } else {
      // Value char must match the literal separator
      if (value[i] !== mask[i]) return false;
    }
  }

  return true;
}

/**
 * Validate an identifier value against its field configuration
 */
export function validateIdentifier(
  value: string,
  fieldConfig: CustomIdentifierValidationConfig
): boolean {
  const minLen = fieldConfig.min_length ?? 1;
  const maxLen = fieldConfig.max_length ?? 100;

  if (value.length < minLen || value.length > maxLen) return false;

  switch (fieldConfig.validation_type) {
    case 'none':
      return true;

    case 'regex':
      if (!fieldConfig.pattern) return true;
      return validateWithRegex(value, fieldConfig.pattern);

    case 'charset_mask':
      if (!fieldConfig.charset || !fieldConfig.mask) return true;
      return validateCharsetMask(value, fieldConfig.charset, fieldConfig.mask);

    default:
      return true;
  }
}
