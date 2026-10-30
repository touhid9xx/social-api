import { describe, expect, it } from 'vitest';

import { formatCount, formatRelativeTime } from './format';

/**
 * Times and numbers are formatted by `Intl`, never by the catalog.
 *
 * The assertions deliberately avoid pinning exact localised strings where
 * possible: we care that the right UNIT and the right BRANCH are chosen, and
 * that a broken timestamp cannot leak "Invalid Date" into the feed.
 *
 * (এখানে ভাষার চেয়ে unit আর branch বাছাই যাচাই করা হয় — exact শব্দ নয়।)
 */

const NOW = Date.parse('2026-01-15T10:00:00.000Z');
const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** Timestamp `ms` before NOW, as the backend would send it (UTC ISO-8601). */
function before(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe('formatRelativeTime', () => {
  it('collapses a zero delta to "now" instead of "0 seconds ago"', () => {
    expect(formatRelativeTime(new Date(NOW).toISOString(), 'en', NOW)).toBe('now');
  });

  it('uses the largest unit that still reads as one number', () => {
    // 90 minutes is "1 hr. ago", not "90 min. ago".
    const ninetyMinutes = formatRelativeTime(before(90 * MINUTE), 'en', NOW);
    expect(ninetyMinutes).toMatch(/hr/i);
    expect(ninetyMinutes).not.toMatch(/min/i);
  });

  it('formats days and weeks', () => {
    expect(formatRelativeTime(before(3 * DAY), 'en', NOW)).toMatch(/day/i);
    expect(formatRelativeTime(before(2 * WEEK), 'en', NOW)).toMatch(/wk|week/i);
  });

  it('handles future timestamps from a slightly fast server clock', () => {
    expect(formatRelativeTime(before(-2 * HOUR), 'en', NOW)).toMatch(/in/i);
  });

  it('falls back to a plain date beyond four weeks', () => {
    const timestamp = NOW - 5 * WEEK;
    const expected = new Intl.DateTimeFormat('en', {
      dateStyle: 'medium',
      timeZone: 'UTC',
    }).format(timestamp);

    expect(formatRelativeTime(new Date(timestamp).toISOString(), 'en', NOW)).toBe(expected);
  });

  it('returns an empty string for an unparseable timestamp', () => {
    // A broken date must punch no hole into the feed — not even "Invalid Date".
    expect(formatRelativeTime('not-a-date', 'en', NOW)).toBe('');
    expect(formatRelativeTime('', 'bn', NOW)).toBe('');
  });

  it('localises the unit under the Bangla locale', () => {
    expect(formatRelativeTime(before(3 * HOUR), 'bn', NOW)).toContain('ঘণ্টা');
  });
});

describe('formatCount', () => {
  it('leaves small counts alone', () => {
    expect(formatCount(0, 'en')).toBe('0');
    expect(formatCount(950, 'en')).toBe('950');
  });

  it('compacts thousands and millions', () => {
    expect(formatCount(1_200, 'en')).toBe('1.2K');
    expect(formatCount(1_500_000, 'en')).toBe('1.5M');
  });

  it('compacts with locale-specific digits and suffixes', () => {
    // ICU's Bangla compact form is "১.২ হা": localised digits, and an
    // abbreviated Bengali suffix rather than the English "K".
    const compact = formatCount(1_200, 'bn');
    expect(compact).toContain('১.২');
    expect(compact).not.toContain('K');
  });

  it('never renders NaN or Infinity into a counter', () => {
    expect(formatCount(Number.NaN, 'en')).toBe('0');
    expect(formatCount(Number.POSITIVE_INFINITY, 'en')).toBe('0');
  });
});
