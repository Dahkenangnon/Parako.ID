export interface QueryOptions {
  sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
  limit?: number;
  skip?: number;
}

export interface PaginationOptions {
  page?: number;
  limit?: number;
  sort?: Record<string, 1 | -1 | 'asc' | 'desc'>;
}

export interface PaginatedResult<T> {
  results: T[];
  totalResults: number;
  page: number;
  limit: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface IBaseRepository<T, TCreate, TUpdate = Partial<TCreate>> {
  findById(id: string): Promise<T | null>;
  findOne(filter: Record<string, unknown>): Promise<T | null>;
  findMany(filter: Record<string, unknown>, opts?: QueryOptions): Promise<T[]>;
  create(data: TCreate): Promise<T>;
  update(id: string, data: TUpdate): Promise<T>;
  delete(id: string): Promise<void>;
  count(filter?: Record<string, unknown>): Promise<number>;
}
