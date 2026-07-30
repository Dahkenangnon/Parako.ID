-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
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
    "birthdate" TIMESTAMP(3),
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
    "last_login" TIMESTAMP(3),
    "password" TEXT,
    "password_hash_algo" TEXT,
    "password_updated_at" TIMESTAMP(3),
    "password_force_reset" BOOLEAN NOT NULL DEFAULT false,
    "reset_password_token" TEXT,
    "reset_password_expires" TIMESTAMP(3),
    "email_verification_token" TEXT,
    "email_verification_expires" TIMESTAMP(3),
    "blocked_from" TEXT NOT NULL DEFAULT '[]',
    "account_is_anonymized" BOOLEAN NOT NULL DEFAULT false,
    "register_with" TEXT NOT NULL DEFAULT 'email',
    "auth_provider" TEXT,
    "account_enabled" BOOLEAN NOT NULL DEFAULT true,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mfa" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "preferred_method" TEXT,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "user_mfa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mfa_totp" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "secret" TEXT,
    "verified_at" TIMESTAMP(3),
    "tenant_id" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "user_mfa_totp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mfa_email_otp" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "otp_hash" TEXT,
    "expires_at" TIMESTAMP(3),
    "tenant_id" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "user_mfa_email_otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_webauthn_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "device_type" TEXT,
    "backed_up" BOOLEAN NOT NULL DEFAULT false,
    "transports" TEXT NOT NULL DEFAULT '[]',
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_recovery" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "methods" TEXT NOT NULL DEFAULT '[]',
    "secondary_email" TEXT,
    "secondary_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "secondary_email_token" TEXT,
    "secondary_email_token_exp" TIMESTAMP(3),
    "sms_phone_number" TEXT,
    "sms_verified" BOOLEAN NOT NULL DEFAULT false,
    "sms_code" TEXT,
    "sms_code_exp" TIMESTAMP(3),
    "backup_codes_generated_at" TIMESTAMP(3),
    "backup_codes_expires_at" TIMESTAMP(3),
    "sq_setup_at" TIMESTAMP(3),
    "sq_last_used_at" TIMESTAMP(3),
    "sq_failed_attempts" INTEGER NOT NULL DEFAULT 0,
    "sq_last_failed_at" TIMESTAMP(3),
    "sq_locked_until" TIMESTAMP(3),
    "tenant_id" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "user_recovery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_backup_codes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "recovery_id" TEXT,
    "code_hash" TEXT NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_backup_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_security_questions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "recovery_id" TEXT,
    "question_key" TEXT NOT NULL,
    "answer_hash" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "user_security_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_notification_prefs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "preferred_channel" TEXT NOT NULL DEFAULT 'auto',
    "security_alerts" BOOLEAN NOT NULL DEFAULT true,
    "new_session_alerts" BOOLEAN NOT NULL DEFAULT true,
    "marketing" BOOLEAN NOT NULL DEFAULT false,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "user_notification_prefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'info',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "client_id" TEXT,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "related_activity_id" TEXT,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_actors" (
    "id" TEXT NOT NULL,
    "activity_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL DEFAULT 'anonymous',
    "user_id" TEXT,
    "username" TEXT,
    "email" TEXT,
    "full_name" TEXT,
    "given_name" TEXT,
    "family_name" TEXT,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "activity_actors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_targets" (
    "id" TEXT NOT NULL,
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

    CONSTRAINT "activity_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_devices" (
    "id" TEXT NOT NULL,
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
    "screen_pixel_ratio" DOUBLE PRECISION,
    "hardware_concurrency" INTEGER,
    "memory" DOUBLE PRECISION,
    "is_new_device" BOOLEAN,
    "is_suspicious" BOOLEAN,
    "confidence_score" DOUBLE PRECISION,
    "risk_level" TEXT,
    "matched_device_id" TEXT,
    "reason" TEXT,
    "geo_country" TEXT,
    "geo_region" TEXT,
    "geo_city" TEXT,
    "geo_lat" DOUBLE PRECISION,
    "geo_lon" DOUBLE PRECISION,
    "geo_timezone" TEXT,
    "device_trust_trusted" BOOLEAN,
    "device_trust_trusted_at" TIMESTAMP(3),
    "device_trust_until" TIMESTAMP(3),
    "tenant_id" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "activity_devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "schema_version" TEXT NOT NULL DEFAULT '1.0.0',
    "int_version" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "value" TEXT NOT NULL,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_settings_overrides" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "key" TEXT NOT NULL DEFAULT 'parako_config',
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "int_version" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "value" TEXT NOT NULL DEFAULT '{}',
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_integrations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "provider_sub" TEXT NOT NULL,
    "provider_username" TEXT,
    "provider_data" TEXT NOT NULL,
    "tokens" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_used" TIMESTAMP(3),
    "metadata" TEXT,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jwks_keys" (
    "id" TEXT NOT NULL,
    "kid" TEXT NOT NULL,
    "alg" TEXT NOT NULL,
    "use" TEXT NOT NULL DEFAULT 'sig',
    "status" TEXT NOT NULL DEFAULT 'active',
    "promoted" BOOLEAN NOT NULL DEFAULT true,
    "encrypted_private_key" TEXT NOT NULL,
    "public_key" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotated_at" TIMESTAMP(3),

    CONSTRAINT "jwks_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oidc_store" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "grant_id" TEXT,
    "user_code" TEXT,
    "uid" TEXT,
    "account_id" TEXT,
    "client_id" TEXT,
    "consumed" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "tenant_id" TEXT NOT NULL DEFAULT 'default',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oidc_store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "sid" TEXT NOT NULL,
    "data" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "tenant_id" TEXT NOT NULL DEFAULT 'default',

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("sid")
);

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "domain" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "issuer_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_username_key" ON "users"("tenant_id", "username");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_custom_identifier_1_key" ON "users"("tenant_id", "custom_identifier_1");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_custom_identifier_2_key" ON "users"("tenant_id", "custom_identifier_2");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_custom_identifier_3_key" ON "users"("tenant_id", "custom_identifier_3");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_sub_key" ON "users"("tenant_id", "sub");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");

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
CREATE INDEX "user_webauthn_credentials_tenant_id_idx" ON "user_webauthn_credentials"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_webauthn_credentials_tenant_id_credential_id_key" ON "user_webauthn_credentials"("tenant_id", "credential_id");

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
CREATE UNIQUE INDEX "settings_key_is_active_key" ON "settings"("key", "is_active");

-- CreateIndex
CREATE INDEX "tenant_settings_overrides_tenant_id_idx" ON "tenant_settings_overrides"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_settings_overrides_tenant_id_key_is_active_key" ON "tenant_settings_overrides"("tenant_id", "key", "is_active");

-- CreateIndex
CREATE INDEX "social_integrations_user_id_idx" ON "social_integrations"("user_id");

-- CreateIndex
CREATE INDEX "social_integrations_tenant_id_idx" ON "social_integrations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_integrations_tenant_id_user_id_method_key" ON "social_integrations"("tenant_id", "user_id", "method");

-- CreateIndex
CREATE UNIQUE INDEX "social_integrations_tenant_id_provider_sub_method_key" ON "social_integrations"("tenant_id", "provider_sub", "method");

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

-- AddForeignKey
ALTER TABLE "user_mfa" ADD CONSTRAINT "user_mfa_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mfa_totp" ADD CONSTRAINT "user_mfa_totp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mfa_email_otp" ADD CONSTRAINT "user_mfa_email_otp_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_webauthn_credentials" ADD CONSTRAINT "user_webauthn_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_recovery" ADD CONSTRAINT "user_recovery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_backup_codes" ADD CONSTRAINT "user_backup_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_backup_codes" ADD CONSTRAINT "user_backup_codes_recovery_id_fkey" FOREIGN KEY ("recovery_id") REFERENCES "user_recovery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_security_questions" ADD CONSTRAINT "user_security_questions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_security_questions" ADD CONSTRAINT "user_security_questions_recovery_id_fkey" FOREIGN KEY ("recovery_id") REFERENCES "user_recovery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_notification_prefs" ADD CONSTRAINT "user_notification_prefs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_actors" ADD CONSTRAINT "activity_actors_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_targets" ADD CONSTRAINT "activity_targets_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_devices" ADD CONSTRAINT "activity_devices_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant-scoped tables are protected at the database boundary. The application
-- sets app.tenant_id with SET LOCAL in the same transaction as every scoped
-- operation. Single-tenant deployments safely default to the default tenant.
DO $$
DECLARE
    tenant_table TEXT;
BEGIN
    FOREACH tenant_table IN ARRAY ARRAY[
        'users',
        'user_mfa',
        'user_mfa_totp',
        'user_mfa_email_otp',
        'user_webauthn_credentials',
        'user_recovery',
        'user_backup_codes',
        'user_security_questions',
        'user_notification_prefs',
        'activities',
        'activity_actors',
        'activity_targets',
        'activity_devices',
        'tenant_settings_overrides',
        'social_integrations',
        'jwks_keys',
        'oidc_store',
        'sessions'
    ]
    LOOP
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tenant_table);
        EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tenant_table);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %I USING ("tenant_id" = COALESCE(NULLIF(current_setting(''app.tenant_id'', true), ''''), ''default'')) WITH CHECK ("tenant_id" = COALESCE(NULLIF(current_setting(''app.tenant_id'', true), ''''), ''default''))',
            tenant_table
        );
    END LOOP;
END $$;
