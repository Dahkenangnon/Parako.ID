ALTER TABLE "users" ADD COLUMN "phone_verification_token" TEXT;
ALTER TABLE "users" ADD COLUMN "phone_verification_code" TEXT;
ALTER TABLE "users" ADD COLUMN "phone_verification_expires" TIMESTAMP(3);
