import { randomUUID } from 'node:crypto';

import Database from 'better-sqlite3';
import { Client as PostgresqlClient } from 'pg';

const IDENTITY_EXPIRY_COLUMNS = {
  'email-verification': {
    expires: 'email_verification_expires',
    token: 'email_verification_token',
  },
  'password-reset': {
    expires: 'reset_password_expires',
    token: 'reset_password_token',
  },
  'phone-verification': {
    expires: 'phone_verification_expires',
    token: 'phone_verification_token',
  },
};

const JWKS_ROTATION_DUE_AT = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);

/**
 * Test-control persistence for relational E2E deployments. Each operation
 * opens a short-lived connection so the temporary RP never shares Parako's
 * production database client or bypasses a public request handler.
 */
export class SqliteFixtureStore {
  constructor(databasePath) {
    this.databasePath = databasePath;
  }

  async makeJwksRotationDue() {
    const database = new Database(this.databasePath);
    try {
      return database
        .prepare(
          `UPDATE jwks_keys
              SET created_at = ?
            WHERE tenant_id = 'default' AND status = 'active'`
        )
        .run(JWKS_ROTATION_DUE_AT.toISOString()).changes;
    } finally {
      database.close();
    }
  }

  async insertSocialIntegration(email, method, providerSub) {
    const database = new Database(this.databasePath);
    try {
      const user = database
        .prepare('SELECT id, tenant_id FROM users WHERE email = ?')
        .get(email);
      if (!user) return undefined;

      const id = randomUUID();
      const now = new Date().toISOString();
      database
        .prepare(
          `INSERT INTO social_integrations (
              id, user_id, method, provider_sub, provider_data,
              is_active, tenant_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`
        )
        .run(
          id,
          user.id,
          method,
          providerSub,
          JSON.stringify({ sub: providerSub }),
          user.tenant_id,
          now,
          now
        );
      return id;
    } finally {
      database.close();
    }
  }

  async expireIdentityToken(email, kind) {
    const database = new Database(this.databasePath);
    try {
      const columns = IDENTITY_EXPIRY_COLUMNS[kind];
      if (!columns) return false;
      // The closed kind map above selects both identifiers; no request value
      // is interpolated into this statement.
      const result = database
        .prepare(
          `UPDATE users
              SET ${columns.expires} = ?
            WHERE email = ? AND ${columns.token} IS NOT NULL`
        )
        .run(new Date(Date.now() - 60_000).toISOString(), email);
      return result.changes === 1;
    } finally {
      database.close();
    }
  }

  async setPhoneUnverified(email) {
    const database = new Database(this.databasePath);
    try {
      return (
        database
          .prepare(
            `UPDATE users
                SET phone_number_verified = 0
              WHERE email = ? AND phone_number IS NOT NULL`
          )
          .run(email).changes === 1
      );
    } finally {
      database.close();
    }
  }

  async setEmailUnverified(email) {
    const database = new Database(this.databasePath);
    try {
      return (
        database
          .prepare('UPDATE users SET email_verified = 0 WHERE email = ?')
          .run(email).changes === 1
      );
    } finally {
      database.close();
    }
  }

  async expireMfaEmailCode(email) {
    const database = new Database(this.databasePath);
    try {
      return (
        database
          .prepare(
            `UPDATE user_mfa_email_otp
                SET expires_at = ?
              WHERE user_id = (SELECT id FROM users WHERE email = ?)
                AND otp_hash IS NOT NULL`
          )
          .run(new Date(Date.now() - 60_000).toISOString(), email).changes === 1
      );
    } finally {
      database.close();
    }
  }

  async expireRecoverySmsCode(email) {
    const database = new Database(this.databasePath);
    try {
      return (
        database
          .prepare(
            `UPDATE user_recovery
                SET sms_code_exp = ?
              WHERE user_id = (SELECT id FROM users WHERE email = ?)
                AND sms_code IS NOT NULL`
          )
          .run(new Date(Date.now() - 60_000).toISOString(), email).changes === 1
      );
    } finally {
      database.close();
    }
  }

  async expireSecondaryEmailRecoveryCode(sessionId) {
    const database = new Database(this.databasePath);
    try {
      const row = database
        .prepare('SELECT data FROM sessions WHERE sid = ?')
        .get(sessionId);
      if (!row) return false;

      const session = JSON.parse(row.data);
      const verification = session.secondaryEmailVerification;
      if (!verification?.code) return false;
      verification.expiresAt = new Date(Date.now() - 60_000).toISOString();

      return (
        database
          .prepare('UPDATE sessions SET data = ? WHERE sid = ?')
          .run(JSON.stringify(session), sessionId).changes === 1
      );
    } finally {
      database.close();
    }
  }

