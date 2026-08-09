/**
 * Zod validation schemas for tenant create and configuration update
 * request bodies.
 *
 * These schemas enforce the shape and constraints of incoming payloads
 * before they reach the controller logic.
 */

import { z } from 'zod';

const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))*$/;

const optionalTenantDomain = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .refine(value => value === '' || HOSTNAME_PATTERN.test(value), {
    message: 'Domain must be a hostname without a scheme, port, or path',
  })
  .transform(value => value || undefined)
  .optional();

export const createTenantSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(63)
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
      'Slug must be lowercase alphanumeric with optional hyphens, cannot start or end with a hyphen'
    ),

  display_name: z.string().trim().min(1).max(255),

  domain: optionalTenantDomain,
});

// Configuration section update schema

/**
 * Accept an arbitrary JSON object as a configuration section payload.
 *
 * Individual section validation is delegated to the settings override
 * service which knows the full schema for each section.
 */
export const updateConfigSectionSchema = z.record(z.string(), z.unknown());

export type CreateTenantInput = z.infer<typeof createTenantSchema>;
export type UpdateConfigSectionInput = z.infer<
  typeof updateConfigSectionSchema
>;
