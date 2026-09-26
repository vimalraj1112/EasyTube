import { z } from 'zod';

import {
  AUTHORIZATION_BASES,
  MEDIA_ANALYSIS_STATUSES,
  SOURCE_PROVIDERS,
} from '../config/constants';
import { objectIdSchema, paginationQuerySchema, sourceUrlSchema } from './common.schema';

/**
 * The authorization basis is a required field, not an optional note.
 *
 * This is the gate that keeps the product honest: a request that cannot state
 * why the media may be downloaded is rejected before any URL is fetched.
 */
export const authorizationSchema = z.object({
  basis: z.enum([
    AUTHORIZATION_BASES.OWNED,
    AUTHORIZATION_BASES.LICENSED,
    AUTHORIZATION_BASES.PUBLIC_DOMAIN,
    AUTHORIZATION_BASES.PERMISSION_GRANTED,
    AUTHORIZATION_BASES.SELF_PUBLISHED,
  ]),
  note: z.string().trim().max(500).optional(),
});

export const analyzeMediaSchema = z.object({
  sourceUrl: sourceUrlSchema,
  authorization: authorizationSchema,
});

export const listMediaQuerySchema = paginationQuerySchema.extend({
  status: z.enum(Object.values(MEDIA_ANALYSIS_STATUSES) as [string, ...string[]]).optional(),
  provider: z.enum(Object.values(SOURCE_PROVIDERS) as [string, ...string[]]).optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

export const mediaIdParamsSchema = z.object({ id: objectIdSchema });

export type AnalyzeMediaInput = z.infer<typeof analyzeMediaSchema>;
export type ListMediaQuery = z.infer<typeof listMediaQuerySchema>;
