import { describe, expect, it } from 'vitest';

import { formatBytes, formatDateTime, formatDuration } from './utils';

describe('formatBytes', () => {
  it('formats byte tiers', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(34 * 1024 * 1024)).toBe('34.0 MB');
  });

  it('guards against invalid input', () => {
    expect(formatBytes(Number.NaN)).toBe('0 B');
    expect(formatBytes(-10)).toBe('0 B');
  });
});

describe('formatDuration', () => {
  it('formats minutes and hours', () => {
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3723)).toBe('1:02:03');
  });

  it('guards against invalid input', () => {
    expect(formatDuration(Number.NaN)).toBe('--:--');
    expect(formatDuration(-1)).toBe('--:--');
  });
});

describe('formatDateTime', () => {
  it('renders an ISO timestamp instead of "Invalid Date"', () => {
    expect(formatDateTime('2026-01-02T10:00:00.000Z')).not.toBe('Invalid Date');
    expect(formatDateTime('2026-01-02T10:00:00.000Z')).not.toBe('—');
  });

  it('guards against missing or unparseable input', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDateTime(undefined)).toBe('—');
    expect(formatDateTime('')).toBe('—');
    expect(formatDateTime('not-a-date')).toBe('—');
  });
});
