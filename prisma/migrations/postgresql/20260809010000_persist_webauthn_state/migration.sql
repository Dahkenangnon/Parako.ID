ALTER TABLE "user_mfa" ADD COLUMN "webauthn_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user_mfa" ADD COLUMN "webauthn_verified_at" TIMESTAMP(3);

ALTER TABLE "user_webauthn_credentials" ADD COLUMN "friendly_name" TEXT NOT NULL DEFAULT 'Passkey';
ALTER TABLE "user_webauthn_credentials" ADD COLUMN "last_used_at" TIMESTAMP(3);

UPDATE "user_webauthn_credentials"
SET "friendly_name" = "credential_id"
WHERE "friendly_name" = 'Passkey';

UPDATE "user_mfa"
SET
  "webauthn_enabled" = true,
  "webauthn_verified_at" = credentials."verified_at"
FROM (
  SELECT "user_id", MIN("created_at") AS "verified_at"
  FROM "user_webauthn_credentials"
  GROUP BY "user_id"
) AS credentials
WHERE "user_mfa"."user_id" = credentials."user_id";
