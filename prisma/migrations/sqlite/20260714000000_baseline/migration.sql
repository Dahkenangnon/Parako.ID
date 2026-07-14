-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT,
    "username" TEXT,
    "custom_identifier_1" TEXT,
    "custom_identifier_2" TEXT,
    "custom_identifier_3" TEXT,
    "sub" TEXT,
    "given_name" TEXT,
    "family_name" TEXT,
    "name" TEXT,
    "nickname" TEXT,
    "middle_name" TEXT,
    "gender" TEXT DEFAULT 'M',
    "birthdate" DATETIME,
    "phone_number" TEXT,
    "profile" TEXT,
    "website" TEXT,
    "picture" TEXT,
    "locale" TEXT DEFAULT 'fr',
    "country" TEXT DEFAULT 'bj',
    "zoneinfo" TEXT DEFAULT 'Africa/Porto-Novo',
    "city" TEXT,
    "address" TEXT,
    "street_address" TEXT,
    "region" TEXT,
    "postal_code" TEXT,
    "roles" TEXT NOT NULL DEFAULT '["user"]',
    "phone_number_verified" BOOLEAN NOT NULL DEFAULT false,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "theme" TEXT,
    "sidebar_expanded" BOOLEAN NOT NULL DEFAULT false,
    "last_login" DATETIME,
    "password" TEXT,
    "password_hash_algo" TEXT,
    "password_updated_at" DATETIME,
    "password_force_reset" BOOLEAN NOT NULL DEFAULT false,
    "reset_password_token" TEXT,
    "reset_password_expires" DATETIME,
    "email_verification_token" TEXT,
    "email_verification_expires" DATETIME,
    "blocked_from" TEXT NOT NULL DEFAULT '[]',
    "account_is_anonymized" BOOLEAN NOT NULL DEFAULT false,
    "register_with" TEXT NOT NULL DEFAULT 'email',
    "auth_provider" TEXT,
    "account_enabled" BOOLEAN NOT NULL DEFAULT true,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "user_mfa" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "preferred_method" TEXT,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    CONSTRAINT "user_mfa_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_mfa_totp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "secret" TEXT,
    "verified_at" DATETIME,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    CONSTRAINT "user_mfa_totp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_mfa_email_otp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "otp_hash" TEXT,
    "expires_at" DATETIME,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    CONSTRAINT "user_mfa_email_otp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_webauthn_credentials" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "device_type" TEXT,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "transports" TEXT NOT NULL DEFAULT '[]',
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_recovery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "methods" TEXT NOT NULL DEFAULT '[]',
    "secondary_email" TEXT,
    "secondary_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "secondary_email_token" TEXT,
    "secondary_email_token_exp" DATETIME,
    "sms_phone_number" TEXT,
    "sms_verified" BOOLEAN NOT NULL DEFAULT false,
    "sms_code" TEXT,
    "sms_code_exp" DATETIME,
    "backup_codes_generated_at" DATETIME,
    "backup_codes_expires_at" DATETIME,
    "sq_setup_at" DATETIME,
    "sq_last_used_at" DATETIME,
    "sq_failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "sq_last_failed_at" DATETIME,
    "sq_locked_until" DATETIME,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    CONSTRAINT "user_recovery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_backup_codes" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "recovery_id" TEXT,
    "code_hash" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_backup_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_backup_codes_recovery_id_fkey" FOREIGN KEY ("recovery_id") REFERENCES "user_recovery" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_security_questions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "recovery_id" TEXT,
    "question_key" TEXT NOT NULL,
    "answer_hash" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    CONSTRAINT "user_security_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "user_security_questions_recovery_id_fkey" FOREIGN KEY ("recovery_id") REFERENCES "user_recovery" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "user_notification_prefs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "preferred_channel" TEXT NOT NULL DEFAULT 'auto',
    "security_alerts" BOOLEAN NOT NULL DEFAULT true,
    "new_session_alerts" BOOLEAN NOT NULL DEFAULT true,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    CONSTRAINT "user_notification_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'info',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "client_id" TEXT,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "related_activity_id" TEXT,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "activity_actors" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activity_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL DEFAULT 'anonymous',
    "user_id" TEXT,
    "username" TEXT,
    "email" TEXT,
    "full_name" TEXT,
    "given_name" TEXT,
    "family_name" TEXT,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    CONSTRAINT "activity_actors_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "activity_targets" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activity_id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL DEFAULT 'none',
    "user_id" TEXT,
    "username" TEXT,
    "email" TEXT,
    "full_name" TEXT,
    "entity_id" TEXT,
    "entity_name" TEXT,
    "entity_data" TEXT,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    CONSTRAINT "activity_targets_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "activity_devices" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activity_id" TEXT NOT NULL,
    "fingerprint" TEXT,
    "fingerprint_js_id" TEXT,
    "browser_name" TEXT,
    "browser_version" TEXT,
    "os_name" TEXT,
    "os_version" TEXT,
    "device_type" TEXT,
    "device_vendor" TEXT,
    "device_model" TEXT,
    "language" TEXT,
    "platform" TEXT,
    "screen_width" INTEGER,
    "screen_height" INTEGER,
    "screen_pixel_ratio" REAL,
    "hardware_concurrency" INTEGER,
    "memory" REAL,
    "is_new_device" BOOLEAN,
    "is_suspicious" BOOLEAN,
    "confidence_score" REAL,
    "risk_level" TEXT,
    "matched_device_id" TEXT,
    "reason" TEXT,
    "geo_country" TEXT,
    "geo_region" TEXT,
    "geo_city" TEXT,
    "geo_lat" REAL,
    "geo_lon" REAL,
    "geo_timezone" TEXT,
    "device_trust_trusted" BOOLEAN,
    "device_trust_trusted_at" DATETIME,
    "device_trust_until" DATETIME,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    CONSTRAINT "activity_devices_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "schema_version" TEXT NOT NULL DEFAULT '1.0.0',
    "int_version" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "value" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "tenant_settings_overrides" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "key" TEXT NOT NULL DEFAULT 'parako_config',
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "int_version" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "value" TEXT NOT NULL DEFAULT '{}',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "social_integrations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "provider_sub" TEXT NOT NULL,
    "provider_username" TEXT,
    "provider_data" TEXT NOT NULL,
    "tokens" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used" DATETIME,
    "metadata" TEXT,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "jwks_keys" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kid" TEXT NOT NULL,
    "alg" TEXT NOT NULL,
    "use" TEXT NOT NULL DEFAULT 'sig',
    "status" TEXT NOT NULL DEFAULT 'active',
    "promoted" BOOLEAN NOT NULL DEFAULT true,
    "encrypted_private_key" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" DATETIME
);