  async expireApplicationSession(sessionId) {
    const database = new Database(this.databasePath);
    try {
      return (
        database.prepare('DELETE FROM sessions WHERE sid = ?').run(sessionId)
          .changes === 1
      );
    } finally {
      database.close();
    }
  }

  async setAccountEnabled(email, enabled) {
    const database = new Database(this.databasePath);
    try {
      return (
        database
          .prepare('UPDATE users SET account_enabled = ? WHERE email = ?')
          .run(enabled ? 1 : 0, email).changes === 1
      );
    } finally {
      database.close();
    }
  }

  async setLoginBlocked(email, blocked) {
    const database = new Database(this.databasePath);
    try {
      return (
        database
          .prepare('UPDATE users SET blocked_from = ? WHERE email = ?')
          .run(JSON.stringify(blocked ? ['login'] : []), email).changes === 1
      );
    } finally {
      database.close();
    }
  }

  async setActivityStorageAvailability(available) {
    const database = new Database(this.databasePath);
    try {
      const activityTable = available ? 'activities_unavailable' : 'activities';
      const nextTable = available ? 'activities' : 'activities_unavailable';
      const exists = database
        .prepare(
          `SELECT 1
             FROM sqlite_master
            WHERE type = 'table' AND name = ?`
        )
        .get(activityTable);
      if (!exists) return false;
      database.exec(`ALTER TABLE ${activityTable} RENAME TO ${nextTable}`);
      return true;
    } finally {
      database.close();
    }
  }
}

/** Test-control persistence for a disposable MongoDB E2E database. */
export class MongoFixtureStore {
  constructor(database, tenantId) {
    this.database = database;
    this.tenantId = tenantId;
  }

  userFilter(email) {
    return { email, tenant_id: this.tenantId };
  }

  async makeJwksRotationDue() {
    const result = await this.database
      .collection('jwks_keys')
      .updateMany(
        { tenant_id: this.tenantId, status: 'active' },
        { $set: { created_at: JWKS_ROTATION_DUE_AT } }
      );
    return result.modifiedCount;
  }

  async insertSocialIntegration(email, method, providerSub) {
    const user = await this.database
      .collection('users')
      .findOne(this.userFilter(email), { projection: { _id: 1 } });
    if (!user) return undefined;

    const id = randomUUID();
    const now = new Date();
    await this.database.collection('socialintegrations').insertOne({
      _id: id,
      user_id: String(user._id),
      method,
      provider_sub: providerSub,
      provider_data: { sub: providerSub },
      is_active: true,
      tenant_id: this.tenantId,
      metadata: { created_by: 'system', linked_at: now },
      created_at: now,
      updated_at: now,
    });
    return id;
  }

  async expireIdentityToken(email, kind) {
    const columns = IDENTITY_EXPIRY_COLUMNS[kind];
    if (!columns) return false;
    const result = await this.database.collection('users').updateOne(
      {
        ...this.userFilter(email),
        [columns.token]: { $exists: true, $ne: null },
      },
      { $set: { [columns.expires]: new Date(Date.now() - 60_000) } }
    );
    return result.modifiedCount === 1;
  }

  async setPhoneUnverified(email) {
    const result = await this.database.collection('users').updateOne(
      {
        ...this.userFilter(email),
        phone_number: { $exists: true, $ne: null },
      },
      { $set: { phone_number_verified: false } }
    );
    return result.matchedCount === 1;
  }

  async setEmailUnverified(email) {
    const result = await this.database
      .collection('users')
      .updateOne(this.userFilter(email), {
        $set: { email_verified: false },
      });
    return result.matchedCount === 1;
  }

  async expireMfaEmailCode(email) {
    const result = await this.database.collection('users').updateOne(
      {
        ...this.userFilter(email),
        'mfa.email_otp.hash': { $exists: true, $ne: null },
      },
      { $set: { 'mfa.email_otp.expires': new Date(Date.now() - 60_000) } }
    );
    return result.modifiedCount === 1;
  }

  async expireRecoverySmsCode(email) {
    const result = await this.database.collection('users').updateOne(
      {
        ...this.userFilter(email),
        'recovery.sms.verification_code': { $exists: true, $ne: null },
      },
      {
        $set: {
          'recovery.sms.verification_expires': new Date(Date.now() - 60_000),
        },
      }
    );
    return result.modifiedCount === 1;
  }

