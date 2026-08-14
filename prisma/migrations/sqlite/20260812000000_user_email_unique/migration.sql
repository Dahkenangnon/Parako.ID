-- Email identifies one account in SQLite's supported single-tenant mode.
-- PostgreSQL and MongoDB already enforce the equivalent tenant-scoped rule.
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
