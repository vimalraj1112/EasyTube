import { Schema, model, models, type Types } from 'mongoose';

import {
  AUTHORIZATION_BASES,
  MEDIA_ANALYSIS_STATUSES,
  SOURCE_PROVIDERS,
  type AuthorizationBasis,
  type MediaAnalysisStatus,
  type SourceProvider,
} from '../config/constants';
import { applyJsonTransform, baseSchemaOptions, trimUrl } from './base';
import { paginatePlugin } from './plugins/paginate.plugin';
import { softDeletePlugin } from './plugins/soft-delete.plugin';
import type { SoftDeleteDocument, SoftDeleteModel } from './plugins/types';

/**
 * A piece of media the user asked us to look at, plus the result of that
 * analysis.
 *
 * The `authorization` subdocument is the point of the whole model: an item is
 * only ever stored with a recorded reason the requester may download it. If
 * `basis` cannot be supplied, the request is refused before a document is
 * written - see `MEDIA_REJECTED` in the audit log.
 */
export interface MediaItemDocument extends SoftDeleteDocument {
  _id: Types.ObjectId;
  provider: SourceProvider;
  /** The provider's own id for this item, when it has one. */
  providerMediaId: string | null;
  /** Canonical, de-duplicated source URL. */
  sourceUrl: string;
  sourceHost: string;
  title: string;
  description: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  isLive: boolean;
  publishedAt: Date | null;
  status: MediaAnalysisStatus;
  analyzedAt: Date | null;
  authorization: {
    basis: AuthorizationBasis;
    note: string | null;
    confirmedByUser: boolean;
  };
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type MediaItemModel = SoftDeleteModel<MediaItemDocument>;

const mediaItemSchema = new Schema<MediaItemDocument>(
  {
    provider: {
      type: String,
      enum: Object.values(SOURCE_PROVIDERS),
      default: SOURCE_PROVIDERS.DIRECT,
      required: true,
    },
    providerMediaId: { type: String, default: null, maxlength: 200 },
    sourceUrl: {
      type: String,
      required: [true, 'sourceUrl is required'],
      trim: true,
      maxlength: 2048,
      set: trimUrl,
    },
    sourceHost: {
      type: String,
      required: true,
      lowercase: true,
      maxlength: 253,
    },
    title: {
      type: String,
      required: [true, 'title is required'],
      trim: true,
      maxlength: 300,
    },
    description: { type: String, default: null, maxlength: 5_000 },
    author: { type: String, default: null, trim: true, maxlength: 200 },
    thumbnailUrl: { type: String, default: null, maxlength: 2048 },
    durationSeconds: { type: Number, default: null, min: 0 },
    isLive: { type: Boolean, default: false },
    publishedAt: { type: Date, default: null },
    status: {
      type: String,
      enum: Object.values(MEDIA_ANALYSIS_STATUSES),
      default: MEDIA_ANALYSIS_STATUSES.PENDING,
    },
    analyzedAt: { type: Date, default: null },
    authorization: {
      basis: {
        type: String,
        enum: Object.values(AUTHORIZATION_BASES),
        required: [true, 'authorization.basis is required'],
      },
      note: { type: String, default: null, maxlength: 500 },
      confirmedByUser: { type: Boolean, default: false },
      _id: false,
    },
    failureReason: { type: String, default: null, maxlength: 500 },
    deletedAt: { type: Date, default: null },
    deletionReason: { type: String, maxlength: 280 },
  },
  baseSchemaOptions<MediaItemDocument>({
    timestamps: true,
    collection: 'media_items',
  }),
);

// The same URL re-analysed should reuse the existing item, not duplicate it.
mediaItemSchema.index(
  { sourceUrl: 1 },
  {
    unique: true,
    name: 'media_source_url_unique',
    partialFilterExpression: { deletedAt: null },
  },
);
// History and the admin media list, newest first.
mediaItemSchema.index({ createdAt: -1 }, { name: 'media_recent' });
mediaItemSchema.index({ status: 1, createdAt: -1 }, { name: 'media_status_recent' });
mediaItemSchema.index(
  { title: 'text', author: 'text' },
  { name: 'media_text_search', weights: { title: 10, author: 5 } },
);

mediaItemSchema.plugin(softDeletePlugin).plugin(paginatePlugin);

applyJsonTransform(mediaItemSchema);

export const MediaItem =
  (models.MediaItem as MediaItemModel | undefined) ??
  model<MediaItemDocument, MediaItemModel>('MediaItem', mediaItemSchema, 'media_items');
