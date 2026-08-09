-- Repair duplicate active rows deterministically before enforcing the
-- single-active settings invariant for concurrent initialisation.
UPDATE "settings" AS settings
SET "is_active" = false
WHERE settings."is_active" = true
  AND settings."id" <> (
    SELECT keeper."id"
    FROM "settings" AS keeper
    WHERE keeper."key" = settings."key"
      AND keeper."is_active" = true
    ORDER BY keeper."int_version" DESC, keeper."created_at" DESC, keeper."id" DESC
    LIMIT 1
  );

CREATE UNIQUE INDEX "settings_one_active_per_key"
ON "settings"("key")
WHERE "is_active" = true;
