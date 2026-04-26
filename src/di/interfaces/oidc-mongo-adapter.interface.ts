import type { IBaseOIDCAdapter } from './base-oidc-adapter.interface.js';
import type { Collection, Document } from 'mongodb';
import type {
  OIDCDocument,
  AdapterConnectionOptions,
  OIDCPayload,
  DocumentMappingOptions,
  MappedDocument,
} from '../../oidc/interfaces/interface.js';

export interface IOIDCMongoAdapter extends IBaseOIDCAdapter {
  coll(name?: string): Collection;
  findByUserCode(userCode: string): Promise<OIDCPayload | undefined>;
  findByUid(uid: string): Promise<OIDCPayload | undefined>;
  mapDocumentToUI(
    doc: OIDCDocument | null,
    options?: DocumentMappingOptions
  ): MappedDocument | null;
  extendModel(
    id: string,
    customData: Record<string, unknown>
  ): Promise<Document | null>;
  findByCustomField(field: string, value: unknown): Promise<OIDCDocument[]>;
}

export interface IOIDCMongoAdapterStatic {
  connect(options?: AdapterConnectionOptions): Promise<void>;
}
