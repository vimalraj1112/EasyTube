import { createHash } from 'node:crypto';
import { Types, type Types as MongooseTypes } from 'mongoose';

import {
  AUDIT_ACTIONS,
  AUDIT_ACTOR_TYPES,
  REVOKED_REASONS,
  USER_STATUSES,
  type RevokedReason,
  type UserRole,
} from '../config/constants';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';
import {
  equaliseTiming,
  hashPassword,
  needsRehash,
  verifyPassword,
} from '../utils/password';
import {
  issueAccessToken,
  issueRefreshToken,
  ttlToSeconds,
  verifyRefreshToken,
  type IssuedToken,
} from '../utils/token';
import type { LoginInput, RegisterUserInput } from '../schemas/user.schema';

/**
 * Registration, sign-in, and refresh-token rotation.
 *
 * Every collaborator is injected - models, clock, password hasher, token issuer
 * - so the awkward paths (token replay, lockout, concurrent refresh) are
 * testable without a database and nothing reaches for a module-level singleton.
 *
 * Design decisions worth knowing before changing anything here:
 *
 * - A refresh token is single-use. Redeeming one writes a replacement in the
 *   same `family` and marks the old row `rotatedAt`. Presenting an
 *   already-rotated token means a copy exists that should not, so the entire
 *   family is revoked. This is the OAuth 2.0 Security BCP response to replay,
 *   and it bounds the value of a stolen token: it works once, and using it logs
 *   the legitimate owner out too.
 * - The stored digest is a SHA-256 hash, not a password hash. The token is
 *   already high-entropy and signature-verified, so a slow KDF would add latency
 *   to every silent refresh without adding resistance to anything.
 * - Authorisation is re-read from the database on every request, so a
 *   suspension or a role change takes effect immediately rather than waiting for
 *   a token to expire.
 */

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

/**
 * A user row without the credential.
 *
 * This is what almost every read wants: the auth middleware runs on every
 * authenticated request, `GET /me` builds a public profile, and a refresh needs
 * only `tokenVersion`. None of them should drag the password hash out of the
 * database, because a query that does not select it cannot leak it into a log, a
 * serialised error, or a heap snapshot.
 */
export interface UserProfile {
  _id: MongooseTypes.ObjectId;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  role: UserRole;
  status: string;
  failedLoginCount: number;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  tokenVersion: number;
  createdAt: Date;
}

/** A user row *with* the credential, for the two paths that verify a password. */
export interface UserWithCredentials extends UserProfile {
  passwordHash: string;
}

export interface UserPort {
  /**
   * Not soft-deleted rows, and includes the otherwise hidden `passwordHash`.
   *
   * For sign-in, which has to verify a password. Prefer the narrower lookups
   * below wherever the credential is not being checked.
   */
  findByEmail(email: string): Promise<UserWithCredentials | null>;
  /** Identity and status, no credential. Used by the auth middleware. */
  findById(id: string): Promise<UserProfile | null>;
  /**
   * The credential, for verifying a *current* password. Separate from `findById`
   * so that reading a user's identity never implies fetching their secret.
   */
  findCredentialsById(id: string): Promise<UserWithCredentials | null>;
  insert(values: {
    email: string;
    passwordHash: string;
    displayName: string;
    locale: string;
  }): Promise<UserWithCredentials>;
  /** Persists failure bookkeeping, and clears the lock once it is reached. */
  recordFailedLogin(id: string, failedLoginCount: number, lockedUntil: Date | null): Promise<void>;
  /** Also resets `failedLoginCount` and `lockedUntil`. */
  recordSuccessfulLogin(id: string, at: Date): Promise<void>;
  /**
   * `bumpTokenVersion` retires every outstanding refresh token for the user in
   * the same write. Set it on a deliberate credential change; leave it off for
   * a transparent cost upgrade, which must not sign anyone out.
   */
  updatePasswordHash(
    id: string,
    passwordHash: string,
    options?: { bumpTokenVersion?: boolean },
  ): Promise<void>;
}

