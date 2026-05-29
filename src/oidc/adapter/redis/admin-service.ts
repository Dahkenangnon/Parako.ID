import type Redis from 'ioredis';
import type { ILogger } from '../../../di/interfaces/logger.interface.js';
import { buildRedisKey } from '../../../multi-tenancy/redis-key.js';
import OIDCRedisAdapter from './index.js';
import type {
  OidcClientData,
  ClientFilters,
  ClientStatistics,
  ClientValidationResult,
  RegenerateSecretResult,
} from '../client.interface.js';
import {
  generateClientId,
  generateClientSecret,
  applyClientDefaults,
  validateClientData,
  filterClients,
  clientMatchesSearch,
  computeClientStatistics,
  encryptClientSecret,
  decryptClientSecret,
} from '../client-crud-utils.js';

/**
 * Consolidated Redis OIDC admin service.
 * Replaces the 6 per-model per-file admin classes (session, grant, client,
 * access-token, refresh-token, interaction) with a single class that
 * dispatches on `this.name` where model-specific behaviour is needed.
 *
 * Constructed directly in OIDCAdapterBridge — no @injectable decorator needed.
 */
export class RedisOidcAdminService extends OIDCRedisAdapter {
  constructor(
    model: string,
    client: Redis,
    logger: ILogger,
    keyPrefix: string
  ) {
    super(model, client, logger, keyPrefix);
  }

  // ─── Session methods ────────────────────────────────────────────────────────

