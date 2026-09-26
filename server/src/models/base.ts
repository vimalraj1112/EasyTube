import type { Schema, SchemaOptions } from 'mongoose';

/**
 * Options shared by every EasyTube schema.
 *
 * `versionKey: false` because a user-visible `__v` is noise, and optimistic
 * concurrency is expressed explicitly with the `tokenVersion` field on User.
 * `minimize: true` keeps `{}` out of documents so optional objects do not
 * bloat every row.
 *
 * `strict: 'throw'` is stricter than Mongoose's default: a typo in a field name
 * raises instead of being silently dropped, which is what turns a quietly
 * missing value into a loud bug during development.
 *
 * The document type is explicit at every call site because Mongoose's
 * `SchemaOptions` is generic in it.
 */
export function baseSchemaOptions<TDoc>(overrides: SchemaOptions = {}): SchemaOptions<TDoc> {
  return {
    versionKey: false,
    minimize: true,
    strict: 'throw',
    ...overrides,
  } as SchemaOptions<TDoc>;
}

export interface JsonTransformOptions {
  /** Paths stripped from the payload entirely (secrets, internal columns). */
  remove?: readonly string[];
  /** Public rename applied after `remove`, e.g. `{ userId: 'user' }`. */
  rename?: Readonly<Record<string, string>>;
  /**
   * Keep `_id` alongside the `id` virtual. Useful for logs and tests, off by
   * default so API payloads stay idiomatic JSON.
   */
  keepObjectId?: boolean;
}

/**
 * Normalises what a document looks like when it leaves the database.
 *
 * The API contract is camelCase with a string `id`, so a client never has to
 * know about Mongo internals. This is also the last line of defence for secret
 * fields: anything listed in `remove` is gone before serialisation, and the
 * models additionally mark those paths `select: false` so they are not even
 * loaded unless a caller asks for them explicitly.
 */
export function applyJsonTransform(schema: Schema, options: JsonTransformOptions = {}): Schema {
  const { remove = [], rename = {}, keepObjectId = false } = options;
  const dropped = new Set<string>([...(keepObjectId ? [] : ['_id']), '__v', ...remove]);

  const toPlain = (_doc: unknown, ret: Record<string, unknown>): Record<string, unknown> => {
    for (const key of Object.keys(ret)) {
      if (dropped.has(key)) {
        delete ret[key];
        continue;
      }

      const alias = rename[key];
      if (alias) {
        ret[alias] = ret[key];
        delete ret[key];
      }
    }

    return ret;
  };

  const transform = {
    transform: toPlain,
    virtuals: true,
    versionKey: false,
  };

  schema.set('toJSON', transform);
  schema.set('toObject', transform);

  return schema;
}

/** Strips trailing slashes and stray whitespace from a stored URL. */
export function trimUrl(value: string): string {
  return value.trim().replace(/\/+$/, '');
}
