import { Schema } from 'mongoose';
import { Types } from 'mongoose';

type TransformFunction = (doc: any, ret: any, options: any) => any;

const deleteAtPath = (obj: any, path: string[], index: number): void => {
  if (index === path.length - 1) {
    delete obj[path[index]];
    return;
  }
  if (obj[path[index]]) {
    deleteAtPath(obj[path[index]], path, index + 1);
  }
};

const transformObjectId = (value: any): any => {
  if (!value) return value;

  if (value instanceof Types.ObjectId) {
    return value.toString();
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    const transformed: any = {};
    Object.keys(value).forEach(key => {
      transformed[key] = transformObjectId(value[key]);
    });
    return transformed;
  }

  if (Array.isArray(value)) {
    return value.map(item => transformObjectId(item));
  }

  return value;
};

const toJSON = (schema: Schema<any>): void => {
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
        Object.keys(schema.paths).forEach(path => {
          const schemaPath = schema.paths[path];
          if (schemaPath.options && schemaPath.options.private) {
            deleteAtPath(ret, path.split('.'), 0);
          }
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
