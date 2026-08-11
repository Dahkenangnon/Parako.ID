ALTER TABLE "user_mfa_email_otp" ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "user_mfa_email_otp" ADD COLUMN "verified_at" TIMESTAMP(3);
