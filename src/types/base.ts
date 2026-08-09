export interface IBaseModel {
  id?: string;
  _id?: string;
  /** Tenant scope injected by the Mongoose tenant plugin when applicable. */
  tenant_id?: string;
  created_at?: string;
  updated_at?: string;
}
