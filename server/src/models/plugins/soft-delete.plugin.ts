import type { HydratedDocument, Schema } from 'mongoose';

import type { SoftDeleteFields, SoftDeleteMethods } from './types';

export interface SoftDeleteOptions {
  /** Truncation length for the reason, so an audit note cannot bloat a row. */
  reasonMaxLength?: number;
}

type SoftDeleted<TDoc extends SoftDeleteFields> = HydratedDocument<TDoc> & SoftDeleteMethods;

/**
 * Adds soft deletion via a `deletedAt` timestamp.
 *
 * Deliberately *not* implemented as a global pre-hook that rewrites every query.
 * Such a hook is invisible, breaks aggregations and count estimates, and makes
 * "why did my query return nothing" very hard to answer. The model instead
 * exposes explicit scopes and the caller picks one:
 *
 *   User.alive({ email })          // deletedAt: null
 *   User.withDeleted({ email })   // unfiltered
 *
 * Reads therefore state their intent, and no query silently loses rows.
 */
export function softDeletePlugin(schema: Schema, options: SoftDeleteOptions = {}): void {
  const reasonMaxLength = options.reasonMaxLength ?? 280;

  schema.index({ deletedAt: 1 });

  const statics = schema.statics as Record<string, unknown>;

  statics.alive = (filter: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...filter,
    deletedAt: null,
  });

  statics.withDeleted = (filter: Record<string, unknown> = {}): Record<string, unknown> => ({
    ...filter,
  });

  const methods = schema.methods as Record<string, unknown>;

  methods.softDelete = async function softDelete(
    this: SoftDeleted<SoftDeleteFields>,
    reason?: string,
  ): Promise<boolean> {
    if (this.deletedAt) {
      return false;
    }

    this.deletedAt = new Date();
    if (reason) {
      this.deletionReason = reason.slice(0, reasonMaxLength);
    }

    await this.save();
    return true;
  };

  methods.isSoftDeleted = function isSoftDeleted(this: SoftDeleted<SoftDeleteFields>): boolean {
    return Boolean(this.deletedAt);
  };

  methods.restore = async function restore(this: SoftDeleted<SoftDeleteFields>): Promise<boolean> {
    if (!this.deletedAt) {
      return false;
    }

    this.deletedAt = null;
    this.deletionReason = undefined;
    await this.save();
    return true;
  };
}

softDeletePlugin.pluginName = 'easytubeSoftDelete';
