ALTER TABLE "user_mfa" ADD COLUMN "webauthn_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user_mfa" ADD COLUMN "webauthn_verified_at" DATETIME;

ALTER TABLE "user_webauthn_credentials" ADD COLUMN "friendly_name" TEXT NOT NULL DEFAULT 'Passkey';
ALTER TABLE "user_webauthn_credentials" ADD COLUMN "last_used_at" DATETIME;

UPDATE "user_webauthn_credentials"
SET "friendly_name" = "credential_id"
WHERE "friendly_name" = 'Passkey';

UPDATE "user_mfa"
SET
  "webauthn_enabled" = true,
  "webauthn_verified_at" = (
    SELECT MIN("created_at")
    FROM "user_webauthn_credentials"
    WHERE "user_webauthn_credentials"."user_id" = "user_mfa"."user_id"
  )
WHERE EXISTS (
  SELECT 1
  FROM "user_webauthn_credentials"
  WHERE "user_webauthn_credentials"."user_id" = "user_mfa"."user_id"
);
