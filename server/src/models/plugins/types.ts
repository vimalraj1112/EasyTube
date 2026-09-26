import type { FilterQuery, Model } from 'mongoose';

import type { PaginateOptions, PaginateResult } from './paginate.plugin';

/**
 * Static side added by `paginatePlugin`.
 *
 * Declared as an interface intersection with `Model<TDoc>` rather than reached
 * for with a cast at every call site, so `User.paginate(...)` is type-checked
 * and autocomplete still works.
 */
export type PaginatedModel<TDoc> = Model<TDoc> & {
  paginate<TLean = unknown>(
    filter?: FilterQuery<TDoc>,
    options?: PaginateOptions,
  ): Promise<PaginateResult<TLean>>;
};

/** Statics added by `softDeletePlugin`. */
export interface SoftDeleteStatics {
  alive(filter?: Record<string, unknown>): Record<string, unknown>;
  withDeleted(filter?: Record<string, unknown>): Record<string, unknown>;
}

/** Instance methods added by `softDeletePlugin`. */
export interface SoftDeleteMethods {
  softDelete(reason?: string): Promise<boolean>;
  isSoftDeleted(): boolean;
  restore(): Promise<boolean>;
}

/** The document shape soft deletion adds, for a model that opts in. */
export interface SoftDeleteFields {
  deletedAt: Date | null;
  deletionReason?: string;
}

/**
 * Everything a soft-deletable document has, so a model interface only has to
 * extend this one type to get both the stored fields and the instance methods.
 *
 * `UserDocument extends SoftDeleteDocument` is safe: Mongoose builds paths from
 * the schema definition, never from the TypeScript interface, so declaring
 * methods here adds no phantom field to the collection.
 */
export type SoftDeleteDocument = SoftDeleteFields & SoftDeleteMethods;

/** A model with both plugins applied. */
export type SoftDeleteModel<TDoc> = PaginatedModel<TDoc> & SoftDeleteStatics;
