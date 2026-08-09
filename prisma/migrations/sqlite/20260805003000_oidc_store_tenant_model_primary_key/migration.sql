-- OIDC identifiers are scoped by tenant and model. Rebuild the SQLite table
-- so the database enforces the same isolation contract as the adapter.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_oidc_store" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "grant_id" TEXT,
    "user_code" TEXT,
    "uid" TEXT,
    "account_id" TEXT,
    "client_id" TEXT,
    "consumed" DATETIME,
    "expires_at" DATETIME,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("tenant_id", "model", "id")
);

INSERT INTO "new_oidc_store" (
    "id",
    "model",
    "payload",
    "grant_id",
    "user_code",
    "uid",
    "account_id",
    "client_id",
    "consumed",
    "expires_at",
    "tenant_id",
    "created_at"
)
SELECT
    "id",
    "model",
    "payload",
    "grant_id",
    "user_code",
    "uid",
    "account_id",
    "client_id",
    "consumed",
    "expires_at",
    "tenant_id",
    "created_at"
FROM "oidc_store";

DROP TABLE "oidc_store";
ALTER TABLE "new_oidc_store" RENAME TO "oidc_store";

CREATE INDEX "oidc_store_model_id_idx" ON "oidc_store"("model", "id");
CREATE INDEX "oidc_store_grant_id_idx" ON "oidc_store"("grant_id");
CREATE INDEX "oidc_store_user_code_idx" ON "oidc_store"("user_code");
CREATE INDEX "oidc_store_uid_idx" ON "oidc_store"("uid");
CREATE INDEX "oidc_store_model_account_id_idx" ON "oidc_store"("model", "account_id");
CREATE INDEX "oidc_store_model_client_id_idx" ON "oidc_store"("model", "client_id");
CREATE INDEX "oidc_store_expires_at_idx" ON "oidc_store"("expires_at");
CREATE INDEX "oidc_store_tenant_id_idx" ON "oidc_store"("tenant_id");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
