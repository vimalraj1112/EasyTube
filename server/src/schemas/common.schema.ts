import { z, type ZodTypeAny } from 'zod';

import { ALLOWED_URL_PROTOCOLS, DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '../config/constants';
import { isSafeSourceHost } from './url-safety';

/**
 * A MongoDB ObjectId as it appears in an API payload: 24 hex characters.
 *
 * Validated rather than trusted so a bad id produces a clean `400` instead of
 * a `CastError` surfacing as a `500` from deep inside a query.
 */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, 'must be a 24 character hex ObjectId');

export const objectIdParamsSchema = z.object({ id: objectIdSchema });

/**
 * A URL a user is asking to download.
 *
 * Two independent checks, because either alone is insufficient:
 *
 * 1. Protocol. Only `http:` and `https:` are accepted, which blocks `file:`,
 *    `ftp:` and `data:` and so stops a caller pointing the downloader at the
 *    server's own filesystem.
 * 2. Host. `http://127.0.0.1:8080/` and `http://169.254.169.254/` are valid
 *    `http:` URLs aimed at the private network this process lives in, so private
 *    addresses and internal names are rejected here too. See `url-safety.ts` for
 *    what this does and does not cover, notably DNS rebinding.
 *
 * Embedded credentials are rejected as well: `https://example.com@evil.test/`
 * is a well-known way to make a URL look like it points somewhere it does not.
 */
export const sourceUrlSchema = z
  .string()
  .trim()
  .min(1, 'sourceUrl is required')
  .max(2048)
  .url('must be a valid URL')
  .refine((value) => {
    try {
      const { protocol, username, password, hostname } = new URL(value);
      return (
        (ALLOWED_URL_PROTOCOLS as readonly string[]).includes(protocol) &&
        username === '' &&
        password === '' &&
        isSafeSourceHost(hostname)
      );
    } catch {
      return false;
    }
  }, 'must be an http(s) URL with no credentials and a publicly routable host')
  .transform((value) => value.replace(/\/+$/, ''));

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Sort fields are allowlisted; an arbitrary string would reach Mongo as-is. */
export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

export const paginatedResponseSchema = <TItem extends ZodTypeAny>(
  item: TItem,
): z.ZodObject<z.ZodRawShape> =>
  z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    limit: z.number().int().min(1),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0),
    hasNextPage: z.boolean(),
    hasPreviousPage: z.boolean(),
  });

/** Bounds free-text history search. */
export const searchQuerySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  // Reject `$`-prefixed keys so a search term can never be read as a Mongo operator.
  .refine((value) => !value.startsWith('$'), 'must not start with "$"');
