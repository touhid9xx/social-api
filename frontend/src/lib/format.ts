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
