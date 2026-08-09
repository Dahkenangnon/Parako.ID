-- Repair duplicate active tenant overrides before enforcing one active
-- revision per tenant and settings key during concurrent initialisation.
UPDATE "tenant_settings_overrides" AS overrides
SET "is_active" = false
WHERE overrides."is_active" = true
  AND overrides."id" <> (
    SELECT keeper."id"
    FROM "tenant_settings_overrides" AS keeper
    WHERE keeper."tenant_id" = overrides."tenant_id"
      AND keeper."key" = overrides."key"
      AND keeper."is_active" = true
    ORDER BY keeper."int_version" DESC, keeper."created_at" DESC, keeper."id" DESC
    LIMIT 1
  );

CREATE UNIQUE INDEX "tenant_settings_overrides_one_active_per_tenant_key"
ON "tenant_settings_overrides"("tenant_id", "key")
WHERE "is_active" = true;
