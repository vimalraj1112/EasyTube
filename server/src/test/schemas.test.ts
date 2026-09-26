import { describe, expect, it } from 'vitest';

import {
  analyzeMediaSchema,
  createDownloadSchema,
  listDownloadsQuerySchema,
  objectIdSchema,
  paginationQuerySchema,
  registerUserSchema,
  searchQuerySchema,
  sourceUrlSchema,
  updateProfileSchema,
} from '../schemas';

const VALID_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301'.replace(/-/g, '').slice(0, 24);
const OBJECT_ID = '507f1f77bcf86cd799439011';

describe('objectIdSchema', () => {
  it('accepts 24 hex characters', () => {
    expect(objectIdSchema.parse(OBJECT_ID)).toBe(OBJECT_ID);
  });

  it('rejects a short or non-hex value', () => {
    expect(objectIdSchema.safeParse('abc').success).toBe(false);
    expect(objectIdSchema.safeParse('z'.repeat(24)).success).toBe(false);
    expect(objectIdSchema.safeParse(`${OBJECT_ID}00`).success).toBe(false);
  });

  it('rejects an injection attempt', () => {
    expect(objectIdSchema.safeParse({ $ne: null }).success).toBe(false);
  });
});

describe('sourceUrlSchema', () => {
  it('accepts http and https', () => {
    expect(sourceUrlSchema.parse('https://example.com/a.mp4')).toBe('https://example.com/a.mp4');
    expect(sourceUrlSchema.parse('http://example.com/a.mp4')).toBe('http://example.com/a.mp4');
  });

  it('rejects non-http protocols that could reach the filesystem or internals', () => {
    // `file:` would read the server's own disk; `data:` and `ftp:` have no place here.
    for (const url of [
      'file:///etc/passwd',
      'ftp://example.com/a.mp4',
      'data:text/plain;base64,AAAA',
      'javascript:alert(1)',
    ]) {
      expect(sourceUrlSchema.safeParse(url).success).toBe(false);
    }
  });

  it('trims and drops a trailing slash', () => {
    expect(sourceUrlSchema.parse('  https://example.com/a.mp4/  ')).toBe('https://example.com/a.mp4');
  });

  it('rejects an empty or malformed URL', () => {
    expect(sourceUrlSchema.safeParse('').success).toBe(false);
    expect(sourceUrlSchema.safeParse('not a url').success).toBe(false);
  });

  it('rejects hosts on the private network the server runs in', () => {
    // A valid http(s) URL aimed at loopback, RFC 1918 space, link-local
    // metadata, CGNAT or an IPv6 loopback is still an SSRF vector.
    for (const url of [
      'http://127.0.0.1:8080/admin',
      'http://localhost/a.mp4',
      'http://10.0.0.5/a.mp4',
      'http://172.16.4.4/a.mp4',
      'http://192.168.1.1/a.mp4',
      'http://169.254.169.254/latest/meta-data/',
      'http://100.64.0.1/a.mp4',
      'http://0.0.0.0/a.mp4',
      'http://[::1]/a.mp4',
      'http://[::ffff:127.0.0.1]/a.mp4',
      'http://[fe80::1]/a.mp4',
    ]) {
      expect(sourceUrlSchema.safeParse(url).success).toBe(false);
    }
  });

  it('rejects internal-looking names', () => {
    for (const url of [
      'https://db.internal/a.mp4',
      'https://printer.local/a.mp4',
      'https://api.home.arpa/a.mp4',
      'https://host.lan/a.mp4',
    ]) {
      expect(sourceUrlSchema.safeParse(url).success).toBe(false);
    }
  });

  it('rejects embedded credentials that disguise the real host', () => {
    // Reads like example.com, actually goes to evil.test.
    expect(sourceUrlSchema.safeParse('https://example.com@evil.test/a.mp4').success).toBe(false);
    expect(sourceUrlSchema.safeParse('https://user:pass@example.com/a.mp4').success).toBe(false);
  });

  it('still accepts public addresses and names', () => {
    for (const url of [
      'https://8.8.8.8/a.mp4',
      'https://172.32.0.1/a.mp4',
      'https://cdn.example.com/a.mp4',
      'https://media.example.co.uk/a.mp4',
    ]) {
      expect(sourceUrlSchema.safeParse(url).success).toBe(true);
    }
  });
});