export interface RefreshSessionRecord {
  _id: MongooseTypes.ObjectId;
  user: MongooseTypes.ObjectId;
  family: MongooseTypes.ObjectId;
  expiresAt: Date;
  revokedAt: Date | null;
  rotatedAt: Date | null;
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
}

export interface RefreshSessionPort {
  /** Loads a session by row id, including the otherwise hidden token hash. */
  findById(id: string): Promise<(RefreshSessionRecord & { tokenHash: string }) | null>;
  /** The caller supplies `_id` so the token can be signed before the write. */
  insert(values: {
    _id: string;
    user: string;
    tokenHash: string;
    family: string;
    expiresAt: Date;
    ip: string | null;
    userAgent: string | null;
  }): Promise<RefreshSessionRecord>;
  /**
   * Claims a session for rotation.
   *
   * Returns false when the row was already rotated or revoked, which is how the
   * redemption is made atomic: the filter makes it a compare-and-set, so of two
   * simultaneous redemptions of one token exactly one sees `true`.
   */
  markRotated(id: string, replacedBy: string, at: Date): Promise<boolean>;
  /** Revokes every unrevoked row in a family. Returns how many were affected. */
  revokeFamily(family: string, reason: RevokedReason, at: Date): Promise<number>;
  /** Revokes every unrevoked session for a user. */
  revokeAllForUser(user: string, reason: RevokedReason, at: Date): Promise<number>;
  revokeById(id: string, reason: RevokedReason, at: Date): Promise<void>;
  listForUser(user: string): Promise<RefreshSessionRecord[]>;
}

