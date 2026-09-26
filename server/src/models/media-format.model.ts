import { Schema, model, models, type Types } from 'mongoose';

import {
  MEDIA_CONTAINERS,
  MEDIA_FORMAT_KINDS,
  type MediaContainer,
  type MediaFormatKind,
} from '../config/constants';
import { applyJsonTransform, baseSchemaOptions } from './base';
import type { PaginatedModel } from './plugins/types';

/**
 * One downloadable variant discovered while analysing a MediaItem, e.g.
 * "1080p mp4, h264+aac, 4.2 MB/s" or "128kbps m4a".
 *
 * `url` is `select: false` on purpose. Direct media URLs are short-lived and
 * frequently carry a signature; keeping them out of ordinary query results and
 * out of every API payload means a leaked listing cannot be replayed. The
 * download worker opts in explicitly and re-resolves a fresh URL through the
 * provider (Phase 5) rather than trusting a stored one.
 */
export interface MediaFormatDocument {
  _id: Types.ObjectId;
  mediaItem: Types.ObjectId;
  kind: MediaFormatKind;
  qualityLabel: string;
  container: MediaContainer;
  mimeType: string | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  bitrateKbps: number | null;
  sizeBytes: number | null;
  approximate: boolean;
  url: string | null;
  urlHost: string | null;
  urlExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MediaFormatModel = PaginatedModel<MediaFormatDocument>;

const mediaFormatSchema = new Schema<MediaFormatDocument>(
  {
    mediaItem: {
      type: Schema.Types.ObjectId,
      ref: 'MediaItem',
      required: true,
    },
    kind: {
      type: String,
      enum: Object.values(MEDIA_FORMAT_KINDS),
      default: MEDIA_FORMAT_KINDS.UNKNOWN,
      required: true,
    },
    qualityLabel: { type: String, required: true, trim: true, maxlength: 20 },
    container: {
      type: String,
      enum: Object.values(MEDIA_CONTAINERS),
      required: true,
    },
    mimeType: { type: String, default: null, maxlength: 120 },
    width: { type: Number, default: null, min: 0 },
    height: { type: Number, default: null, min: 0 },
    frameRate: { type: Number, default: null, min: 0 },
    videoCodec: { type: String, default: null, maxlength: 40 },
    audioCodec: { type: String, default: null, maxlength: 40 },
    bitrateKbps: { type: Number, default: null, min: 0 },
    sizeBytes: { type: Number, default: null, min: 0 },
    /** True when size is an estimate rather than a known content length. */
    approximate: { type: Boolean, default: true },
    url: { type: String, default: null, select: false, maxlength: 2048 },
    urlHost: { type: String, default: null, lowercase: true, maxlength: 253 },
    urlExpiresAt: { type: Date, default: null },
  },
  baseSchemaOptions<MediaFormatDocument>({
    timestamps: true,
    collection: 'media_formats',
  }),
);

// "Show me every variant for this item", the analysis read pattern.
mediaFormatSchema.index({ mediaItem: 1, height: -1 }, { name: 'format_by_item' });
// The quality picker filters to real video and real audio.
mediaFormatSchema.index(
  { kind: 1, bitrateKbps: -1 },
  { name: 'format_kind_bitrate' },
);
// Stale signed URLs are never worth serving.
mediaFormatSchema.index(
  { urlExpiresAt: 1 },
  {
    expireAfterSeconds: 0,
    name: 'format_expiry_ttl',
    partialFilterExpression: { url: { $type: 'string' } },
  },
);

applyJsonTransform(mediaFormatSchema);

export const MediaFormat =
  (models.MediaFormat as MediaFormatModel | undefined) ??
  model<MediaFormatDocument, MediaFormatModel>(
    'MediaFormat',
    mediaFormatSchema,
    'media_formats',
  );
