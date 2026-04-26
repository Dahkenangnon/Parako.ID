import type {
  OIDCPayload,
  DocumentMappingOptions,
  MappedDocument,
} from '../../oidc/interfaces/interface.js';

export interface IBaseOIDCAdapter {
  getModelName(): string;
  isGrantable(): boolean;
  isConsumable(): boolean;
  upsert(id: string, payload: OIDCPayload, expiresIn?: number): Promise<void>;
  find(id: string): Promise<OIDCPayload | undefined>;
  findByUserCode(userCode: string): Promise<OIDCPayload | undefined>;
  findByUid(uid: string): Promise<OIDCPayload | undefined>;
  consume(id: string): Promise<void>;
  destroy(id: string): Promise<void>;
  revokeByGrantId(grantId: string): Promise<void>;
  countAll(): Promise<number>;
  mapDocumentToUI(
    doc: any | null,
    options?: DocumentMappingOptions
  ): MappedDocument | null;
  extendModel(id: string, customData: Record<string, unknown>): Promise<any>;
  findByCustomField(field: string, value: unknown): Promise<any[]>;
}
