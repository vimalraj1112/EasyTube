import { Schema, model, models, type Types } from 'mongoose';

import {
  DOWNLOAD_STATUSES,
  MEDIA_CONTAINERS,
  type DownloadStatus,
  type MediaContainer,
} from '../config/constants';
import { applyJsonTransform, baseSchemaOptions } from './base';
import { paginatePlugin } from './plugins/paginate.plugin';
import { softDeletePlugin } from './plugins/soft-delete.plugin';
import type { SoftDeleteDocument, SoftDeleteModel } from './plugins/types';

export interface DownloadError {
  code: string;
  message: string;
  /** Whether the queue is allowed to retry this failure. */
  retryable: boolean;
  at: Date;
}

/**
 * A user's request to download one media item, and its progress through the
 * pipeline.
 *
 * This document is the single source of truth for progress: the API, the SSE
 * stream and the history screen all read this row, so they cannot disagree
 * about how far along a job is.
 */
export interface DownloadDocument extends SoftDeleteDocument {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  mediaItem: Types.ObjectId;
  mediaFormat: Types.ObjectId | null;
  status: DownloadStatus;
  targetContainer: MediaContainer;
  /** 0-100, only ever written from real progress. */
  progressPercent: number;
  bytesDownloaded: number;
  totalBytes: number | null;
  error: DownloadError | null;
  /** Client-supplied key so a retried request cannot create a duplicate job. */
  idempotencyKey: string | null;
  attempts: number;
  queueJobId: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  /** Retention deadline; the TTL index reaps the row afterwards. */
  expiresAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DownloadModel = SoftDeleteModel<DownloadDocument>;

/**
 * The failure detail, as a real subdocument rather than a nested object literal.
 *
 * This matters: with a nested literal, Mongoose applies a `{}` default to the
 * parent and then validates the children, so `required: true` on the children
 * makes *every* download fail validation unless it already carries an error.
 * A subdocument is only instantiated when a value is supplied, so the children
 * are required only once an error exists.
 */
const downloadErrorSchema = new Schema<DownloadError>(
  {
    code: { type: String, required: true, maxlength: 60 },
    message: { type: String, required: true, maxlength: 1_000 },
    retryable: { type: Boolean, required: true, default: false },
    at: { type: Date, required: true },
  },
  { _id: false, strict: 'throw' },
);

const downloadSchema = new Schema<DownloadDocument>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    mediaItem: {
      type: Schema.Types.ObjectId,
      ref: 'MediaItem',
      required: true,
    },
    mediaFormat: {
      type: Schema.Types.ObjectId,
      ref: 'MediaFormat',
      default: null,
    },
    status: {
      type: String,
      enum: Object.values(DOWNLOAD_STATUSES),
      default: DOWNLOAD_STATUSES.QUEUED,
      required: true,
    },
    targetContainer: {
      type: String,
      enum: Object.values(MEDIA_CONTAINERS),
      required: true,
    },
    progressPercent: { type: Number, default: 0, min: 0, max: 100 },
    bytesDownloaded: { type: Number, default: 0, min: 0 },
    totalBytes: { type: Number, default: null, min: 0 },
    error: { type: downloadErrorSchema, default: undefined },
    idempotencyKey: { type: String, default: null, maxlength: 100 },
    attempts: { type: Number, default: 0, min: 0 },
    queueJobId: { type: String, default: null, maxlength: 100 },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
    deletionReason: { type: String, maxlength: 280 },
  },
  baseSchemaOptions<DownloadDocument>({
    timestamps: true,
    collection: 'downloads',
  }),
);

// One job per idempotency key per user: a double-clicked button cannot enqueue
// the same download twice. The partial filter lets rows with no key coexist.
downloadSchema.index(
  { user: 1, idempotencyKey: 1 },
  {
    unique: true,
    name: 'download_user_idempotency_unique',
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);
// The history screen: "my downloads, newest first".
downloadSchema.index({ user: 1, createdAt: -1 }, { name: 'download_user_recent' });
// The admin dashboard: everything in a status, newest first.
downloadSchema.index({ status: 1, createdAt: -1 }, { name: 'download_status_recent' });
// A retried job always knows which row it belongs to.
downloadSchema.index({ mediaItem: 1, status: 1 }, { name: 'download_item_status' });
// Retention sweep.
downloadSchema.index(
  { expiresAt: 1 },
  {
    expireAfterSeconds: 0,
    name: 'download_expiry_ttl',
    partialFilterExpression: { expiresAt: { $type: 'date' } },
  },
);

downloadSchema.plugin(softDeletePlugin).plugin(paginatePlugin);

downloadSchema.pre('validate', function normaliseProgress(next) {
  if (this.isModified('totalBytes') && this.totalBytes !== null && this.totalBytes > 0) {
    // Keep the percentage honest without letting it drift past 100.
    this.progressPercent = Math.min(
      100,
      Math.round((this.bytesDownloaded / this.totalBytes) * 100),
    );
  }

  if (this.isModified('status')) {
    if (this.status === DOWNLOAD_STATUSES.COMPLETED) {
      this.progressPercent = 100;
      this.completedAt = this.completedAt ?? new Date();
    }

    if (this.status === DOWNLOAD_STATUSES.CANCELLED && this.cancelledAt === null) {
      this.cancelledAt = new Date();
    }
  }

  next();
});

applyJsonTransform(downloadSchema);

export const Download =
  (models.Download as DownloadModel | undefined) ??
  model<DownloadDocument, DownloadModel>('Download', downloadSchema, 'downloads');
