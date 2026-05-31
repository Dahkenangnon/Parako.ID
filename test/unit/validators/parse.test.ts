import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { safeParseOrIssues } from '../../../src/validators/parse.js';

const schema = z.object({
  page: z.coerce.number().int().min(1),
  email: z.email(),
});

describe('safeParseOrIssues', () => {
  it('returns ok=true with the parsed value on success', () => {
    const result = safeParseOrIssues(schema, {
      page: '5',
      email: 'a@b.io',
    });
    expect(result).toEqual({
      ok: true,
      data: { page: 5, email: 'a@b.io' },
    });
  });

  it('returns ok=false with one issue per failed field', () => {
    const result = safeParseOrIssues(schema, {
      page: '-1',
      email: 'nope',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues).toHaveLength(2);
      const fields = result.issues.map(i => i.field).sort();
      expect(fields).toEqual(['email', 'page']);
      for (const issue of result.issues) {
        expect(typeof issue.message).toBe('string');
        expect(issue.message.length).toBeGreaterThan(0);
      }
    }
  });

  it('reports nested paths joined with dots', () => {
    const nested = z.object({ a: z.object({ b: z.string() }) });
    const result = safeParseOrIssues(nested, { a: { b: 42 } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0].field).toBe('a.b');
    }
  });

  it("uses '(root)' as the field name when the issue path is empty", () => {
    const stringSchema = z.string();
    const result = safeParseOrIssues(stringSchema, 42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues[0].field).toBe('(root)');
    }
  });
});
