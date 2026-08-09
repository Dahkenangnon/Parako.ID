-- Retain any number of inactive settings revisions while preserving the
-- invariant that each settings key has at most one active revision.
DROP INDEX IF EXISTS "settings_key_is_active_key";

WITH ranked_active AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "key"
      ORDER BY "int_version" DESC, "created_at" DESC, "id" DESC
    ) AS active_rank
  FROM "settings"
  WHERE "is_active" = true
)
UPDATE "settings" AS settings
SET "is_active" = false
FROM ranked_active
WHERE settings."id" = ranked_active."id"
  AND ranked_active.active_rank > 1;

CREATE INDEX "settings_key_is_active_idx"
ON "settings"("key", "is_active");

CREATE UNIQUE INDEX "settings_one_active_per_key"
ON "settings"("key")
WHERE "is_active" = true;
