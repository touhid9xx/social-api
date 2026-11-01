/**
 * Locale-aware formatting for values that never belong in the message catalog:
 * times and numbers. `Intl` already knows every locale we ship, so the catalog
 * only carries words we actually wrote.
 *
 * (সময় আর সংখ্যা `Intl`-এর কাজ — catalog-এ শুধু আমাদের লেখা শব্দ থাকে।)
 */

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Beyond this, "5 weeks ago" is less useful than the date itself. The backend
 * stores UTC ISO-8601, and `Date` renders it in the viewer's zone.
 */
const RELATIVE_LIMIT_MS = 4 * WEEK;

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();

/**
 * Formatters are expensive to construct and are recreated on every render if
 * built inline, so one instance per locale is cached for the tab's lifetime.
 */
function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
  let formatter = relativeFormatters.get(locale);
  if (!formatter) {
    // `numeric: 'auto'` is what turns `0 seconds` into "now" / "এখন".
    formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'short' });
    relativeFormatters.set(locale, formatter);
  }
  return formatter;
}

function dateFormatter(locale: string): Intl.DateTimeFormat {
  let formatter = dateFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
    dateFormatters.set(locale, formatter);
  }
  return formatter;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * A calendar day (`YYYY-MM-DD`, as the analytics aggregates send it) as a short
 * label: "Aug 3" / "৩ আগ".
 *
 * Parsed explicitly as UTC midnight and formatted in UTC, so a reader west of
 * Greenwich never sees yesterday's date on today's bar.
 */
export function formatDay(isoDate: string, locale: string): string {
  const timestamp = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(timestamp)) return isoDate;

  let formatter = dayFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
    dayFormatters.set(locale, formatter);
  }
  return formatter.format(timestamp);
}

function numberFormatter(locale: string): Intl.NumberFormat {
  let formatter = numberFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
    numberFormatters.set(locale, formatter);
  }
  return formatter;
}

/**
 * "3 hours ago" / "৩ ঘণ্টা আগে", falling back to a plain date beyond four weeks.
 *
 * Returns an empty string for an unparseable timestamp: a broken date must not
 * punch a `Invalid Date` hole into the feed.
 */
export function formatRelativeTime(iso: string, locale: string, now: number = Date.now()): string {
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return '';

  const delta = timestamp - now;
  const magnitude = Math.abs(delta);

  if (magnitude >= RELATIVE_LIMIT_MS) return dateFormatter(locale).format(timestamp);

  const formatter = relativeFormatter(locale);

  // Each step uses the largest unit that still reads as a single number:
  // 90 minutes is "1 hour ago", not "90 minutes ago".
  if (magnitude < MINUTE) return formatter.format(Math.round(delta / SECOND), 'second');
  if (magnitude < HOUR) return formatter.format(Math.round(delta / MINUTE), 'minute');
  if (magnitude < DAY) return formatter.format(Math.round(delta / HOUR), 'hour');
  if (magnitude < WEEK) return formatter.format(Math.round(delta / DAY), 'day');
  return formatter.format(Math.round(delta / WEEK), 'week');
}

/**
 * Compact counts: 950 → "950", 1_200 → "1.2K". Feed counters are decoration,
 * never a budget, so precision beyond one fraction digit is noise.
 */
export function formatCount(value: number, locale: string): string {
  if (!Number.isFinite(value)) return '0';
  return numberFormatter(locale).format(value);
}

/**
 * `Intl.NumberFormat`'s own unit names, so the catalog carries no unit words we
 * would have to keep in two languages.
 */
const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte', 'petabyte'] as const;

const unitFormatters = new Map<string, Intl.NumberFormat>();

/** Cached `NumberFormat` for any `Intl` unit, keyed by locale + options. */
function unitFormatter(
  locale: string,
  unit: Intl.NumberFormatOptions['unit'],
  digits: number,
): Intl.NumberFormat {
  const cacheKey = `${locale}:${String(unit)}:${String(digits)}`;
  let formatter = unitFormatters.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit,
      unitDisplay: 'short',
      maximumFractionDigits: digits,
    });
    unitFormatters.set(cacheKey, formatter);
  }
  return formatter;
}

/**
 * A byte count in the reader's units: 1536 → "1.5 KB" / "১.৫ কিলোবাইট".
 *
 * Binary steps (1024) are what every file browser shows for a stored blob, so a
 * 2 MiB upload that `MEDIA_MAX_IMAGE_BYTES` accepts reads as "2 MB" here too.
 *
 * Anything at or below zero formats as "0 byte": an aggregate over an empty
 * table is a real answer, and `Math.log(0)` is `-Infinity`.
 */
export function formatBytes(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes < 1) return unitFormatter(locale, 'byte', 0).format(0);

  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;

  // One fraction digit below 10 ("1.5 MB"), none above ("512 MB"): the extra
  // digit is noise once the number is already three figures wide.
  return unitFormatter(locale, BYTE_UNITS[exponent], value >= 10 ? 0 : 1).format(value);
}

/**
 * A duration in milliseconds: 412 → "412 ms" / "৪১২ মি.সে.".
 *
 * The dashboard reports averages and percentiles as floats, so the digits are
 * fixed here rather than by the caller: sub-millisecond differences are never
 * the story, and "412.37 ms" reads as false precision.
 */
export function formatMilliseconds(value: number, locale: string): string {
  if (!Number.isFinite(value) || value < 0)
    return unitFormatter(locale, 'millisecond', 0).format(0);
  return unitFormatter(locale, 'millisecond', value >= 100 ? 0 : 1).format(value);
}

/**
 * A 0..1 ratio as a percentage: 0.042 → "4.2%" / "৪.২%".
 *
 * `Intl` multiplies by 100 itself, so callers must pass the raw fraction the
 * contract sends rather than a pre-scaled number.
 */
export function formatPercent(ratio: number, locale: string): string {
  if (!Number.isFinite(ratio)) return percentFormatter(locale).format(0);
  return percentFormatter(locale).format(ratio);
}

const percentFormatters = new Map<string, Intl.NumberFormat>();

function percentFormatter(locale: string): Intl.NumberFormat {
  let formatter = percentFormatters.get(locale);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 });
    percentFormatters.set(locale, formatter);
  }
  return formatter;
}