export interface AuditPort {
  write(entry: {
    action: string;
    actorType: string;
    actor: string | null;
    target: string | null;
    ip: string | null;
    userAgent: string | null;
    requestId: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

export interface PasswordHasherPort {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<{ valid: boolean; needsRehash: boolean }>;
  needsRehash(hash: string): boolean;
  equaliseTiming(): Promise<void>;
}

export interface TokenIssuerPort {
  issueAccessToken(claims: { sub: string; email: string; role: string }): IssuedToken;
  issueRefreshToken(claims: { sub: string; sid: string; fam: string; ver: number }): IssuedToken;
  verifyRefreshToken(token: string): { sub: string; sid: string; fam: string; ver: number };
  refreshTtlSeconds(): number;
}

export interface AuthServiceDeps {
  users: UserPort;
  sessions: RefreshSessionPort;
  audit: AuditPort;
  now?: () => Date;
  hasher?: PasswordHasherPort;
  tokens?: TokenIssuerPort;
}

// ---------------------------------------------------------------------------
// Result shapes
// ---------------------------------------------------------------------------

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  requestId?: string | null;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  role: UserRole;
  status: string;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface AuthResult {
  user: PublicUser;
  tokens: AuthTokens;
  /** Absolute refresh expiry, used for the cookie `maxAge`. */
  refreshExpiresAt: Date;
}

/** Safe to render on a "your devices" screen: carries no token material. */
export interface SessionSummary {
  id: string;
  /** True for the session the request itself arrived on. */
  current: boolean;
  /** `primary` for the sign-in token, `rotated` for its descendants. */
  kind: 'primary' | 'rotated';
  ip: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
}

const defaultHasher: PasswordHasherPort = {
  hash: (password) => hashPassword(password),
  verify: verifyPassword,
  needsRehash,
  equaliseTiming,
};

const defaultTokens: TokenIssuerPort = {
  issueAccessToken,
  issueRefreshToken,
  verifyRefreshToken,
  refreshTtlSeconds: () => ttlToSeconds(env.JWT_REFRESH_TTL),
};

export function toPublicUser(record: UserProfile): PublicUser {
  return {
    id: record._id.toString(),
    email: record.email,
    displayName: record.displayName,
    avatarUrl: record.avatarUrl,
    locale: record.locale,
    role: record.role,
    status: record.status,
    lastLoginAt: record.lastLoginAt,
    createdAt: record.createdAt,
  };
}

/** SHA-256 of a refresh token; see the note at the top of the file. */
export function fingerprintToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Distinguishes the sign-in token from a silent-refresh descendant. */
export function sessionKind(session: {
  _id: MongooseTypes.ObjectId;
  family: MongooseTypes.ObjectId;
}): 'primary' | 'rotated' {
  return session._id.toString() === session.family.toString() ? 'primary' : 'rotated';
}

const DUPLICATE_KEY = 11000;

export function createAuthService(deps: AuthServiceDeps): AuthService {
  const now = deps.now ?? ((): Date => new Date());
  const hasher = deps.hasher ?? defaultHasher;
  const tokens = deps.tokens ?? defaultTokens;

  /**
   * Records an audit entry.
   *
   * A failure here must not fail the request it describes: losing the trail is
   * bad, but refusing a legitimate sign-in because logging broke is worse.
   */
  async function audit(
    action: string,
    context: RequestContext,
    extra: {
      actor?: string | null;
      target?: string | null;
      metadata?: Record<string, unknown>;
    } = {},
  ): Promise<void> {    try {
      await deps.audit.write({
        action,
        actorType: extra.actor ? AUDIT_ACTOR_TYPES.USER : AUDIT_ACTOR_TYPES.SYSTEM,
        actor: extra.actor ?? null,
        target: extra.target ?? null,
        ip: context.ip,
        userAgent: context.userAgent,
        requestId: context.requestId ?? null,
        metadata: extra.metadata,
      });
    } catch {
      // Intentionally swallowed.
    }
  }

  /**
   * Mints a refresh token and persists its session in a single write.
   *
   * The row id is generated here rather than by MongoDB so the token can be
   * signed first: the `sid` claim has to name the row, and the row has to store
   * the hash of the token that names it. Pre-generating the id resolves that
   * cycle in one insert instead of inserting a placeholder and patching it.
   *
   * The first session in a family is its own root, so its `family` is its id.
   */
async function issueSession(
  user: UserProfile,
  context: RequestContext,
  family?: string,
): Promise<{ session: RefreshSessionRecord; tokens: AuthTokens; refreshExpiresAt: Date }> {
    const sessionId = new Types.ObjectId();
    const familyId = family ?? sessionId.toString();
    const expiresAt = new Date(now().getTime() + tokens.refreshTtlSeconds() * 1_000);

    const refresh = tokens.issueRefreshToken({
      sub: user._id.toString(),
      sid: sessionId.toString(),
      fam: familyId,
      ver: user.tokenVersion,
    });

    const session = await deps.sessions.insert({
      _id: sessionId.toString(),
      user: user._id.toString(),
      tokenHash: fingerprintToken(refresh.token),
      family: familyId,
      expiresAt,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    const access = tokens.issueAccessToken({
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    });

    return {
      session,
      tokens: {
        accessToken: access.token,
        refreshToken: refresh.token,
        expiresIn: access.expiresInSeconds,
      },
      refreshExpiresAt: expiresAt,
    };
  }

  /** One error for every failed sign-in, whatever the real reason. */
  function invalidCredentials(): ApiError {
    return ApiError.unauthorized('Invalid email or password.');
  }
  return {
    async register(input: RegisterUserInput, context: RequestContext): Promise<AuthResult> {
      const existing = await deps.users.findByEmail(input.email);
      if (existing) {
        // One of the few places where "that address is taken" is the correct
        // answer, so this is not the enumeration concern a failed sign-in is.
        throw ApiError.conflict('An account with that email already exists.');
      }

      const passwordHash = await hasher.hash(input.password);

      let created: UserWithCredentials;
      try {
        created = await deps.users.insert({
          email: input.email,
          passwordHash,
          displayName: input.displayName,
          locale: input.locale,
        });
      } catch (error) {
        // Lost a race against a concurrent registration for the same address.
        if ((error as { code?: number })?.code === DUPLICATE_KEY) {
          throw ApiError.conflict('An account with that email already exists.');
        }
        throw error;
      }

      await audit(AUDIT_ACTIONS.USER_REGISTERED, context, { actor: created._id.toString() });
      const { tokens: issued, refreshExpiresAt } = await issueSession(created, context);

      return { user: toPublicUser(created), tokens: issued, refreshExpiresAt };
    },

    async login(input: LoginInput, context: RequestContext): Promise<AuthResult> {
      const user = await deps.users.findByEmail(input.email);

      if (!user) {
        // Burn the same time a real verification takes, so response latency does
        // not reveal which addresses are registered.
        await hasher.equaliseTiming();
        await audit(AUDIT_ACTIONS.USER_LOGIN_FAILED, context, {
          metadata: { reason: 'unknown_user' },
        });
        throw invalidCredentials();
      }

      if (user.status === USER_STATUSES.SUSPENDED) {
        await hasher.equaliseTiming();
        await audit(AUDIT_ACTIONS.USER_LOGIN_FAILED, context, {
          actor: user._id.toString(),
          metadata: { reason: 'suspended' },
        });
        throw ApiError.forbidden('This account has been suspended.');
      }

      if (user.lockedUntil && user.lockedUntil.getTime() > now().getTime()) {
        await hasher.equaliseTiming();
        await audit(AUDIT_ACTIONS.USER_LOGIN_FAILED, context, {
          actor: user._id.toString(),
          metadata: { reason: 'locked' },
        });
        throw ApiError.tooManyRequests('Too many failed attempts. Try again later.');
      }

      const check = await hasher.verify(user.passwordHash, input.password);

      if (!check.valid) {
        const failedLoginCount = user.failedLoginCount + 1;
        const locked = failedLoginCount >= env.AUTH_MAX_FAILED_LOGINS;
        const lockedUntil = locked
          ? new Date(now().getTime() + env.AUTH_LOCKOUT_MINUTES * 60_000)
          : null;

        await deps.users.recordFailedLogin(user._id.toString(), failedLoginCount, lockedUntil);
        await audit(AUDIT_ACTIONS.USER_LOGIN_FAILED, context, {
          actor: user._id.toString(),
          metadata: { failedLoginCount, locked },
        });

        // Identical to the "no such user" error. A different message or status
        // would confirm which addresses are registered.
        throw invalidCredentials();
      }

      // A hash made under older parameters is upgraded in place, so raising the
      // argon2 cost is a self-healing migration rather than a forced reset.
      if (check.needsRehash) {
        const upgraded = await hasher.hash(input.password);
        await deps.users.updatePasswordHash(user._id.toString(), upgraded);
      }

      await deps.users.recordSuccessfulLogin(user._id.toString(), now());
      await audit(AUDIT_ACTIONS.USER_LOGGED_IN, context, { actor: user._id.toString() });
      const { tokens: issued, refreshExpiresAt } = await issueSession(user, context);

      return { user: toPublicUser(user), tokens: issued, refreshExpiresAt };
    },

    /**
     * Exchanges a refresh token for a fresh pair and rotates the stored token.
     *
     * Every rejection path here returns the same error on purpose. Distinguishing
     * "expired" from "replayed" from "revoked" would hand an attacker a probing
     * oracle; the audit trail is where that detail belongs.
     */
    async refresh(refreshToken: string, context: RequestContext): Promise<AuthResult> {
      /** One opaque error for every rejected refresh, whatever the real reason. */
  const invalid = (): ApiError => ApiError.unauthorized('Invalid or expired session.');

      let claims: { sub: string; sid: string; fam: string; ver: number };
      try {
        claims = tokens.verifyRefreshToken(refreshToken);
      } catch {
        throw invalid();
      }

      const session = await deps.sessions.findById(claims.sid);
      if (!session) {
        throw invalid();
      }

      if (session.revokedAt || session.rotatedAt) {
        // Replay of a token that is already spent. The caller still holds a copy
        // of something they should not, so the family dies with it.
        await deps.sessions.revokeFamily(claims.fam, REVOKED_REASONS.REUSE_DETECTED, now());
        await audit(AUDIT_ACTIONS.TOKEN_REUSE_DETECTED, context, {
          actor: claims.sub,
          target: claims.sid,
          metadata: { family: claims.fam },
        });
        throw invalid();
      }

      if (session.expiresAt.getTime() <= now().getTime()) {
        throw invalid();
      }

      // A valid signature over a row that does not hash to this token means the
      // token was tampered with or the row was replaced. Either way it is not
      // the session it claims to be.
      if (session.tokenHash !== fingerprintToken(refreshToken)) {
        await deps.sessions.revokeFamily(claims.fam, REVOKED_REASONS.REUSE_DETECTED, now());
        await audit(AUDIT_ACTIONS.TOKEN_REUSE_DETECTED, context, {
          actor: claims.sub,
          target: claims.sid,
        });
        throw invalid();
      }

      const user = await deps.users.findById(claims.sub);
      if (!user || user.status === USER_STATUSES.SUSPENDED) {
        await deps.sessions.revokeFamily(claims.fam, REVOKED_REASONS.USER_SUSPENDED, now());
        throw invalid();
      }
      // Bumping `tokenVersion` retires every refresh token a user holds at once,
      // which is how a suspected compromise is cut off without hunting sessions.
      if (claims.ver !== user.tokenVersion) {
        await deps.sessions.revokeFamily(claims.fam, REVOKED_REASONS.ADMIN_REVOKED, now());
        throw invalid();
      }

      const replacement = await issueSession(user, context, claims.fam);

      // Claim the old session before trusting the new one. Without this the
      // check above is a race: two requests redeeming the same token at the same
      // moment would both see it unspent, both mint a replacement, and rotation
      // would guarantee nothing. The compare-and-set in `markRotated` means only
      // one of them wins.
      const claimed = await deps.sessions.markRotated(
        claims.sid,
        replacement.session._id.toString(),
        now(),
      );

      if (!claimed) {
        // Lost the race, so two tokens now exist for one session and we cannot
        // tell which caller is which. That is exactly the situation reuse
        // detection exists for, so the family is burned and both parties have to
        // sign in again. A flaky double-submit costs a re-login; the alternative
        // is a replay window.
        await deps.sessions.revokeFamily(claims.fam, REVOKED_REASONS.REUSE_DETECTED, now());
        await audit(AUDIT_ACTIONS.TOKEN_REUSE_DETECTED, context, {
          actor: user._id.toString(),
          target: claims.sid,
          metadata: { family: claims.fam, race: true },
        });
        throw invalid();
      }

      await audit(AUDIT_ACTIONS.TOKEN_REFRESHED, context, {
        actor: user._id.toString(),
        target: replacement.session._id.toString(),
        metadata: { family: claims.fam },
      });

      return {
        user: toPublicUser(user),
        tokens: replacement.tokens,
        refreshExpiresAt: replacement.refreshExpiresAt,
      };
    },

    async logout(sessionId: string, context: RequestContext): Promise<void> {
      await deps.sessions.revokeById(sessionId, REVOKED_REASONS.LOGOUT, now());
      await audit(AUDIT_ACTIONS.USER_LOGGED_OUT, context, { target: sessionId });
    },

    async logoutAll(userId: string, context: RequestContext): Promise<number> {
      const revoked = await deps.sessions.revokeAllForUser(
        userId,
        REVOKED_REASONS.LOGOUT_ALL,
        now(),
      );
      await audit(AUDIT_ACTIONS.USER_LOGGED_OUT, context, {
        actor: userId,
        metadata: { revoked, scope: 'all' },
      });
      return revoked;
    },

    /** Active sessions, newest first, flagged with the caller's own. */
    async listSessions(
      userId: string,
      currentSessionId?: string | null,
    ): Promise<SessionSummary[]> {
      const rows = await deps.sessions.listForUser(userId);

      return rows
        .filter((row) => row.revokedAt === null && row.expiresAt.getTime() > now().getTime())
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((row) => ({
          id: row._id.toString(),
          current: row._id.toString() === currentSessionId,
          kind: sessionKind(row),
          ip: row.ip,
          userAgent: row.userAgent,
          createdAt: row.createdAt,
          expiresAt: row.expiresAt,
        }));
    },

    async revokeSession(userId: string, sessionId: string, context: RequestContext): Promise<void> {
      const owned = (await deps.sessions.listForUser(userId)).some(
        (row) => row._id.toString() === sessionId,
      );
      if (!owned) {
        // 404, not 403: a session owned by someone else must be
        // indistinguishable from one that does not exist.
        throw ApiError.notFound('Session not found.');
      }
      await deps.sessions.revokeById(sessionId, REVOKED_REASONS.LOGOUT, now());
      await audit(AUDIT_ACTIONS.USER_LOGGED_OUT, context, { actor: userId, target: sessionId });
    },

    /**
     * Changes a password, ends every session, and issues one new session for the
     * caller.
     *
     * All sessions go, including the one making the request. A password change
     * is usually a response to a suspected compromise, and keeping the calling
     * session alive would defeat the point - the request may be the attacker's.
     * The caller still ends up signed in, on a brand new token pair.
     */
    async changePassword(
      userId: string,
      currentPassword: string,
      newPassword: string,
      context: RequestContext,
    ): Promise<AuthResult> {
      // The one non-sign-in path that must fetch the credential: proving the
      // caller knows the existing password is the whole point of the check.
      const user = await deps.users.findCredentialsById(userId);
      if (!user) {
        throw ApiError.notFound('User not found.');
      }

      const check = await hasher.verify(user.passwordHash, currentPassword);
      if (!check.valid) {
        await audit(AUDIT_ACTIONS.USER_LOGIN_FAILED, context, {
          actor: userId,
          metadata: { reason: 'change_password' },
        });
        throw ApiError.unauthorized('Current password is incorrect.');
      }

      const passwordHash = await hasher.hash(newPassword);
      await deps.users.updatePasswordHash(userId, passwordHash, { bumpTokenVersion: true });

      const revoked = await deps.sessions.revokeAllForUser(
        userId,
        REVOKED_REASONS.PASSWORD_CHANGED,
        now(),
      );

      await audit(AUDIT_ACTIONS.USER_LOGGED_OUT, context, {
        actor: userId,
        metadata: { revoked, reason: REVOKED_REASONS.PASSWORD_CHANGED },
      });

      // `tokenVersion` was just bumped, so the returned record is one version
      // behind the database. Issue against the incremented value, otherwise the
      // new refresh token would fail its own version check on first use.
      const { tokens: issued, refreshExpiresAt } = await issueSession(
        { ...user, tokenVersion: user.tokenVersion + 1 },
        context,
      );

      return { user: toPublicUser(user), tokens: issued, refreshExpiresAt };
    },

    /** The caller's own record, or null. Never includes the password hash. */
    async findUser(userId: string): Promise<PublicUser | null> {
      const user = await deps.users.findById(userId);
      return user ? toPublicUser(user) : null;
    },
  };
}

/**
 * The auth surface the HTTP layer depends on.
 *
 * Declared explicitly rather than inferred with `ReturnType`, so the contract
 * stays readable at the point of use and the factory can be annotated with it
 * without a circular reference.
 */
export interface AuthService {
  register(input: RegisterUserInput, context: RequestContext): Promise<AuthResult>;
  login(input: LoginInput, context: RequestContext): Promise<AuthResult>;
  refresh(refreshToken: string, context: RequestContext): Promise<AuthResult>;
  logout(sessionId: string, context: RequestContext): Promise<void>;
  /** Revokes every session for the user; resolves to how many were still live. */
  logoutAll(userId: string, context: RequestContext): Promise<number>;
  listSessions(userId: string, currentSessionId?: string | null): Promise<SessionSummary[]>;
  revokeSession(userId: string, sessionId: string, context: RequestContext): Promise<void>;
  changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    context: RequestContext,
  ): Promise<AuthResult>;
  findUser(userId: string): Promise<PublicUser | null>;
}
