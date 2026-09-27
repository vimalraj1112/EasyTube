/** Mirrors the server envelope so responses are typed end to end. */
export interface ApiMeta {
  requestId: string;
}

export interface ApiSuccess<TData = undefined> extends ApiMeta {
  success: true;
  message: string;
  data: TData;
}

export interface ApiErrorDetail {
  code: string;
  details?: unknown;
}

export interface ApiFailure extends ApiMeta {
  success: false;
  message: string;
  error: ApiErrorDetail;
}

export type ApiResponse<TData = undefined> = ApiSuccess<TData> | ApiFailure;

export interface HealthData {
  status: 'ok';
  service: string;
  version: string;
  environment: string;
  uptimeSeconds: number;
  timestamp: string;
}

/** Mirrors `USER_ROLES` / `USER_STATUSES` on the server. */
export type UserRole = 'USER' | 'ADMIN';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';

/**
 * The user shape the API is allowed to return. `passwordHash` is never part of
 * it, and the server's `UserProfile` type enforces that on its side too.
 *
 * Dates arrive as ISO strings: the server serialises its `Date` objects, so the
 * client formats them rather than pretending they are already `Date`s.
 */
export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  role: UserRole;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
}

/** One active refresh session, safe to render: carries no token material. */
export interface AuthSession {
  id: string;
  /** True for the session this request arrived on. */
  current: boolean;
  /** `primary` for the sign-in token, `rotated` for its descendants. */
  kind: 'primary' | 'rotated';
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
}

/**
 * Returned by every endpoint that establishes a session (register, login,
 * refresh, change-password).
 *
 * There is no `refreshToken` field and there must never be one: the server
 * delivers that token as an httpOnly cookie only.
 */
export interface AuthSessionPayload {
  user: AuthUser;
  accessToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  /** Double-submit CSRF value, mirrored from a readable cookie. */
  csrfToken: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
  locale?: string;
}

export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}
