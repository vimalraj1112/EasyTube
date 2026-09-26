import { Schema, model, models, type Types } from 'mongoose';

import {
  DOWNLOAD_OUTPUT_KINDS,
  MEDIA_CONTAINERS,
  STORAGE_STATUSES,
  type DownloadOutputKind,
  type MediaContainer,
  type StorageStatus,
} from '../config/constants';
import { applyJsonTransform, baseSchemaOptions } from './base';
import type { PaginatedModel } from './plugins/types';

/**
 * A single artefact produced by a completed download.
 *
 * `storageKey` is the object-store key, never a public URL. Download links are
 * minted on demand from a short-lived signed URL (Phase 12) so a leaked
 * database row cannot hand out permanent access to someone's files.
 */
export interface DownloadOutputDocument {
  _id: Types.ObjectId;
  download: Types.ObjectId;
  user: Types.ObjectId;
  kind: DownloadOutputKind;
  container: MediaContainer | null;
  mimeType: string | null;
  storageKey: string | null;
  sizeBytes: number;
  checksumSha256: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  status: StorageStatus;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type DownloadOutputModel = PaginatedModel<DownloadOutputDocument>;

const downloadOutputSchema = new Schema<DownloadOutputDocument>(
  {
    download: {
      type: Schema.Types.ObjectId,
      ref: 'Download',
      required: true,
      index: true,
    },
    /** Denormalised so "list my files" is one indexed query, not a join. */
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    kind: {
      type: String,
      enum: Object.values(DOWNLOAD_OUTPUT_KINDS),
      required: true,
    },
    container: { type: String, enum: Object.values(MEDIA_CONTAINERS), default: null },
    mimeType: { type: String, default: null, maxlength: 120 },
    /**
     * `select: false` for the same reason as `MediaFormat.url`: the raw key is an
     * internal object-store path, and reading it by accident is enough to turn a
     * listing endpoint into a storage enumeration. The worker that writes the
     * file opts in explicitly with `.select('+storageKey')`.
     */
    storageKey: { type: String, default: null, select: false, maxlength: 1_024 },
    sizeBytes: { type: Number, required: true, min: 0, default: 0 },
    checksumSha256: { type: String, default: null, maxlength: 64 },
    durationSeconds: { type: Number, default: null, min: 0 },
    width: { type: Number, default: null, min: 0 },
    height: { type: Number, default: null, min: 0 },
    status: {
      type: String,
      enum: Object.values(STORAGE_STATUSES),
      default: STORAGE_STATUSES.PENDING,
    },
    failureReason: { type: String, default: null, maxlength: 500 },
  },
  baseSchemaOptions<DownloadOutputDocument>({
    timestamps: true,
    collection: 'download_outputs',
  }),
);

// The download detail screen lists its artefacts in one query.
downloadOutputSchema.index({ download: 1, kind: 1 }, { name: 'output_by_download' });
// "My files", newest first, for the storage screen.
downloadOutputSchema.index({ user: 1, createdAt: -1 }, { name: 'output_user_recent' });
// The cleanup sweep looks for outputs that never made it to storage.
downloadOutputSchema.index({ status: 1, createdAt: -1 }, { name: 'output_status_recent' });
// A dedupe check before re-uploading an identical artefact.
downloadOutputSchema.index(
  { checksumSha256: 1 },
  {
    name: 'output_checksum_unique',
    unique: true,
    partialFilterExpression: { checksumSha256: { $type: 'string' } },
  },
);

// The storage key is the raw object-store path. The client receives a
// short-lived signed `downloadUrl` minted on demand instead, so the key is
// stripped here as well as never being placed in a DTO.
applyJsonTransform(downloadOutputSchema, { remove: ['storageKey'] });

export const DownloadOutput =
  (models.DownloadOutput as DownloadOutputModel | undefined) ??
  model<DownloadOutputDocument, DownloadOutputModel>(
    'DownloadOutput',
    downloadOutputSchema,
    'download_outputs',
  );
