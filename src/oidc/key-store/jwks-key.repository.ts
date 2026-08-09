import type { KeyStatus } from '../../di/interfaces/key-store.interface.js';

export interface JwksKeyRecord {
  kid: string;
  alg: string;
  use: string;
  status: KeyStatus;
  promoted: boolean;
  encrypted_private_key: string;
  public_key: Record<string, unknown> | string;
  tenant_id: string;
  created_at: Date;
  rotated_at?: Date;
}

export interface IJwksKeyRepository {
  countCurrent(tenantId: string): Promise<number>;
  findCurrent(tenantId: string): Promise<JwksKeyRecord[]>;
  findAll(tenantId: string): Promise<JwksKeyRecord[]>;
  findNewestActive(tenantId: string): Promise<JwksKeyRecord | null>;
  insertInitial(keys: JwksKeyRecord[]): Promise<boolean>;
  insertMany(keys: JwksKeyRecord[]): Promise<void>;
  markPromotedActiveExpiring(
    tenantId: string,
    rotatedAt: Date
  ): Promise<number>;
  promoteUnpromotedActive(tenantId: string): Promise<number>;
  retireExpired(tenantId: string, cutoff: Date): Promise<number>;
  retireByKid(tenantId: string, kid: string): Promise<boolean>;
}
