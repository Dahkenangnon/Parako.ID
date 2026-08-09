import { Mongoose, Schema, Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import toJSON from '../../../../src/db/plugins/to-json.plugin.js';

function createModel(
  definition: Record<string, unknown>,
  options: Record<string, unknown> = {}
) {
  const mongoose = new Mongoose();
  const schema = new Schema(definition, options);
  schema.plugin(toJSON);
  return mongoose.model('ToJsonDocument', schema);
}

describe('toJSON plugin', () => {
  it('preserves Date values while serializing a document', () => {
    const Model = createModel({ occurred_at: Date }, { _id: false });
    const occurredAt = new Date('2026-08-02T12:00:00.000Z');

    const serialized = new Model({ occurred_at: occurredAt }).toJSON();

    expect(serialized.occurred_at).toEqual(occurredAt);
  });

  it('normalizes ObjectIds recursively and exposes id without Mongoose metadata', () => {
    const Model = createModel({
      owner_id: Schema.Types.ObjectId,
      nested: Schema.Types.Mixed,
      references: [Schema.Types.Mixed],
    });
    const id = new Types.ObjectId();
    const ownerId = new Types.ObjectId();
    const nestedId = new Types.ObjectId();
    const arrayId = new Types.ObjectId();

    const serialized = new Model({
      _id: id,
      __v: 7,
      owner_id: ownerId,
      nested: { reference: nestedId },
      references: [arrayId, { reference: nestedId }, null],
    }).toJSON();

    expect(serialized).toEqual({
      id: id.toString(),
      owner_id: ownerId.toString(),
      nested: { reference: nestedId.toString() },
      references: [
        arrayId.toString(),
        { reference: nestedId.toString() },
        null,
      ],
    });
  });

  it('removes private fields at top-level and nested schema paths', () => {
    const Model = createModel(
      {
        password_hash: { type: String, private: true },
        profile: {
          display_name: String,
          recovery_code: { type: String, private: true },
        },
        optional: {
          secret: { type: String, private: true },
        },
      },
      { _id: false }
    );

    const serialized = new Model({
      password_hash: 'sensitive',
      profile: {
        display_name: 'Maria',
        recovery_code: 'sensitive',
      },
    }).toJSON();

    expect(serialized).toEqual({ profile: { display_name: 'Maria' } });
  });

  it('removes private fields from every document-array element', () => {
    const Model = createModel(
      {
        security_questions: [
          {
            question_key: String,
            answer_hash: { type: String, private: true },
          },
        ],
      },
      { _id: false }
    );

    const serialized = new Model({
      security_questions: [
        { question_key: 'first_school', answer_hash: 'hash-1' },
        { question_key: 'first_job', answer_hash: 'hash-2' },
      ],
    }).toJSON();

    expect(serialized).toEqual({
      security_questions: [
        { question_key: 'first_school' },
        { question_key: 'first_job' },
      ],
    });
  });

  it('preserves existing toJSON options and invokes its transform last', () => {
    const existingTransform = vi.fn(
      (_document, value: Record<string, unknown>, options) => ({
        subject: value.id,
        display_name: value.display_name,
        option: options.demoOption,
      })
    );
    const mongoose = new Mongoose();
    const schema = new Schema(
      { display_name: String },
      {
        toJSON: {
          virtuals: true,
          transform: existingTransform,
        },
      }
    );
    schema.virtual('greeting').get(() => 'Hello');
    schema.plugin(toJSON);
    const Model = mongoose.model('ExistingTransformDocument', schema);
    const id = new Types.ObjectId();

    const serialized = new Model({ _id: id, display_name: 'Maria' }).toJSON({
      demoOption: 'preserved',
    } as any);

    expect(schema.options.toJSON?.virtuals).toBe(true);
    expect(existingTransform).toHaveBeenCalledOnce();
    expect(existingTransform.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        id: id.toString(),
        display_name: 'Maria',
        greeting: 'Hello',
      })
    );
    expect(serialized).toEqual({
      subject: id.toString(),
      display_name: 'Maria',
      option: 'preserved',
    });
  });
});
