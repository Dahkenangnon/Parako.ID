import { Schema, type QueryFilter } from 'mongoose';

export interface PaginateOptions {
  sortBy?: string;
  populate?: string | string[];
  limit?: number;
  page?: number;
  select?: string | Record<string, 1 | 0>;
  lean?: boolean;
  search?: string;
  searchFields?: string[];
  cacheKey?: string;
  cacheExpireSeconds?: number;
  links?: boolean;
}

export interface PaginationLinks {
  first: string | null;
  prev: string | null;
  next: string | null;
  last: string | null;
}

export interface PaginateResult<T> {
  results: T[];
  page: number;
  limit: number;
  totalPages: number;
  totalResults: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  prevPage: number | null;
  nextPage: number | null;
  links?: PaginationLinks;
}

const cache: Record<string, { data: any; expires: number }> = {};

/**
 * A plugin that adds pagination capabilities to mongoose schemas.
 *
 * @param schema - The mongoose schema to add pagination to
 * @param defaultOptions - Default pagination options to apply to all queries
 */
const paginate = (
  schema: Schema<any>,
  defaultOptions: PaginateOptions = {}
): void => {
  /**
   * Paginate documents in a collection
   *
   * @param filter - Filter criteria for the documents
   * @param options - Pagination options
   * @returns Paginated result with metadata
   */
  schema.statics.paginate = async function (
    filter: QueryFilter<any> = {},
    options: PaginateOptions = {}
  ): Promise<PaginateResult<any>> {
    try {
      const mergedOptions = {
        ...defaultOptions,
        ...options,
        limit: options.limit || defaultOptions.limit || 10,
        page: options.page || defaultOptions.page || 1,
      };

      const {
        sortBy,
        populate,
        limit,
        page,
        select,
        lean,
        search,
        searchFields,
        cacheKey,
        cacheExpireSeconds,
        links,
      } = mergedOptions;

      if (cacheKey) {
        const cacheEntry = cache[cacheKey];
        const now = Date.now();
        if (cacheEntry && cacheEntry.expires > now) {
          return cacheEntry.data;
        }
      }

      let sort = '';
      if (sortBy) {
        const sortingCriteria: string[] = [];
        sortBy.split(',').forEach((sortOption: string) => {
          const [key, order] = sortOption.split(':');
          sortingCriteria.push((order === 'desc' ? '-' : '') + key);
        });
        sort = sortingCriteria.join(' ');
      } else {
        sort = 'created_at';
      }

      const limitInt =
        limit && parseInt(String(limit), 10) > 0
          ? parseInt(String(limit), 10)
          : 10;
      const pageInt =
        page && parseInt(String(page), 10) > 0 ? parseInt(String(page), 10) : 1;
      const skip = (pageInt - 1) * limitInt;

      let searchFilter = {};
      if (search) {
        if (searchFields && searchFields.length > 0) {
          searchFilter = {
            $or: searchFields.map(field => ({
              [field]: { $regex: search, $options: 'i' },
            })),
          };
        } else {
          searchFilter = { $text: { $search: search } };
        }
      }

      const combinedFilter = search ? { ...filter, ...searchFilter } : filter;

      const countPromise = this.countDocuments(combinedFilter).exec();

      let docsPromise = this.find(combinedFilter)
        .sort(sort)
        .skip(skip)
        .limit(limitInt);

      if (select) {
        if (typeof select === 'string') {
          docsPromise = docsPromise.select(select.split(',').join(' '));
        } else {
          docsPromise = docsPromise.select(select);
        }
      }

      if (populate) {
        if (typeof populate === 'string') {
          const populateFields = populate.split(',');
          populateFields.forEach(field => {
            docsPromise = docsPromise.populate(field);
          });
        } else if (Array.isArray(populate)) {
          populate.forEach(field => {
            docsPromise = docsPromise.populate(field);
          });
        }
      }

      if (lean) {
        docsPromise = docsPromise.lean() as any;
      }

      const [totalResults, results] = await Promise.all([
        countPromise,
        docsPromise.exec(),
      ]);

      const totalPages = Math.ceil(totalResults / limitInt);
      const hasNextPage = pageInt < totalPages;
      const hasPrevPage = pageInt > 1;
      const prevPage = hasPrevPage ? pageInt - 1 : null;
      const nextPage = hasNextPage ? pageInt + 1 : null;

      const result: PaginateResult<any> = {
        results,
        page: pageInt,
        limit: limitInt,
        totalPages,
        totalResults,
        hasNextPage,
        hasPrevPage,
        prevPage,
        nextPage,
      };

      if (links) {
        result.links = {
          first: pageInt > 1 ? `?page=1&limit=${limitInt}` : null,
          prev: hasPrevPage ? `?page=${prevPage}&limit=${limitInt}` : null,
          next: hasNextPage ? `?page=${nextPage}&limit=${limitInt}` : null,
          last: totalPages > 0 ? `?page=${totalPages}&limit=${limitInt}` : null,
        };
      }

      if (cacheKey) {
        const expireSeconds = cacheExpireSeconds || 60;
        cache[cacheKey] = {
          data: result,
          expires: Date.now() + expireSeconds * 1000,
        };
      }

      return result;
    } catch (error) {
      // console.error here (not the structured logger): mongoose schema
      // plugins are functions invoked by the ORM, not DI-managed classes,
      // so there is no injected logger in scope. The error is re-thrown
      // immediately so the caller surfaces it through its own logger.
      console.error('Pagination error:', error);
      throw error;
    }
  };
};

export default paginate;
