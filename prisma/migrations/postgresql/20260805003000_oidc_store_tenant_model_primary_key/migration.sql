-- OIDC identifiers are scoped by tenant and model. Enforce that same
-- isolation contract in PostgreSQL instead of treating id as globally unique.
ALTER TABLE "oidc_store" DROP CONSTRAINT "oidc_store_pkey";
ALTER TABLE "oidc_store"
ADD CONSTRAINT "oidc_store_pkey" PRIMARY KEY ("tenant_id", "model", "id");
