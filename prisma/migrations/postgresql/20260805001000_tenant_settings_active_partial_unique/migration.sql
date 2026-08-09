-- Retain tenant override history while preserving one active revision per
-- tenant and settings key. Repair pre-existing duplicate active rows first.
DROP INDEX IF EXISTS "tenant_settings_overrides_tenant_id_key_is_active_key";

WITH ranked_active AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "tenant_id", "key"
      ORDER BY "int_version" DESC, "created_at" DESC, "id" DESC
    ) AS active_rank
  FROM "tenant_settings_overrides"
  WHERE "is_active" = true
)
UPDATE "tenant_settings_overrides" AS overrides
SET "is_active" = false
FROM ranked_active
WHERE overrides."id" = ranked_active."id"
  AND ranked_active.active_rank > 1;

CREATE INDEX "tenant_settings_overrides_tenant_id_key_is_active_idx"
ON "tenant_settings_overrides"("tenant_id", "key", "is_active");

CREATE UNIQUE INDEX "tenant_settings_overrides_one_active_per_tenant_key"
ON "tenant_settings_overrides"("tenant_id", "key")
WHERE "is_active" = true;
