import type {
  AuditAction,
  AuditActorType,
  AuthorizationBasis,
  DownloadOutputKind,
  DownloadStatus,
  MediaAnalysisStatus,
  MediaContainer,
  MediaFormatKind,
  SourceProvider,
  StorageStatus,
  UserRole,
  UserStatus,
} from '../config/constants';

/**
 * The shapes the API is allowed to send to a client.
 *
 * These are hand-written rather than inferred from the Mongoose documents on
 * purpose. A DTO has to be an explicit, reviewed list of fields, so adding a
 * column to a collection can never silently start leaking it - and a secret like
 * `passwordHash` is absent by construction rather than by remembering to strip
 * it. Every id is a string, because a client should never see an ObjectId.
 */

export interface ApiUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  role: UserRole;
  status: UserStatus;
  locale: string;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApiMediaAuthorization {
  basis: AuthorizationBasis;
  note: string | null;
}

export interface ApiMediaItem {
  id: string;
  provider: SourceProvider;
  providerMediaId: string | null;
  sourceUrl: string;
  sourceHost: string;
  title: string;
  description: string | null;
  author: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  isLive: boolean;
  status: MediaAnalysisStatus;
  analyzedAt: string | null;
  authorization: ApiMediaAuthorization;
  failureReason: string | null;
  formats?: ApiMediaFormat[];
  createdAt: string;
  updatedAt: string;
}

/** Note the absence of `url`: signed media URLs are never part of a listing. */
export interface ApiMediaFormat {
  id: string;
  mediaItemId: string;
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
  urlHost: string | null;
  createdAt: string;
}

export interface ApiDownloadError {
  code: string;
  message: string;
  retryable: boolean;
  at: string;
}

export interface ApiDownload {
  id: string;
  userId: string;
  mediaItemId: string;
  mediaFormatId: string | null;
  status: DownloadStatus;
  targetContainer: MediaContainer;
  progressPercent: number;
  bytesDownloaded: number;
  totalBytes: number | null;
  error: ApiDownloadError | null;
  attempts: number;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  expiresAt: string | null;
  outputs?: ApiDownloadOutput[];
  createdAt: string;
  updatedAt: string;
}

export interface ApiDownloadOutput {
  id: string;
  downloadId: string;
  kind: DownloadOutputKind;
  container: MediaContainer | null;
  mimeType: string | null;
  sizeBytes: number;
  checksumSha256: string | null;
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  status: StorageStatus;
  /** Minted on demand from a short-lived signed URL; never stored. */
  downloadUrl: string | null;
  createdAt: string;
}

export interface ApiAuditLog {
  id: string;
  action: AuditAction;
  actorType: AuditActorType;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ApiPaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ApiPaginated<TItem> {
  items: TItem[];
  meta: ApiPaginationMeta;
}
