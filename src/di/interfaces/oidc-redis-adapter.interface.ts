import type { IBaseOIDCAdapter } from './base-oidc-adapter.interface.js';
import type {
  OIDCPayload,
  AdapterConnectionOptions,
  DocumentMappingOptions,
  MappedDocument,
} from '../../oidc/interfaces/interface.js';

export interface IOIDCRedisAdapter extends IBaseOIDCAdapter {
  findByUserCode(userCode: string): Promise<OIDCPayload | undefined>;
  findByUid(uid: string): Promise<OIDCPayload | undefined>;
  mapDocumentToUI(
    doc: any | null,
    options?: DocumentMappingOptions
  ): MappedDocument | null;
  extendModel(id: string, customData: Record<string, unknown>): Promise<any>;
  findByCustomField(field: string, value: unknown): Promise<any[]>;
  scanKeys(pattern: string): Promise<string[]>;
  countAll(): Promise<number>;
}

export interface IOIDCRedisAdapterStatic {
  connect(options?: AdapterConnectionOptions): Promise<void>;
}
