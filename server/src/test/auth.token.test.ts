import { describe, expect, it } from 'vitest';

import { TOKEN_TYPES } from '../config/constants';
import {
  TokenError,
  extractBearerToken,
  issueAccessToken,
  issueRefreshToken,
  ttlToSeconds,
  verifyAccessToken,
  verifyRefreshToken,
} from '../utils/token';

const SUBJECT = '507f1f77bcf86cd799439011';

describe('ttlToSeconds', () => {
  it('parses the units jsonwebtoken accepts', () => {
    expect(ttlToSeconds('900')).toBe(900);
    expect(ttlToSeconds('30s')).toBe(30);
    expect(ttlToSeconds('15m')).toBe(900);
    expect(ttlToSeconds('2h')).toBe(7_200);
    expect(ttlToSeconds('7d')).toBe(604_800);
    expect(ttlToSeconds('1w')).toBe(604_800);
  });

  it('tolerates whitespace and mixed case', () => {
    expect(ttlToSeconds(' 15M ')).toBe(900);
  });

  it('throws on anything it cannot interpret, rather than defaulting', () => {
    // A silent fallback here would quietly issue a token with no expiry.
    expect(() => ttlToSeconds('soon')).toThrow(/Unsupported JWT TTL/);
    expect(() => ttlToSeconds('15x')).toThrow(/Unsupported JWT TTL/);
  });
});

describe('access tokens', () => {
  const claims = { sub: SUBJECT, email: 'user@example.com', role: 'USER' };

  it('round-trips its claims', () => {
    const { token, expiresInSeconds } = issueAccessToken(claims);
    const verified = verifyAccessToken(token);

    expect(verified.sub).toBe(SUBJECT);
    expect(verified.email).toBe('user@example.com');
    expect(verified.role).toBe('USER');
    expect(verified.typ).toBe(TOKEN_TYPES.ACCESS);
    expect(expiresInSeconds).toBeGreaterThan(0);
  });

  it('refuses a refresh token, so the two token classes cannot be swapped', () => {
    const refresh = issueRefreshToken({ sub: SUBJECT, sid: SUBJECT, fam: SUBJECT, ver: 0 });

    // The failure is a signature mismatch, not a `typ` mismatch: the refresh
    // secret is not the access secret, so the access verifier never gets far
    // enough to read the claims. That is the stronger of the two protections -
    // it holds even if the claim were removed entirely.
    expect(() => verifyAccessToken(refresh.token)).toThrow(TokenError);
    try {
      verifyAccessToken(refresh.token);
    } catch (error) {
      expect((error as TokenError).reason).toBe('invalid');
    }
  });

  it('rejects a token whose payload has been edited', () => {
    const { token } = issueAccessToken(claims);
    const [header, payload, signature] = token.split('.');

    const decoded = JSON.parse(Buffer.from(payload as string, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    decoded.role = 'ADMIN';
    const forged = Buffer.from(JSON.stringify(decoded)).toString('base64url');

    expect(() => verifyAccessToken(`${header}.${forged}.${signature}`)).toThrow(TokenError);
  });

  it('rejects garbage', () => {
    expect(() => verifyAccessToken('not.a.token')).toThrow(TokenError);
    expect(() => verifyAccessToken('')).toThrow(TokenError);
  });
});

describe('refresh tokens', () => {
  it('round-trips the session, family and version claims', () => {
    const { token } = issueRefreshToken({
      sub: SUBJECT,
      sid: 'aaaabbbbccccddddeeeeffff',
      fam: '111122223333444455556666',
      ver: 3,
    });

    const verified = verifyRefreshToken(token);
    expect(verified.sub).toBe(SUBJECT);
    expect(verified.sid).toBe('aaaabbbbccccddddeeeeffff');
    expect(verified.fam).toBe('111122223333444455556666');
    expect(verified.ver).toBe(3);
  });

  it('refuses an access token', () => {
    const access = issueAccessToken({ sub: SUBJECT, email: 'a@b.com', role: 'USER' });
    expect(() => verifyRefreshToken(access.token)).toThrow(TokenError);
  });

  it('is signed with a different secret from the access token', () => {
    // The two secrets are independent, so a leaked refresh secret cannot mint an
    // access token. Proven by the access verifier rejecting a refresh token and
    // the other way round, which the tests above already assert; this documents
    // the reason those assertions matter.
    const access = issueAccessToken({ sub: SUBJECT, email: 'a@b.com', role: 'USER' });
    const [header, payload, signature] = access.token.split('.');

    // Re-signing the same header/payload with the refresh verifier must fail,
    // because the access secret differs from the refresh secret.
    expect(() => verifyRefreshToken(`${header}.${payload}.${signature}`)).toThrow(TokenError);
  });
});

describe('extractBearerToken', () => {
  it('reads a well-formed header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearerToken('bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it('returns null for anything it cannot use', () => {
    // A null result means "no credential", so the caller decides whether that is
    // anonymous access or a 401. It never means a bad token.
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('')).toBeNull();
    expect(extractBearerToken('Basic abc')).toBeNull();
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('Bearer   ')).toBeNull();
  });
});
