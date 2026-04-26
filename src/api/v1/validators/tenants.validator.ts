/**
 * Zod validation schemas for tenant create and configuration update
 * request bodies.
 *
 * These schemas enforce the shape and constraints of incoming payloads
 * before they reach the controller logic.
 */

import { z } from 'zod';

export const createTenantSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(63)
    .regex(
      /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/,
      'Slug must be lowercase alphanumeric with optional hyphens, cannot start or end with a hyphen'
    ),

  display_name: z.string().min(1).max(255),

  domain: z.string().optional(),
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
