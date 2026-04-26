/* eslint-disable @typescript-eslint/no-unused-vars */
import type {
  PaginateOptions,
  PaginateResult,
} from '../db/plugins/paginate.plugin.js';

declare module 'mongoose' {
  // Match all 7 type params from mongoose v9's Model to avoid declaration merge conflicts
  interface Model<
    TRawDocType,
    TQueryHelpers,
    TInstanceMethods,
    TVirtuals,
    THydratedDocumentType,
    TSchema,
    TLeanResultType,
  > {
    /**
     * Paginate documents in the collection
     * @param filter Filter criteria
     * @param options Pagination options
     */
    paginate: <DocType = TRawDocType>(
      filter?: QueryFilter<DocType>,
      options?: PaginateOptions
    ) => Promise<PaginateResult<DocType>>;
  }
}
