import type { FilterQuery, Model, Schema, SortOrder } from 'mongoose';

import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../../config/constants';

export interface PaginateOptions {
  page?: number;
  limit?: number;
  sort?: string | Record<string, SortOrder>;
  /** Projection passed straight through to `find`, e.g. `'-passwordHash'`. */
  select?: string;
  /** `lean()` the result. Defaults to true; the API reads, not mutates. */
  lean?: boolean;
  /** Extra conditions merged into the filter, e.g. `{ user }` for ownership. */
  scope?: FilterQuery<unknown>;
}

export interface PaginateResult<TItem> {
  items: TItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

function clampPage(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(1, Math.floor(value));
}

function clampLimit(value: number | undefined): number {
  if (!value || !Number.isFinite(value)) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(value)));
}

function normaliseSort(
  sort: PaginateOptions['sort'],
): string | Record<string, SortOrder> | undefined {
  if (sort === undefined) {
    return undefined;
  }
  if (typeof sort === 'string') {
    return sort.trim() || undefined;
  }
  return Object.keys(sort).length > 0 ? sort : undefined;
}

/**
 * Adds `Model.paginate(filter, options)`.
 *
 * Offset pagination backed by `countDocuments` + `find`, which is the right
 * tool for the history and admin screens: a total count matters there and page
 * sizes are small and bounded. Cursor pagination is deliberately not attempted
 * here - it only pays off past the point where a deep offset and a full count
 * get slow, and migrating later is cheaper than guessing now.
 */
export function paginatePlugin(schema: Schema, _options?: Record<string, unknown>): void {
  const statics = schema.statics as Record<string, unknown>;

  statics.paginate = async function paginate(
    this: Model<unknown>,
    filter: FilterQuery<unknown>,
    options: PaginateOptions = {},
  ): Promise<PaginateResult<unknown>> {
    const page = clampPage(options.page);
    const limit = clampLimit(options.limit);
    const sort = normaliseSort(options.sort) ?? { createdAt: -1 };
    const where = { ...(options.scope ?? {}), ...filter } as FilterQuery<unknown>;

    const [total, rows] = await Promise.all([
      this.countDocuments(where),
      this.find(where, options.select)
        .sort(sort as never)
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(options.lean ?? true)
        .exec(),
    ]);

    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;

    return {
      items: rows as unknown[],
      page,
      limit,
      total,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1 && total > 0,
    };
  };
}

paginatePlugin.pluginName = 'easytubePaginate';