-- CreateTable
CREATE TABLE "oidc_store" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "sessions" (
    "sid" TEXT NOT NULL PRIMARY KEY,
    "data" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default'
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "domain" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "issuer_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_custom_identifier_1_key" ON "users"("custom_identifier_1");

-- CreateIndex
CREATE UNIQUE INDEX "users_custom_identifier_2_key" ON "users"("custom_identifier_2");

-- CreateIndex
CREATE UNIQUE INDEX "users_custom_identifier_3_key" ON "users"("custom_identifier_3");

-- CreateIndex
CREATE UNIQUE INDEX "users_sub_key" ON "users"("sub");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_mfa_user_id_key" ON "user_mfa"("user_id");

-- CreateIndex
CREATE INDEX "user_mfa_tenant_id_idx" ON "user_mfa"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_mfa_totp_user_id_key" ON "user_mfa_totp"("user_id");

-- CreateIndex
CREATE INDEX "user_mfa_totp_tenant_id_idx" ON "user_mfa_totp"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_mfa_email_otp_user_id_key" ON "user_mfa_email_otp"("user_id");

-- CreateIndex
CREATE INDEX "user_mfa_email_otp_tenant_id_idx" ON "user_mfa_email_otp"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_webauthn_credentials_credential_id_key" ON "user_webauthn_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "user_webauthn_credentials_tenant_id_idx" ON "user_webauthn_credentials"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_recovery_user_id_key" ON "user_recovery"("user_id");

-- CreateIndex
CREATE INDEX "user_recovery_tenant_id_idx" ON "user_recovery"("tenant_id");

-- CreateIndex
CREATE INDEX "user_backup_codes_tenant_id_idx" ON "user_backup_codes"("tenant_id");

-- CreateIndex
CREATE INDEX "user_security_questions_tenant_id_idx" ON "user_security_questions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_notification_prefs_user_id_key" ON "user_notification_prefs"("user_id");

-- CreateIndex
CREATE INDEX "user_notification_prefs_tenant_id_idx" ON "user_notification_prefs"("tenant_id");

-- CreateIndex
CREATE INDEX "activities_type_idx" ON "activities"("type");

-- CreateIndex
CREATE INDEX "activities_status_idx" ON "activities"("status");

-- CreateIndex
CREATE INDEX "activities_timestamp_idx" ON "activities"("timestamp");

-- CreateIndex
CREATE INDEX "activities_tenant_id_idx" ON "activities"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_actors_activity_id_key" ON "activity_actors"("activity_id");

-- CreateIndex
CREATE INDEX "activity_actors_tenant_id_idx" ON "activity_actors"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_targets_activity_id_key" ON "activity_targets"("activity_id");

-- CreateIndex
CREATE INDEX "activity_targets_tenant_id_idx" ON "activity_targets"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "activity_devices_activity_id_key" ON "activity_devices"("activity_id");

-- CreateIndex
CREATE INDEX "activity_devices_fingerprint_idx" ON "activity_devices"("fingerprint");

-- CreateIndex
CREATE INDEX "activity_devices_tenant_id_idx" ON "activity_devices"("tenant_id");

-- CreateIndex
CREATE INDEX "settings_key_is_active_idx" ON "settings"("key", "is_active");

-- CreateIndex
CREATE INDEX "tenant_settings_overrides_tenant_id_idx" ON "tenant_settings_overrides"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_settings_overrides_key_is_active_idx" ON "tenant_settings_overrides"("key", "is_active");

-- CreateIndex
CREATE INDEX "social_integrations_user_id_idx" ON "social_integrations"("user_id");

-- CreateIndex
CREATE INDEX "social_integrations_user_id_method_idx" ON "social_integrations"("user_id", "method");

-- CreateIndex
CREATE INDEX "social_integrations_tenant_id_idx" ON "social_integrations"("tenant_id");

-- CreateIndex
CREATE INDEX "jwks_keys_tenant_id_status_idx" ON "jwks_keys"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "jwks_keys_tenant_id_kid_key" ON "jwks_keys"("tenant_id", "kid");

-- CreateIndex
CREATE INDEX "oidc_store_model_id_idx" ON "oidc_store"("model", "id");

-- CreateIndex
CREATE INDEX "oidc_store_grant_id_idx" ON "oidc_store"("grant_id");

-- CreateIndex
CREATE INDEX "oidc_store_user_code_idx" ON "oidc_store"("user_code");

-- CreateIndex
CREATE INDEX "oidc_store_uid_idx" ON "oidc_store"("uid");

-- CreateIndex
CREATE INDEX "oidc_store_model_account_id_idx" ON "oidc_store"("model", "account_id");

-- CreateIndex
CREATE INDEX "oidc_store_model_client_id_idx" ON "oidc_store"("model", "client_id");

-- CreateIndex
CREATE INDEX "oidc_store_expires_at_idx" ON "oidc_store"("expires_at");

-- CreateIndex
CREATE INDEX "oidc_store_tenant_id_idx" ON "oidc_store"("tenant_id");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_idx" ON "sessions"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_domain_key" ON "tenants"("domain");
