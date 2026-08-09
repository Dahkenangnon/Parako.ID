import { Schema } from 'mongoose';
import { Types } from 'mongoose';

type TransformFunction = (doc: any, ret: any, options: any) => any;

const deleteAtPath = (obj: any, path: string[], index: number): void => {
  if (obj == null || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    obj.forEach(item => deleteAtPath(item, path, index));
    return;
  }

  if (index === path.length - 1) {
    delete obj[path[index]];
    return;
  }

  deleteAtPath(obj[path[index]], path, index + 1);
};

const collectPrivatePaths = (
  schema: Schema<any>,
  prefix: string[] = []
): string[][] => {
  const privatePaths: string[][] = [];

  Object.entries(schema.paths).forEach(([path, schemaPath]) => {
    const fullPath = [...prefix, ...path.split('.')];
    if (schemaPath.options?.private) {
      privatePaths.push(fullPath);
    }

    const nestedSchema = (schemaPath as any).schema as Schema<any> | undefined;
    if (nestedSchema) {
      privatePaths.push(...collectPrivatePaths(nestedSchema, fullPath));
    }
  });

  return privatePaths;
};

const transformObjectId = (value: any): any => {
  if (!value) return value;

  if (value instanceof Types.ObjectId) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map(item => transformObjectId(item));
  }

  const prototype =
    typeof value === 'object' ? Object.getPrototypeOf(value) : undefined;
  if (prototype === Object.prototype || prototype === null) {
    const transformed: any = {};
    Object.keys(value).forEach(key => {
      transformed[key] = transformObjectId(value[key]);
    });
    return transformed;
  }

  return value;
};

const toJSON = (schema: Schema<any>): void => {
  const privatePaths = collectPrivatePaths(schema);
  let transform: TransformFunction | undefined;
  if (
    (schema as any).options.toJSON &&
    (schema as any).options.toJSON.transform
  ) {
    transform = (schema as any).options.toJSON.transform;
  }

  (schema as any).options.toJSON = Object.assign(
    (schema as any).options.toJSON || {},
    {
      transform(doc: any, ret: { [key: string]: any }, options: any) {
        privatePaths.forEach(path => {
          deleteAtPath(ret, path, 0);
        });

        Object.keys(ret).forEach(key => {
          ret[key] = transformObjectId(ret[key]);
        });

        if (ret._id) {
          ret.id = ret._id;
          delete ret._id;
        }

        delete ret.__v;

        if (transform) {
          return transform(doc, ret, options);
        }

        return ret;
      },
    }
  );
};

export default toJSON;
