import { describe, expect, it } from 'vitest';

import { formatBytes, formatDuration } from './utils';

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