  async expireSecondaryEmailRecoveryCode(sessionId) {
    const tenantFilter =
      this.tenantId === 'default'
        ? {
            $or: [
              { 'session.tenantId': 'default' },
              { 'session.tenantId': { $exists: false } },
            ],
          }
        : { 'session.tenantId': this.tenantId };
    const result = await this.database
      .collection('application_session')
      .updateOne(
        {
          _id: sessionId,
          ...tenantFilter,
          'session.secondaryEmailVerification.code': {
            $exists: true,
            $ne: null,
          },
        },
        {
          $set: {
            'session.secondaryEmailVerification.expiresAt': new Date(
              Date.now() - 60_000
            ).toISOString(),
          },
        }
      );
    return result.modifiedCount === 1;
  }

  async expireApplicationSession(sessionId) {
    const tenantFilter =
      this.tenantId === 'default'
        ? {
            $or: [
              { 'session.tenantId': 'default' },
              { 'session.tenantId': { $exists: false } },
            ],
          }
        : { 'session.tenantId': this.tenantId };
    const result = await this.database
      .collection('application_session')
      .deleteOne({ _id: sessionId, ...tenantFilter });
    return result.deletedCount === 1;
  }

  async setAccountEnabled(email, enabled) {
    const result = await this.database
      .collection('users')
      .updateOne(this.userFilter(email), {
        $set: { account_enabled: enabled },
      });
    return result.matchedCount === 1;
  }

  async setLoginBlocked(email, blocked) {
    const result = await this.database
      .collection('users')
      .updateOne(this.userFilter(email), {
        $set: { blocked_from: blocked ? ['login'] : [] },
      });
    return result.matchedCount === 1;
  }

  async setActivityStorageAvailability(available) {
    const collections = await this.database
      .listCollections({}, { nameOnly: true })
      .toArray();
    const names = new Set(collections.map(collection => collection.name));
    if (available) {
      if (!names.has('activities_unavailable')) return false;
      if (names.has('activities')) {
        await this.database.collection('activities').drop();
      }

      const restore = () =>
        this.database.collection('activities_unavailable').rename('activities');
      try {
        await restore();
      } catch (error) {
        // A queued audit write can recreate the collection between drop and
        // rename. Discard that disposable shell and restore the fixture once.
        if (error?.code !== 48) throw error;
        await this.database.collection('activities').drop();
        await restore();
      }
      return true;
    }

    if (!names.has('activities')) return false;
    await this.database
      .collection('activities')
      .rename('activities_unavailable');

    // MongoDB treats a missing collection as an empty collection. A temporary
    // view whose pipeline fails is therefore required to exercise the real
    // repository failure path while preserving all disposable fixture data.
    await this.database.createCollection('activities', {
      viewOn: 'activities_unavailable',
      pipeline: [
        {
          $match: {
            $expr: { $eq: [{ $divide: [1, 0] }, 0] },
          },
        },
      ],
    });
    return true;
  }
}

/** Test-control persistence for a disposable PostgreSQL E2E database. */
export class PostgresqlFixtureStore {
  constructor(databaseUrl, tenantId = 'default') {
    this.databaseUrl = databaseUrl;
    this.tenantId = tenantId;
  }

  async withDatabase(operation) {
    const database = new PostgresqlClient({
      connectionString: this.databaseUrl,
    });
    await database.connect();
    try {
      await database.query('BEGIN');
      await database.query("SELECT set_config('app.tenant_id', $1, true)", [
        this.tenantId,
      ]);
      const result = await operation(database);
      await database.query('COMMIT');
      return result;
    } catch (error) {
      await database.query('ROLLBACK');
      throw error;
    } finally {
      await database.end();
    }
  }

  async makeJwksRotationDue() {
    return this.withDatabase(async database => {
      const result = await database.query(
        `UPDATE jwks_keys
            SET created_at = $1
          WHERE tenant_id = $2 AND status = 'active'`,
        [JWKS_ROTATION_DUE_AT, this.tenantId]
      );
      return result.rowCount ?? 0;
    });
  }

  async insertSocialIntegration(email, method, providerSub) {
    return this.withDatabase(async database => {
      const user = await database.query(
        'SELECT id FROM users WHERE email = $1 AND tenant_id = $2',
        [email, this.tenantId]
      );
      const userId = user.rows[0]?.id;
      if (!userId) return undefined;

      const id = randomUUID();
      await database.query(
        `INSERT INTO social_integrations
           (id, user_id, method, provider_sub, provider_data,
            is_active, tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, true, $6, NOW(), NOW())`,
        [
          id,
          userId,
          method,
          providerSub,
          JSON.stringify({ sub: providerSub }),
          this.tenantId,
        ]
      );
      return id;
    });
  }

