import { z } from 'zod';

import { DOWNLOAD_STATUSES, MEDIA_CONTAINERS } from '../config/constants';
import { objectIdSchema, paginationQuerySchema, sortOrderSchema } from './common.schema';

const containerSchema = z.enum([
  MEDIA_CONTAINERS.MP4,
  MEDIA_CONTAINERS.WEBM,
  MEDIA_CONTAINERS.MOV,
  MEDIA_CONTAINERS.MKV,
  MEDIA_CONTAINERS.MP3,
  MEDIA_CONTAINERS.M4A,
  MEDIA_CONTAINERS.OPUS,
  MEDIA_CONTAINERS.WAV,
]);

export const createDownloadSchema = z
  .object({
    mediaItemId: objectIdSchema,
    mediaFormatId: objectIdSchema.optional(),
    container: containerSchema,
    /**
     * Optional client-supplied de-duplication key. The database also enforces
     * uniqueness per user, so a retried request cannot create two jobs.
     */
    idempotencyKey: z.string().trim().min(8).max(100).optional(),
  })
  .refine((value) => Boolean(value.mediaFormatId) || Boolean(value.idempotencyKey), {
    message: 'provide a mediaFormatId or an idempotencyKey',
    path: ['mediaFormatId'],
  });

export const listDownloadsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(Object.values(DOWNLOAD_STATUSES) as [string, ...string[]]).optional(),
  sortOrder: sortOrderSchema,
  search: z.string().trim().min(1).max(200).optional(),
});

export const downloadIdParamsSchema = z.object({ id: objectIdSchema });

export const cancelDownloadSchema = z.object({
  reason: z.string().trim().max(280).optional(),
});

export type CreateDownloadInput = z.infer<typeof createDownloadSchema>;
export type ListDownloadsQuery = z.infer<typeof listDownloadsQuerySchema>;
export type CancelDownloadInput = z.infer<typeof cancelDownloadSchema>;
