import jwt, { type JwtPayload, type SignOptions } from 'jsonwebtoken';
import { z } from 'zod';

import { env } from '../config/env';
import { TOKEN_TYPES, type TokenType } from '../config/constants';

/**
 * JWT issuing and verification.
 *
 * Two secrets, never one: access tokens are signed with `JWT_ACCESS_SECRET` and
 * refresh tokens with `JWT_REFRESH_SECRET`. A compromised refresh secret then
 * cannot be used to mint access tokens, and - more importantly - a refresh token
 * can never be presented as an access token, because the `typ` claim is verified
 * in addition to the signature.
 *
 * Claims are deliberately minimal. The token says *who* and *what kind*; it
 * never says what the user is allowed to do. Authorisation is re-read from the
 * database on each request, so suspending an account or changing its role takes
 * effect immediately instead of waiting for a token to expire.
 */

const JWT_ALGORITHM = 'HS256' as const;

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: string;
}

export interface RefreshTokenClaims {
  /** The `refresh_sessions` row id, so a token maps to exactly one session. */
  sid: string;
  sub: string;
  /** Rotation lineage. Constant for every descendant of one login. */
  fam: string;
  /**
   * The `tokenVersion` the session was issued under. Bumping the user's version
   * retires every outstanding refresh token in one write, with no need to find
   * or revoke the sessions individually.
   */
  ver: number;
}

export interface IssuedToken {
  token: string;
  /** Seconds until expiry, for the client and for cookie `maxAge`. */
  expiresInSeconds: number;
}

const baseOptions = (): SignOptions => ({
  algorithm: JWT_ALGORITHM,
  issuer: env.JWT_ISSUER,
  audience: env.JWT_AUDIENCE,
});

/**
 * Converts a `jsonwebtoken` TTL string (`15m`, `7d`, `900`) to seconds.
 *
 * The library accepts a string or a number of seconds; the API only ever
 * carries the string form (it is far more legible in a config file), so the
 * conversion happens once, here, and everything downstream works in seconds.
 */
export function ttlToSeconds(ttl: string): number {
  const trimmed = ttl.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }

  const match = /^(\d+)\s*(ms|s|m|h|d|w|y)$/i.exec(trimmed);
  if (!match) {
    throw new Error(`Unsupported JWT TTL: ${ttl}`);
  }

  const amount = Number(match[1]);
  const unit = (match[2] ?? 's').toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1 / 1000,
    s: 1,
    m: 60,
    h: 3_600,
    d: 86_400,
    w: 604_800,
    y: 31_536_000,
  };

  return Math.floor(amount * (multipliers[unit] ?? 1));
}

function secretFor(type: TokenType): string {
  return type === TOKEN_TYPES.ACCESS ? env.JWT_ACCESS_SECRET : env.JWT_REFRESH_SECRET;
}

export function issueAccessToken(claims: AccessTokenClaims): IssuedToken {
  const expiresIn = ttlToSeconds(env.JWT_ACCESS_TTL);
  const token = jwt.sign({ ...claims, typ: TOKEN_TYPES.ACCESS }, secretFor(TOKEN_TYPES.ACCESS), {
    ...baseOptions(),
    expiresIn,
  });
  return { token, expiresInSeconds: expiresIn };
}

export function issueRefreshToken(claims: RefreshTokenClaims): IssuedToken {
  const expiresIn = ttlToSeconds(env.JWT_REFRESH_TTL);
  const token = jwt.sign({ ...claims, typ: TOKEN_TYPES.REFRESH }, secretFor(TOKEN_TYPES.REFRESH), {
    ...baseOptions(),
    expiresIn,
  });
  return { token, expiresInSeconds: expiresIn };
}

export class TokenError extends Error {
  public readonly reason: 'expired' | 'invalid' | 'wrong_type';

  constructor(reason: 'expired' | 'invalid' | 'wrong_type', message: string) {
    super(message);
    this.name = 'TokenError';
    this.reason = reason;
  }
}

function decode<TClaims>(token: string, expected: TokenType): TClaims {
  let payload: JwtPayload;

  try {
    payload = jwt.verify(token, secretFor(expected), {
      algorithms: [JWT_ALGORITHM],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
    }) as JwtPayload;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      throw new TokenError('expired', 'Token has expired.');
    }
    throw new TokenError('invalid', 'Token is not valid.');
  }

  // Second lock on token separation. The first is the secret: a refresh token
  // fails signature verification against the access secret, so this branch is
  // only reachable if both secrets were ever configured identically - which
  // startup validation forbids. Kept because it costs nothing and turns a
  // configuration mistake into a rejection rather than a silent mix-up.
  if (payload.typ !== expected) {
    throw new TokenError('wrong_type', `Expected a ${expected} token.`);
  }

  return payload as TClaims;
}

export function verifyAccessToken(token: string): AccessTokenClaims & JwtPayload {
  return decode<AccessTokenClaims & JwtPayload>(token, TOKEN_TYPES.ACCESS);
}

export function verifyRefreshToken(token: string): RefreshTokenClaims & JwtPayload {
  return decode<RefreshTokenClaims & JwtPayload>(token, TOKEN_TYPES.REFRESH);
}

/**
 * Pulls a bearer token out of an `Authorization` header.
 *
 * Returns null rather than throwing so the caller decides whether a missing
 * header means "anonymous" or "unauthenticated", which differ between optional
 * and required authentication.
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== 'bearer' || rest.length === 0) {
    return null;
  }

  const token = rest.join(' ').trim();
  return token.length > 0 ? token : null;
}

/** Parses the subject, which Mongoose stores as a string id in JWT payloads. */
export const subjectSchema = z.string().regex(/^[0-9a-fA-F]{24}$/, 'must be an ObjectId');
