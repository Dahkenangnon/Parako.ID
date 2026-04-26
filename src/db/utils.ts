import type { Document } from 'mongoose';

export function serializeDocument<T extends { _id?: any; id?: string }>(
  doc: T | Document | null
): T | null {
  if (!doc) return null;

  const plainDoc = (doc as Document).toObject
    ? (doc as Document).toObject()
    : { ...doc };

  if (plainDoc._id) {
    plainDoc.id = plainDoc._id.toString();
    plainDoc._id = plainDoc._id.toString();
  }

  delete plainDoc.__v;

  return processObjectIds(plainDoc) as T;
}

function isLikelyObjectId(obj: any): boolean {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    obj.buffer &&
    typeof obj.buffer === 'object' &&
    obj.toString &&
    typeof obj.toString === 'function' &&
    obj.toString() !== '[object Object]'
  );
}

/**
 * Recursively processes an object to convert all MongoDB ObjectIds to strings
 * This implementation prioritizes performance by:
 * 1. Fast-path checks to avoid unnecessary processing
 * 2. Minimizing object creation
 * 3. Eliminating redundant type checks
 *
 * @param obj - Object to process
 * @returns Processed object with all ObjectIds converted to strings
 */
function processObjectIds(obj: any): any {
  if (obj == null) return obj;

  const type = typeof obj;
  if (type !== 'object' || obj instanceof Date) return obj;

  if (Buffer.isBuffer(obj)) return obj;

  if (Array.isArray(obj)) {
    let modified = false;
    const result = obj.map(item => {
      const processed = processObjectIds(item);
      if (processed !== item) modified = true;
      return processed;
    });
    return modified ? result : obj;
  }

  if (isLikelyObjectId(obj)) {
    return obj.toString();
  }

  let modified = false;
  const result: Record<string, any> = {};

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      const processed = processObjectIds(value);
      result[key] = processed;
      if (processed !== value) modified = true;
    }
  }

  return modified ? result : obj;
}

export function serializeDocuments<T extends { _id?: any; id?: string }>(
  docs: (T | Document | null)[]
): T[] {
  if (!Array.isArray(docs)) return [];
  return docs
    .map(doc => serializeDocument(doc))
    .filter((doc): doc is T => doc !== null);
}

export function serializePaginatedResults<
  T extends { _id?: any; id?: string },
>(paginatedData: {
  results: (T | Document | null)[];
  totalPages: number;
  totalResults: number;
  [key: string]: any;
}): {
  results: T[];
  totalPages: number;
  totalResults: number;
  [key: string]: any;
} {
  if (!paginatedData || !paginatedData.results) {
    return {
      results: [],
      totalPages: 0,
      totalResults: 0,
    };
  }

  return {
    ...paginatedData,
    results: serializeDocuments(paginatedData.results),
  };
}

export function safeData(data: any) {
  return serializeDocument(data);
}

export function safeDatas(datas: any[]) {
  return datas.map(data => safeData(data));
}

export function safePageDatas(paginatedResults: any) {
  return serializePaginatedResults(paginatedResults);
}

/**
 * Deeply merges source objects into the target object.
 * Arrays and plain objects are merged recursively.
 * Non-plain objects and primitives are assigned by reference.
 * Does not mutate sources, but mutates target.
 */
function isObject(item: any): item is Record<string, any> {
  return item !== null && typeof item === 'object' && !Array.isArray(item);
}

function isPlainObject(item: any): item is Record<string, any> {
  if (!isObject(item)) return false;
  const proto = Object.getPrototypeOf(item);
  return proto === Object.prototype || proto === null;
}

export function merge(target: any, ...sources: any[]): any {
  if (!isObject(target)) {
    return target;
  }

  for (const source of sources) {
    if (!isObject(source)) continue;

    for (const key of Object.keys(source)) {
      const srcVal = source[key];
      const tgtVal = target[key];

      if (Array.isArray(srcVal)) {
        // Overwrite arrays, do not merge
        target[key] = srcVal.slice();
      } else if (isPlainObject(srcVal)) {
        if (isPlainObject(tgtVal)) {
          target[key] = merge({ ...tgtVal }, srcVal);
        } else {
          target[key] = merge({}, srcVal);
        }
      } else {
        target[key] = srcVal;
      }
    }
  }
  return target;
}
