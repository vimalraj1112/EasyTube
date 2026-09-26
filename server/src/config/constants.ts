/**
 * Application-wide constants and closed enumerations.
 *
 * Declared as `as const` objects so one declaration provides both the runtime
 * value (Mongoose enums, queue names, BullMQ job names) and the derived union
 * type. Adding a member here is the only way to extend these sets.
 */

export const USER_ROLES = {
  USER: 'USER',
  ADMIN: 'ADMIN',
} as const;
export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

export const USER_STATUSES = {
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
} as const;
export type UserStatus = (typeof USER_STATUSES)[keyof typeof USER_STATUSES];

/** Mirrors the `status` enum on the Download model (spec section 13). */
export const DOWNLOAD_STATUSES = {
  QUEUED: 'QUEUED',
  ANALYZING: 'ANALYZING',
  DOWNLOADING: 'DOWNLOADING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type DownloadStatus = (typeof DOWNLOAD_STATUSES)[keyof typeof DOWNLOAD_STATUSES];

export const TERMINAL_DOWNLOAD_STATUSES = [
  DOWNLOAD_STATUSES.COMPLETED,
  DOWNLOAD_STATUSES.FAILED,
  DOWNLOAD_STATUSES.CANCELLED,
] as const satisfies readonly DownloadStatus[];

export const ACTIVE_DOWNLOAD_STATUSES = [
  DOWNLOAD_STATUSES.QUEUED,
  DOWNLOAD_STATUSES.ANALYZING,
  DOWNLOAD_STATUSES.DOWNLOADING,
  DOWNLOAD_STATUSES.PROCESSING,
] as const satisfies readonly DownloadStatus[];

/** Human labels for the download pipeline, used by the client and by SSE events. */
export const DOWNLOAD_STAGE_LABELS = {
  PREPARING: 'Preparing...',
  ANALYZING: 'Analyzing...',
  DOWNLOADING: 'Downloading...',
  PROCESSING: 'Processing...',
  FINALIZING: 'Finalizing...',
  COMPLETED: 'Completed',
} as const;

export const MEDIA_TYPES = {
  VIDEO: 'video',
  AUDIO: 'audio',
} as const;
export type MediaType = (typeof MEDIA_TYPES)[keyof typeof MEDIA_TYPES];

/**
 * Output containers the processing pipeline can target. A provider may only
 * offer a subset - the UI renders exactly what the provider returns.
 */
export const MEDIA_CONTAINERS = {
  MP4: 'mp4',
  WEBM: 'webm',
  MOV: 'mov',
  MKV: 'mkv',
  MP3: 'mp3',
  M4A: 'm4a',
  OPUS: 'opus',
  WAV: 'wav',
} as const;
export type MediaContainer = (typeof MEDIA_CONTAINERS)[keyof typeof MEDIA_CONTAINERS];

/**
 * Where a media item came from.
 *
 * `DIRECT` is the only entry for now and it means exactly one thing: a URL the
 * user is permitted to download. Phase 5 adds an adapter per provider, and an
 * adapter is only ever added here if it can reach the media through an official
 * API or a plain direct URL. A provider that needs a signature, a token, a
 * cookie or any other protection measure removed is never added.
 */
export const SOURCE_PROVIDERS = {
  DIRECT: 'direct',
} as const;
export type SourceProvider = (typeof SOURCE_PROVIDERS)[keyof typeof SOURCE_PROVIDERS];

/**
 * Why the requester believes they may download this item. Recorded so a future
 * audit can answer "on what basis?" without guessing. The API refuses any
 * request that cannot state one of these.
 */
export const AUTHORIZATION_BASES = {
  OWNED: 'OWNED',
  LICENSED: 'LICENSED',
  PUBLIC_DOMAIN: 'PUBLIC_DOMAIN',
  PERMISSION_GRANTED: 'PERMISSION_GRANTED',
  SELF_PUBLISHED: 'SELF_PUBLISHED',
} as const;
export type AuthorizationBasis = (typeof AUTHORIZATION_BASES)[keyof typeof AUTHORIZATION_BASES];

export const MEDIA_ANALYSIS_STATUSES = {
  PENDING: 'PENDING',
  ANALYZING: 'ANALYZING',
  READY: 'READY',
  FAILED: 'FAILED',
  /** The source is reachable but not something we are permitted to fetch. */
  UNSUPPORTED: 'UNSUPPORTED',
} as const;
export type MediaAnalysisStatus =
  (typeof MEDIA_ANALYSIS_STATUSES)[keyof typeof MEDIA_ANALYSIS_STATUSES];

/** Whether a discovered format carries a video track, an audio track, or both. */
export const MEDIA_FORMAT_KINDS = {
  VIDEO: 'VIDEO',
  AUDIO: 'AUDIO',
  VIDEO_AUDIO: 'VIDEO_AUDIO',
  IMAGE: 'IMAGE',
  UNKNOWN: 'UNKNOWN',
} as const;
export type MediaFormatKind = (typeof MEDIA_FORMAT_KINDS)[keyof typeof MEDIA_FORMAT_KINDS];

/** The artefacts a completed download produces. */
export const DOWNLOAD_OUTPUT_KINDS = {
  VIDEO: 'VIDEO',
  AUDIO: 'AUDIO',
  THUMBNAIL: 'THUMBNAIL',
  SUBTITLE: 'SUBTITLE',
} as const;
export type DownloadOutputKind =
  (typeof DOWNLOAD_OUTPUT_KINDS)[keyof typeof DOWNLOAD_OUTPUT_KINDS];

export const STORAGE_STATUSES = {
  PENDING: 'PENDING',
  STORED: 'STORED',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
} as const;
export type StorageStatus = (typeof STORAGE_STATUSES)[keyof typeof STORAGE_STATUSES];

export const AUDIO_CONTAINERS: readonly MediaContainer[] = [
  MEDIA_CONTAINERS.MP3,
  MEDIA_CONTAINERS.M4A,
  MEDIA_CONTAINERS.OPUS,
  MEDIA_CONTAINERS.WAV,
];

/** Presets offered in quality pickers. Not a guarantee - providers decide. */
export const COMMON_VIDEO_QUALITIES = [
  '2160p',
  '1440p',
  '1080p',
  '720p',
  '480p',
  '360p',
  '240p',
  '144p',
] as const;

export const COMMON_AUDIO_QUALITIES = ['high', 'medium', 'low'] as const;

/** Only http(s) may ever reach a provider - blocks file:, ftp:, data: and friends. */
export const ALLOWED_URL_PROTOCOLS = ['http:', 'https:'] as const;

/** BullMQ queue and job identifiers. */
export const QUEUE_NAMES = {
  DOWNLOAD: 'downloadQueue',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  DOWNLOAD_MEDIA: 'downloadMedia',
  PROCESS_MEDIA: 'processMedia',
  CLEANUP_MEDIA: 'cleanupMedia',
} as const;
export type JobName = (typeof JOB_NAMES)[keyof typeof JOB_NAMES];

/** Who performed an audited action, when the API records one. */
export const AUDIT_ACTOR_TYPES = {
  USER: 'USER',
  SYSTEM: 'SYSTEM',
} as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[keyof typeof AUDIT_ACTOR_TYPES];

/** Append-only audit trail. Additions are fine; renames and removals are not. */
export const AUDIT_ACTIONS = {
  USER_REGISTERED: 'USER_REGISTERED',
  USER_LOGGED_IN: 'USER_LOGGED_IN',
  USER_LOGIN_FAILED: 'USER_LOGIN_FAILED',
  USER_LOGGED_OUT: 'USER_LOGGED_OUT',
  USER_SUSPENDED: 'USER_SUSPENDED',
  TOKEN_REFRESHED: 'TOKEN_REFRESHED',
  TOKEN_REUSE_DETECTED: 'TOKEN_REUSE_DETECTED',
  MEDIA_ANALYZED: 'MEDIA_ANALYZED',
  MEDIA_REJECTED: 'MEDIA_REJECTED',
  DOWNLOAD_CREATED: 'DOWNLOAD_CREATED',
  DOWNLOAD_COMPLETED: 'DOWNLOAD_COMPLETED',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  DOWNLOAD_CANCELLED: 'DOWNLOAD_CANCELLED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  ADMIN_ACTION: 'ADMIN_ACTION',
} as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

/** MongoDB collection names, so a rename cannot silently orphan data. */
export const COLLECTIONS = {
  USERS: 'users',
  REFRESH_SESSIONS: 'refresh_sessions',
  MEDIA_ITEMS: 'media_items',
  MEDIA_FORMATS: 'media_formats',
  DOWNLOADS: 'downloads',
  DOWNLOAD_OUTPUTS: 'download_outputs',
  AUDIT_LOGS: 'audit_logs',
} as const;
export type CollectionName = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

/**
 * Progress checkpoints a worker may report. The spec requires real progress,
 * never a fabricated ramp, so these are the only values emitted by the
 * pipeline itself.
 */
export const PROGRESS_CHECKPOINTS = [0, 10, 25, 50, 75, 90, 100] as const;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/**
 * Cookie names for the browser session.
 *
 * The refresh token lives in an httpOnly cookie rather than in a response body
 * on purpose: a body is readable by any script on the page, and anything
 * readable by script is readable by an XSS payload. The access token is *not*
 * stored in a cookie, because it is meant to be held in memory by the client
 * and sent as a header.
 */
export const AUTH_COOKIES = {
  REFRESH: 'easytube_rt',
  CSRF: 'easytube_csrf',
} as const;
export type AuthCookieName = (typeof AUTH_COOKIES)[keyof typeof AUTH_COOKIES];

/**
 * Why a refresh session was revoked. Recorded so a user asking "why did I get
 * logged out?" gets an answer, and so reuse detection is distinguishable from
 * an ordinary logout in the audit trail.
 */
export const REVOKED_REASONS = {
  LOGOUT: 'logout',
  LOGOUT_ALL: 'logout_all',
  ROTATED: 'rotated',
  /** A rotated token was replayed: treat the whole family as compromised. */
  REUSE_DETECTED: 'reuse_detected',
  PASSWORD_CHANGED: 'password_changed',
  USER_SUSPENDED: 'user_suspended',
  ADMIN_REVOKED: 'admin_revoked',
} as const;
export type RevokedReason = (typeof REVOKED_REASONS)[keyof typeof REVOKED_REASONS];

/** Every JWT carries one of these, so a refresh token can never be used as an access token. */
export const TOKEN_TYPES = {
  ACCESS: 'access',
  REFRESH: 'refresh',
} as const;
export type TokenType = (typeof TOKEN_TYPES)[keyof typeof TOKEN_TYPES];

export const THUMBNAIL_MAX_WIDTH = 1280;
export const THUMBNAIL_MAX_HEIGHT = 720;
