/* eslint-disable @typescript-eslint/no-unused-vars -- this file augments mongoose's Model with all 7 generic parameters so our typed plugins merge correctly; the unused-on-paper type params are required by the upstream signature. */
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