describe('analyzeMediaSchema', () => {
  it('requires an authorization basis', () => {
    const result = analyzeMediaSchema.safeParse({
      sourceUrl: 'https://example.com/a.mp4',
      authorization: { note: 'my own clip' },
    });

    expect(result.success).toBe(false);
  });

  it('accepts a complete request', () => {
    const result = analyzeMediaSchema.parse({
      sourceUrl: 'https://example.com/a.mp4',
      authorization: { basis: 'SELF_PUBLISHED' },
    });

    expect(result.authorization.basis).toBe('SELF_PUBLISHED');
    expect(result.sourceUrl).toBe('https://example.com/a.mp4');
  });

  it('rejects an unknown basis', () => {
    expect(
      analyzeMediaSchema.safeParse({
        sourceUrl: 'https://example.com/a.mp4',
        authorization: { basis: 'BECAUSE_I_WANT_TO' },
      }).success,
    ).toBe(false);
  });
});

describe('paginationQuerySchema', () => {
  it('coerces numeric strings and applies defaults', () => {
    expect(paginationQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(paginationQuerySchema.parse({ page: '3', limit: '50' })).toEqual({ page: 3, limit: 50 });
  });

  it('rejects out-of-range paging', () => {
    expect(paginationQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(paginationQuerySchema.safeParse({ limit: '1000' }).success).toBe(false);
  });
});

describe('searchQuerySchema', () => {
  it('rejects a term that starts with $ so it cannot act as a Mongo operator', () => {
    expect(searchQuerySchema.safeParse('$where').success).toBe(false);
    expect(searchQuerySchema.safeParse('normal search').success).toBe(true);
  });
});

describe('registerUserSchema', () => {
  const valid = {
    email: '  Person@Example.com ',
    password: 'CorrectHorse9Battery',
    displayName: '  Person  ',
  };

  it('normalises the email and display name', () => {
    const parsed = registerUserSchema.parse(valid);

    expect(parsed.email).toBe('person@example.com');
    expect(parsed.displayName).toBe('Person');
  });

  it('enforces the password policy', () => {
    expect(registerUserSchema.safeParse({ ...valid, password: 'short1A' }).success).toBe(false);
    expect(registerUserSchema.safeParse({ ...valid, password: 'alllowercase123' }).success).toBe(false);
    expect(registerUserSchema.safeParse(valid).success).toBe(true);
  });
});

describe('updateProfileSchema', () => {
  it('rejects an empty patch', () => {
    expect(updateProfileSchema.safeParse({}).success).toBe(false);
  });

  it('accepts a single field', () => {
    expect(updateProfileSchema.parse({ displayName: 'New' })).toEqual({ displayName: 'New' });
  });
});

describe('createDownloadSchema', () => {
  it('requires a media item and a container', () => {
    const result = createDownloadSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('accepts a request carrying only a media item when an idempotency key is present', () => {
    const parsed = createDownloadSchema.parse({
      mediaItemId: OBJECT_ID,
      container: 'mp4',
      idempotencyKey: 'client-key-1234',
    });

    expect(parsed.mediaItemId).toBe(OBJECT_ID);
  });

  it('rejects a request with neither a format nor an idempotency key', () => {
    const result = createDownloadSchema.safeParse({ mediaItemId: OBJECT_ID, container: 'mp4' });

    expect(result.success).toBe(false);
  });

  it('rejects an unsupported container', () => {
    expect(
      createDownloadSchema.safeParse({ mediaItemId: OBJECT_ID, container: 'avi', mediaFormatId: VALID_ID })
        .success,
    ).toBe(false);
  });
});

describe('listDownloadsQuerySchema', () => {
  it('defaults the sort order', () => {
    expect(listDownloadsQuerySchema.parse({}).sortOrder).toBe('desc');
  });

  it('coerces paging and status together', () => {
    const parsed = listDownloadsQuerySchema.parse({ page: '2', limit: '10', status: 'FAILED' });

    expect(parsed).toEqual({ page: 2, limit: 10, status: 'FAILED', sortOrder: 'desc' });
  });

  it('rejects an unknown status', () => {
    expect(listDownloadsQuerySchema.safeParse({ status: 'NOT_A_STATUS' }).success).toBe(false);
  });
});
