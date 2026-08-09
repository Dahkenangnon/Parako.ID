-- Preserve the newest promoted active signing key for each tenant/algorithm.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "tenant_id", "alg"
      ORDER BY "created_at" DESC, "id" DESC
    ) AS "position"
  FROM "jwks_keys"
  WHERE "status" = 'active' AND "promoted" = true
)
UPDATE "jwks_keys"
SET "promoted" = false
WHERE "id" IN (SELECT "id" FROM ranked WHERE "position" > 1);

CREATE UNIQUE INDEX "jwks_keys_one_promoted_active_per_algorithm"
ON "jwks_keys"("tenant_id", "alg")
WHERE "status" = 'active' AND "promoted" = true;