  async expireIdentityToken(email, kind) {
    const columns = IDENTITY_EXPIRY_COLUMNS[kind];
    if (!columns) return false;

    return this.withDatabase(async database => {
      // The closed kind map selects both identifiers; request values remain
      // parameterized and cannot alter this statement.
      const result = await database.query(
        `UPDATE users
            SET ${columns.expires} = CURRENT_TIMESTAMP - INTERVAL '1 day'
          WHERE email = $1 AND tenant_id = $2
            AND ${columns.token} IS NOT NULL`,
        [email, this.tenantId]
      );
      return result.rowCount === 1;
    });
  }

  async setPhoneUnverified(email) {
    return this.withDatabase(async database => {
      const result = await database.query(
        `UPDATE users
            SET phone_number_verified = false
          WHERE email = $1 AND tenant_id = $2
            AND phone_number IS NOT NULL`,
        [email, this.tenantId]
      );
      return result.rowCount === 1;
    });
  }

  async setEmailUnverified(email) {
    return this.withDatabase(async database => {
      const result = await database.query(
        `UPDATE users
            SET email_verified = false
          WHERE email = $1 AND tenant_id = $2`,
        [email, this.tenantId]
      );
      return result.rowCount === 1;
    });
  }

  async expireMfaEmailCode(email) {
    return this.withDatabase(async database => {
      const result = await database.query(
        `UPDATE user_mfa_email_otp
            SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 day'
          WHERE user_id = (
                  SELECT id
                    FROM users
                   WHERE email = $1 AND tenant_id = $2
                )
            AND tenant_id = $2
            AND otp_hash IS NOT NULL`,
        [email, this.tenantId]
      );
      return result.rowCount === 1;
    });
  }

  async setAccountEnabled(email, enabled) {
    return this.withDatabase(async database => {
      const result = await database.query(
        `UPDATE users
            SET account_enabled = $3
          WHERE email = $1 AND tenant_id = $2`,
        [email, this.tenantId, enabled]
      );
      return result.rowCount === 1;
    });
  }

  async setLoginBlocked(email, blocked) {
    return this.withDatabase(async database => {
      const result = await database.query(
        `UPDATE users
            SET blocked_from = $3
          WHERE email = $1 AND tenant_id = $2`,
        [email, this.tenantId, JSON.stringify(blocked ? ['login'] : [])]
      );
      return result.rowCount === 1;
    });
  }

  async expireRecoverySmsCode(email) {
    return this.withDatabase(async database => {
      const result = await database.query(
        `UPDATE user_recovery
            SET sms_code_exp = CURRENT_TIMESTAMP - INTERVAL '1 day'
          WHERE user_id = (
                  SELECT id
                    FROM users
                   WHERE email = $1 AND tenant_id = $2
                )
            AND tenant_id = $2
            AND sms_code IS NOT NULL`,
        [email, this.tenantId]
      );
      return result.rowCount === 1;
    });
  }

  async expireSecondaryEmailRecoveryCode(sessionId) {
    return this.withDatabase(async database => {
      const current = await database.query(
        'SELECT data FROM sessions WHERE sid = $1 AND tenant_id = $2',
        [sessionId, this.tenantId]
      );
      const serialized = current.rows[0]?.data;
      if (typeof serialized !== 'string') return false;

      const session = JSON.parse(serialized);
      const verification = session.secondaryEmailVerification;
      if (!verification?.code) return false;
      verification.expiresAt = new Date(Date.now() - 60_000).toISOString();

      const result = await database.query(
        `UPDATE sessions
            SET data = $3
          WHERE sid = $1 AND tenant_id = $2`,
        [sessionId, this.tenantId, JSON.stringify(session)]
      );
      return result.rowCount === 1;
    });
  }

  async expireApplicationSession(sessionId) {
    return this.withDatabase(async database => {
      const result = await database.query(
        'DELETE FROM sessions WHERE sid = $1 AND tenant_id = $2',
        [sessionId, this.tenantId]
      );
      return result.rowCount === 1;
    });
  }

  async setActivityStorageAvailability(available) {
    return this.withDatabase(async database => {
      const current = available ? 'activities_unavailable' : 'activities';
      const next = available ? 'activities' : 'activities_unavailable';
      const exists = await database.query(
        `SELECT 1
           FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = $1`,
        [current]
      );
      if (exists.rowCount !== 1) return false;
      await database.query(`ALTER TABLE ${current} RENAME TO ${next}`);
      return true;
    });
  }
}