  async findByAccountId(accountId: string): Promise<any[]> {
    try {
      if (!accountId) return [];

      const now = Math.floor(Date.now() / 1000);
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      const sessions: any[] = [];

      if (keys.length === 0) return sessions;

      const pipeline = this.client.pipeline();
      if (!pipeline) return sessions;

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return sessions;

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const sessionData = JSON.parse(data as string);
            if (
              sessionData &&
              sessionData.accountId === accountId &&
              sessionData.exp &&
              sessionData.exp > now &&
              sessionData.kind === 'Session'
            ) {
              sessions.push(sessionData);
            }
          }
        } catch (error) {
          this.logger.warn('Failed to process session data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return sessions;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error finding sessions by account ID',
      });
      return [];
    }
  }

  async revokeSession(sessionId: string): Promise<boolean> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);

      if (keys.length === 0) return false;

      const pipeline = this.client.pipeline();
      if (!pipeline) return false;

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return false;

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const sessionData = JSON.parse(data as string);
            if (sessionData && sessionData.jti === sessionId) {
              await this.destroy(
                keys[i].replace(
                  buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
                  ''
                )
              );
              return true;
            }
          }
        } catch (error) {
          this.logger.warn('Failed to process session data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return false;
    } catch (error) {
      this.logger.error(error as Error, { context: 'Error revoking session' });
      return false;
    }
  }

  async revokeAllSessionsExcept(
    accountId: string,
    excludeSessionId: string
  ): Promise<number> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      let revokedCount = 0;

      if (keys.length === 0) return revokedCount;

      const pipeline = this.client.pipeline();
      if (!pipeline) return revokedCount;

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return 0;

      const keysToRevoke: string[] = [];

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const sessionData = JSON.parse(data as string);
            if (
              sessionData &&
              sessionData.accountId === accountId &&
              sessionData.kind === 'Session' &&
              sessionData.jti !== excludeSessionId
            ) {
              keysToRevoke.push(
                keys[i].replace(
                  buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
                  ''
                )
              );
            }
          }
        } catch (error) {
          this.logger.warn('Failed to process session data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (keysToRevoke.length > 0) {
        const deletePipeline = this.client.pipeline();
        if (deletePipeline) {
          keysToRevoke.forEach(id => deletePipeline.del(this.key(id)));
          await deletePipeline.exec();
          revokedCount = keysToRevoke.length;
        }
      }

      return revokedCount;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error revoking all sessions except current',
      });
      return 0;
    }
  }

  async getSessionStatistics(): Promise<{
    total: number;
    active: number;
    expired: number;
  }> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);

      if (keys.length === 0) return { total: 0, active: 0, expired: 0 };

      const pipeline = this.client.pipeline();
      if (!pipeline) return { total: 0, active: 0, expired: 0 };

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return { total: 0, active: 0, expired: 0 };

      let total = 0;
      let active = 0;
      let expired = 0;
      const now = Math.floor(Date.now() / 1000);

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const sessionData = JSON.parse(data as string);
            if (sessionData.kind === 'Session') {
              total++;
              if (sessionData.exp && sessionData.exp > now) {
                active++;
              } else if (sessionData.exp && sessionData.exp <= now) {
                expired++;
              }
            }
          }
        } catch (error) {
          this.logger.warn('Failed to process session data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return { total, active, expired };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error getting session statistics',
      });
      throw error;
    }
  }

  async countSessions(filters: any = {}): Promise<number> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);

      if (Object.keys(filters).length === 0) return keys.length;

      let count = 0;
      const pipeline = this.client.pipeline();
      if (!pipeline) return 0;

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return 0;

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const sessionData = JSON.parse(data as string);
            if (this.matchesFilters(sessionData, filters)) count++;
          }
        } catch (error) {
          this.logger.warn('Failed to process session data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return count;
    } catch (error) {
      this.logger.error(error as Error, { context: 'Error counting sessions' });
      throw error;
    }
  }

  async findSessionsWithPagination(
    filters: any = {},
    sortBy: string = 'createdAt',
    sortOrder: number = -1,
    skip: number = 0,
    limit: number = 20
  ): Promise<any[]> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      const sessions: any[] = [];

      if (keys.length === 0) return sessions;

      const pipeline = this.client.pipeline();
      if (!pipeline) return sessions;

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return sessions;

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const sessionData = JSON.parse(data as string);
            if (
              Object.keys(filters).length === 0 ||
              this.matchesFilters(sessionData, filters)
            ) {
              sessions.push({
                _id: keys[i].replace(
                  buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
                  ''
                ),
                payload: sessionData,
                expiresAt: sessionData.exp
                  ? new Date(sessionData.exp * 1000)
                  : null,
              });
            }
          }
        } catch (error) {
          this.logger.warn('Failed to process session data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      sessions.sort((a, b) => {
        const aValue = this.getSortValue(a, sortBy);
        const bValue = this.getSortValue(b, sortBy);
        return sortOrder === -1 ? bValue - aValue : aValue - bValue;
      });

      return sessions.slice(skip, skip + limit);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error finding sessions with pagination',
      });
      throw error;
    }
  }

  async findSessionById(sessionId: string): Promise<any | null> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);

      if (keys.length === 0) return null;

      const pipeline = this.client.pipeline();
      if (!pipeline) return null;

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return null;

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const sessionData = JSON.parse(data as string);
            if (sessionData.jti === sessionId) {
              return {
                _id: keys[i].replace(
                  buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
                  ''
                ),
                payload: sessionData,
                expiresAt: sessionData.exp
                  ? new Date(sessionData.exp * 1000)
                  : null,
              };
            }
          }
        } catch (error) {
          this.logger.warn('Failed to process session data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return null;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error finding session by ID ${sessionId}`,
      });
      throw error;
    }
  }

  async exportAllSessions(): Promise<any[]> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      const sessions: any[] = [];

      if (keys.length === 0) return sessions;

      const pipeline = this.client.pipeline();
      if (!pipeline) return sessions;

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return sessions;

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const sessionData = JSON.parse(data as string);
            if (sessionData.kind === 'Session') {
              sessions.push({
                _id: keys[i].replace(
                  buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
                  ''
                ),
                payload: sessionData,
                expiresAt: sessionData.exp
                  ? new Date(sessionData.exp * 1000)
                  : null,
              });
            }
          }
        } catch (error) {
          this.logger.warn('Failed to process session data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      sessions.sort((a, b) => (b.payload.iat || 0) - (a.payload.iat || 0));
      return sessions;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error exporting all sessions',
      });
      throw error;
    }
  }

  async deleteSessionsByAccountId(
    accountId: string
  ): Promise<{ deletedCount: number }> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      let deletedCount = 0;

      if (keys.length === 0) return { deletedCount };

      const pipeline = this.client.pipeline();
      if (!pipeline) return { deletedCount };

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return { deletedCount: 0 };

      const keysToDelete: string[] = [];

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const sessionData = JSON.parse(data as string);
            if (sessionData && sessionData.accountId === accountId) {
              keysToDelete.push(keys[i]);
            }
          }
        } catch (error) {
          this.logger.warn('Failed to process session data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (keysToDelete.length > 0) {
        const deletePipeline = this.client.pipeline();
        if (deletePipeline) {
          keysToDelete.forEach(key => deletePipeline.del(key));
          await deletePipeline.exec();
          deletedCount = keysToDelete.length;
        }
      }

      return { deletedCount };
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error deleting sessions for account ${accountId}`,
      });
      throw error;
    }
  }

  async deleteSessionsByIds(
    sessionIds: string[]
  ): Promise<{ deletedCount: number }> {
    try {
      if (sessionIds.length === 0) return { deletedCount: 0 };

      const pipeline = this.client.pipeline();
      if (!pipeline) return { deletedCount: 0 };

      sessionIds.forEach(id => pipeline.del(this.key(id)));
      const results = (await pipeline.exec()) as any;

      let deletedCount = 0;
      results.forEach(([err, result]: any) => {
        if (!err && result === 1) deletedCount++;
      });

      return { deletedCount };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error deleting multiple sessions',
      });
      throw error;
    }
  }

  // ─── Grant methods ──────────────────────────────────────────────────────────

  async findGrantsByAccountId(accountId: string): Promise<any[]> {
    try {
      if (!accountId) {
        this.logger.warn('findGrantsByAccountId called with empty accountId');
        return [];
      }

      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      const results: any[] = [];

      if (keys.length === 0) return results;

      const pipeline = this.client.pipeline();
      if (!pipeline) return results;

      keys.forEach(key => pipeline.get(key));
      const pipelineResults = await pipeline.exec();
      if (!pipelineResults) return results;

      for (let i = 0; i < pipelineResults.length; i++) {
        try {
          const [err, data] = pipelineResults[i];
          if (!err && data) {
            const grantData = JSON.parse(data as string);
            if (grantData && grantData.accountId === accountId) {
              results.push({
                _id: keys[i].replace(
                  buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
                  ''
                ),
                payload: grantData,
                expiresAt: grantData.exp
                  ? new Date(grantData.exp * 1000)
                  : undefined,
              });
            }
          }
        } catch (error) {
          this.logger.warn('Failed to process grant data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return results;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error finding grants for account ${accountId}`,
      });
      throw error;
    }
  }

  async findGrantsByClientId(clientId: string): Promise<any[]> {
    try {
      if (!clientId) {
        this.logger.warn('findGrantsByClientId called with empty clientId');
        return [];
      }

      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      const results: any[] = [];

      if (keys.length === 0) return results;

      const pipeline = this.client.pipeline();
      if (!pipeline) return results;

      keys.forEach(key => pipeline.get(key));
      const pipelineResults = await pipeline.exec();
      if (!pipelineResults) return results;

      for (let i = 0; i < pipelineResults.length; i++) {
        try {
          const [err, data] = pipelineResults[i];
          if (!err && data) {
            const grantData = JSON.parse(data as string);
            if (grantData && grantData.clientId === clientId) {
              results.push({
                _id: keys[i].replace(
                  buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
                  ''
                ),
                payload: grantData,
                expiresAt: grantData.exp
                  ? new Date(grantData.exp * 1000)
                  : undefined,
              });
            }
          }
        } catch (error) {
          this.logger.warn('Failed to process grant data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return results;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error finding grants for client ${clientId}`,
      });
      throw error;
    }
  }

  async findGrantByAccountAndClient(
    accountId: string,
    clientId: string
  ): Promise<any | null> {
    try {
      if (!accountId || !clientId) return null;

      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);

      for (const key of keys) {
        try {
          const grantData = await this.find(
            key.replace(
              buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
              ''
            )
          );
          if (
            grantData &&
            grantData.accountId === accountId &&
            grantData.clientId === clientId
          ) {
            return {
              _id: key.replace(
                buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
                ''
              ),
              payload: grantData,
              expiresAt: grantData.exp
                ? new Date(grantData.exp * 1000)
                : undefined,
            };
          }
        } catch (error) {
          this.logger.warn(`Failed to process grant key ${key}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return null;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error finding grant for account ${accountId} and client ${clientId}`,
      });
      throw error;
    }
  }

  async revokeGrantById(grantId: string): Promise<void> {
    try {
      if (!grantId) return;
      await this.destroy(grantId);
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error revoking grant ${grantId}`,
      });
      throw error;
    }
  }

  async revokeAllGrantsForAccount(accountId: string): Promise<number> {
    try {
      if (!accountId) return 0;

      const grants = await this.findGrantsByAccountId(accountId);
      if (grants.length === 0) return 0;

      let revokedCount = 0;
      for (const grant of grants) {
        try {
          const grantId = grant.payload.jti as string;
          if (!grantId) continue;
          await this.revokeByGrantId(grantId);
          revokedCount++;
        } catch (error) {
          this.logger.error(error as Error, {
            context: `Error revoking grant ${grant.payload.jti}`,
          });
        }
      }

      return revokedCount;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error revoking all grants for account ${accountId}`,
      });
      throw error;
    }
  }

  async revokeAllGrantsForClient(clientId: string): Promise<number> {
    try {
      if (!clientId) return 0;

      const grants = await this.findGrantsByClientId(clientId);
      if (grants.length === 0) return 0;

      let revokedCount = 0;
      for (const grant of grants) {
        try {
          const grantId = grant.payload.jti as string;
          if (!grantId) continue;
          await this.revokeByGrantId(grantId);
          revokedCount++;
        } catch (error) {
          this.logger.error(error as Error, {
            context: `Error revoking grant ${grant.payload.jti}`,
          });
        }
      }

      return revokedCount;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error revoking all grants for client ${clientId}`,
      });
      throw error;
    }
  }

  async revokeGrantByAccountAndClient(
    accountId: string,
    clientId: string
  ): Promise<boolean> {
    try {
      if (!accountId || !clientId) return false;

      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      const grantsToRevoke: any[] = [];

      for (const key of keys) {
        try {
          const grantData = await this.find(
            key.replace(
              buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
              ''
            )
          );
          if (
            grantData &&
            grantData.accountId === accountId &&
            grantData.clientId === clientId
          ) {
            grantsToRevoke.push({
              _id: key.replace(
                buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
                ''
              ),
              payload: grantData,
            });
          }
        } catch (error) {
          this.logger.warn(`Failed to process grant key ${key}`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (grantsToRevoke.length === 0) return false;

      let revokedCount = 0;
      for (const grant of grantsToRevoke) {
        try {
          const grantId = grant.payload.jti as string;
          if (!grantId) continue;
          await this.revokeByGrantId(grantId);
          revokedCount++;
        } catch (error) {
          this.logger.error(error as Error, {
            context: `Error revoking grant ${grant.payload.jti}`,
          });
        }
      }

      return revokedCount > 0;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error revoking grants for account ${accountId} and client ${clientId}`,
      });
      throw error;
    }
  }

  async countGrants(filters: any = {}): Promise<number> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);

      if (Object.keys(filters).length === 0) return keys.length;

      let count = 0;
      const pipeline = this.client.pipeline();
      if (!pipeline) return 0;

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return 0;

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const grantData = JSON.parse(data as string);
            if (this.matchesFilters(grantData, filters)) count++;
          }
        } catch (error) {
          this.logger.warn('Failed to process grant data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return count;
    } catch (error) {
      this.logger.error(error as Error, { context: 'Error counting grants' });
      throw error;
    }
  }

  async findGrantsWithPagination(
    filters: any = {},
    sortBy: string = 'createdAt',
    sortOrder: number = -1,
    skip: number = 0,
    limit: number = 20
  ): Promise<any[]> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      const grants: any[] = [];

      if (keys.length === 0) return grants;

      const pipeline = this.client.pipeline();
      if (!pipeline) return grants;

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return grants;

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const grantData = JSON.parse(data as string);
            if (
              Object.keys(filters).length === 0 ||
              this.matchesFilters(grantData, filters)
            ) {
              grants.push({
                _id: keys[i].replace(
                  buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
                  ''
                ),
                payload: grantData,
                expiresAt: grantData.exp
                  ? new Date(grantData.exp * 1000)
                  : null,
              });
            }
          }
        } catch (error) {
          this.logger.warn('Failed to process grant data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      grants.sort((a, b) => {
        const aValue = this.getSortValue(a, sortBy);
        const bValue = this.getSortValue(b, sortBy);
        return sortOrder === -1 ? bValue - aValue : aValue - bValue;
      });

      return grants.slice(skip, skip + limit);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error finding grants with pagination',
      });
      throw error;
    }
  }

  async findGrantById(id: string): Promise<any | null> {
    try {
      const data = await this.client.get(this.key(id));

      if (!data) return null;

      const grantData = JSON.parse(data as string);
      return {
        _id: id,
        payload: grantData,
        expiresAt: grantData.exp ? new Date(grantData.exp * 1000) : null,
      };
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error finding grant by ID ${id}`,
      });
      throw error;
    }
  }

  async getGrantStatistics(): Promise<{
    total: number;
    recent: number;
    expired: number;
    byClient: Array<{ _id: string; count: number }>;
    byUser: Array<{ _id: string; count: number }>;
  }> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);

      if (keys.length === 0) {
        return { total: 0, recent: 0, expired: 0, byClient: [], byUser: [] };
      }

      const pipeline = this.client.pipeline();
      if (!pipeline) {
        return { total: 0, recent: 0, expired: 0, byClient: [], byUser: [] };
      }

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results)
        return { total: 0, recent: 0, expired: 0, byClient: [], byUser: [] };

      let total = 0;
      let recent = 0;
      let expired = 0;
      const clientCounts = new Map<string, number>();
      const userCounts = new Map<string, number>();

      const now = Math.floor(Date.now() / 1000);
      const thirtyDaysAgo = Math.floor(
        (Date.now() - 30 * 24 * 60 * 60 * 1000) / 1000
      );

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const grantData = JSON.parse(data as string);
            total++;

            if (grantData.iat && grantData.iat >= thirtyDaysAgo) recent++;
            if (grantData.exp && grantData.exp < now) expired++;

            if (grantData.clientId) {
              clientCounts.set(
                grantData.clientId,
                (clientCounts.get(grantData.clientId) || 0) + 1
              );
            }
            if (grantData.accountId) {
              userCounts.set(
                grantData.accountId,
                (userCounts.get(grantData.accountId) || 0) + 1
              );
            }
          }
        } catch (error) {
          this.logger.warn('Failed to process grant data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const byClient = Array.from(clientCounts.entries())
        .map(([_id, count]) => ({ _id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const byUser = Array.from(userCounts.entries())
        .map(([_id, count]) => ({ _id, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return { total, recent, expired, byClient, byUser };
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error getting grant statistics',
      });
      throw error;
    }
  }

  async exportAllGrants(): Promise<any[]> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      const grants: any[] = [];

      if (keys.length === 0) return grants;

      const pipeline = this.client.pipeline();
      if (!pipeline) return grants;

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return grants;

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const grantData = JSON.parse(data as string);
            grants.push({
              _id: keys[i].replace(
                buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
                ''
              ),
              payload: grantData,
              expiresAt: grantData.exp ? new Date(grantData.exp * 1000) : null,
            });
          }
        } catch (error) {
          this.logger.warn('Failed to process grant data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return grants;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error exporting all grants',
      });
      throw error;
    }
  }

  async deleteGrantsByAccountId(
    accountId: string
  ): Promise<{ deletedCount: number }> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      let deletedCount = 0;

      if (keys.length === 0) return { deletedCount };

      const pipeline = this.client.pipeline();
      if (!pipeline) return { deletedCount };

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return { deletedCount };

      const keysToDelete: string[] = [];

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const grantData = JSON.parse(data as string);
            if (grantData && grantData.accountId === accountId) {
              keysToDelete.push(keys[i]);
            }
          }
        } catch (error) {
          this.logger.warn('Failed to process grant data', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (keysToDelete.length > 0) {
        const deletePipeline = this.client.pipeline();
        if (deletePipeline) {
          keysToDelete.forEach(key => deletePipeline.del(key));
          await deletePipeline.exec();
          deletedCount = keysToDelete.length;
        }
      }

      return { deletedCount };
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error deleting grants for account ${accountId}`,
      });
      throw error;
    }
  }

  // ─── Shared: deleteByAccountId (dispatches on model name) ──────────────────

  async deleteByAccountId(
    accountId: string
  ): Promise<{ deletedCount: number }> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      let deletedCount = 0;

      if (keys.length === 0) return { deletedCount };

      const pipeline = this.client.pipeline();
      if (!pipeline) return { deletedCount };

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return { deletedCount };

      const keysToDelete: string[] = [];

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const itemData = JSON.parse(data as string);
            const matchesAccount =
              this.name === 'Interaction'
                ? itemData?.session?.accountId === accountId
                : itemData?.accountId === accountId;

            if (matchesAccount) keysToDelete.push(keys[i]);
          }
        } catch (error) {
          this.logger.warn(`Failed to process ${this.name} data`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      if (keysToDelete.length > 0) {
        const deletePipeline = this.client.pipeline();
        if (deletePipeline) {
          keysToDelete.forEach(key => deletePipeline.del(key));
          await deletePipeline.exec();
          deletedCount = keysToDelete.length;
        }
      }

      return { deletedCount };
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error deleting ${this.name} records for account ${accountId}`,
      });
      throw error;
    }
  }

  // ─── Client CRUD (IAdapterClientService) ────────────────────────────────────

  /**
   * Create a new OIDC client in Redis.
   * Stores as key `{prefix}:{tenantId}:oidc:Client:{client_id}` with JSON payload.
   */
  async createClient(data: Partial<OidcClientData>): Promise<OidcClientData> {
    const validation = validateClientData(data);
    if (!validation.isValid) {
      throw new Error(
        `Client validation failed: ${validation.errors.join(', ')}`
      );
    }

    const clientData = applyClientDefaults(data);

    const encrypted = encryptClientSecret(clientData);
    await this.client.set(
      this.key(clientData.client_id),
      JSON.stringify(encrypted)
    );

    this.logger.info(`Created client ${clientData.client_id}`, {
      context: 'ClientCRUD',
    });
    return clientData;
  }

  async findClientById(clientId: string): Promise<OidcClientData | null> {
    try {
      const data = await this.client.get(this.key(clientId));
      if (!data) return null;
      const parsed = JSON.parse(data);
      const clientData = {
        ...parsed,
        client_id: parsed.client_id || clientId,
      } as OidcClientData;
      return decryptClientSecret(clientData);
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error finding client ${clientId}`,
      });
      return null;
    }
  }

  async findAllClients(filters?: ClientFilters): Promise<OidcClientData[]> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      if (keys.length === 0) return [];

      const pipeline = this.client.pipeline();
      if (!pipeline) return [];

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return [];

      const clients: OidcClientData[] = [];
      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const parsed = JSON.parse(data as string);
            const clientId = keys[i].replace(
              buildRedisKey(this.keyPrefix, 'oidc', this.name, ''),
              ''
            );
            clients.push(
              decryptClientSecret({
                ...parsed,
                client_id: parsed.client_id || clientId,
              } as OidcClientData)
            );
          }
        } catch {
          // best-effort: skip clients whose Redis payload fails to parse
          // — corrupt rows must not block the listing.
        }
      }

      return filterClients(clients, filters);
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error finding all clients',
      });
      return [];
    }
  }

  async updateClient(
    clientId: string,
    updates: Partial<OidcClientData>
  ): Promise<OidcClientData | null> {
    try {
      const existing = await this.findClientById(clientId);
      if (!existing) return null;

      const merged: OidcClientData = {
        ...existing,
        ...updates,
        client_id: clientId,
        updated_at: new Date().toISOString(),
      };

      const encrypted = encryptClientSecret(merged);
      await this.client.set(this.key(clientId), JSON.stringify(encrypted));
      return merged;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error updating client ${clientId}`,
      });
      return null;
    }
  }

  async deleteClient(clientId: string): Promise<boolean> {
    try {
      const result = await this.client.del(this.key(clientId));
      return result > 0;
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error deleting client ${clientId}`,
      });
      return false;
    }
  }

  async searchClients(query: string): Promise<OidcClientData[]> {
    const all = await this.findAllClients();
    return all.filter(c => clientMatchesSearch(c, query));
  }

  async activateClient(clientId: string): Promise<OidcClientData | null> {
    return this.updateClient(clientId, { active: true });
  }

  async deactivateClient(clientId: string): Promise<OidcClientData | null> {
    return this.updateClient(clientId, { active: false });
  }

  async regenerateClientSecret(
    clientId: string
  ): Promise<RegenerateSecretResult | null> {
    const existing = await this.findClientById(clientId);
    if (!existing) return null;

    const newSecret = generateClientSecret();
    const updated = await this.updateClient(clientId, {
      client_secret: newSecret,
    });

    return updated ? { client: updated, newSecret } : null;
  }

  async getClientStatistics(): Promise<ClientStatistics> {
    const clients = await this.findAllClients();
    return computeClientStatistics(clients);
  }

  async countClients(): Promise<number> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      return keys.length;
    } catch (error) {
      this.logger.error(error as Error, {
        context: 'Error counting clients',
      });
      return 0;
    }
  }

  validateClientDataSync(
    data: Partial<OidcClientData>
  ): ClientValidationResult {
    return validateClientData(data);
  }

  generateClientId(): string {
    return generateClientId();
  }

  generateClientSecret(): string {
    return generateClientSecret();
  }

  // ─── Shared: getDistinctValues ──────────────────────────────────────────────

  async getDistinctValues(field: string, filters: any = {}): Promise<any[]> {
    try {
      const pattern = buildRedisKey(this.keyPrefix, 'oidc', this.name, '*');
      const keys = await this.scanKeys(pattern);
      const distinctValues = new Set<any>();

      if (keys.length === 0) return [];

      const pipeline = this.client.pipeline();
      if (!pipeline) return [];

      keys.forEach(key => pipeline.get(key));
      const results = await pipeline.exec();
      if (!results) return [];

      for (let i = 0; i < results.length; i++) {
        try {
          const [err, data] = results[i];
          if (!err && data) {
            const itemData = JSON.parse(data as string);
            if (
              Object.keys(filters).length === 0 ||
              this.matchesFilters(itemData, filters)
            ) {
              const value = this.getNestedValue(itemData, field);
              if (value !== undefined) distinctValues.add(value);
            }
          }
        } catch (error) {
          this.logger.warn(`Failed to process ${this.name} data`, {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      return Array.from(distinctValues);
    } catch (error) {
      this.logger.error(error as Error, {
        context: `Error getting distinct values for field ${field}`,
      });
      throw error;
    }
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private matchesFilters(data: any, filters: any): boolean {
    for (const [key, value] of Object.entries(filters)) {
      if (key === '$or') {
        const orConditions = value as any[];
        const matchesOr = orConditions.some(condition =>
          Object.entries(condition).every(([condKey, condValue]) => {
            const dataValue = this.getNestedValue(data, condKey);
            if (
              typeof condValue === 'object' &&
              condValue !== null &&
              (condValue as any)?.$regex
            ) {
              const regex = new RegExp(
                (condValue as any)?.$regex,
                (condValue as any)?.$options || ''
              );
              return regex.test(String(dataValue));
            }
            return dataValue === condValue;
          })
        );
        if (!matchesOr) return false;
      } else {
        const dataValue = this.getNestedValue(data, key);
        if (typeof value === 'object' && value !== null) {
          if ((value as any)?.$regex) {
            const regex = new RegExp(
              (value as any)?.$regex,
              (value as any)?.$options || ''
            );
            if (!regex.test(String(dataValue))) return false;
          } else if ((value as any)?.$gt !== undefined) {
            if (!(dataValue > (value as any)?.$gt)) return false;
          } else if ((value as any)?.$lt !== undefined) {
            if (!(dataValue < (value as any)?.$lt)) return false;
          } else if ((value as any)?.$lte !== undefined) {
            if (!(dataValue <= (value as any)?.$lte)) return false;
          } else if ((value as any)?.$gte !== undefined) {
            if (!(dataValue >= (value as any)?.$gte)) return false;
          }
        } else {
          if (dataValue !== value) return false;
        }
      }
    }
    return true;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  private getSortValue(item: any, sortBy: string): number {
    switch (sortBy) {
      case 'loginTime':
        return item.payload?.loginTs || item.payload?.iat || 0;
      case 'username':
        return item.payload?.accountId?.charCodeAt(0) || 0;
      case 'expiresAt':
        return item.payload?.exp || 0;
      default:
        return item.payload?.iat || 0;
    }
  }
}
