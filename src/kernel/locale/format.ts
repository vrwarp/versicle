/**
 * Locale-aware formatters (Phase 8 §F) — the ONE home for user-facing
 * date/time/number formatting, replacing the ad-hoc `toLocale*` call
 * sites, the three hand-rolled relative-time implementations
 * (DeviceList/DriveImportDialog/SyncPulseIndicator) and the duplicated
 * byte-size/duration formatters (gap report I18N-4/5/6/10).
 *
 * All formatters resolve the UI locale via {@link getUILocale}
 * (kernel/locale/uiLocale.ts — the two-locale rule: these take the UI
 * locale; `book.language` keeps governing segmentation/voices/pinyin and
 * is never passed here). Instances are cached per (locale, options) —
 * the segmenterCache pattern: constructing Intl formatters loads locale
 * data and is expensive.
 *
 * Every function takes an optional trailing `locale` override — used by
 * the unit suite to pin output to known locales, never by production
 * call sites.
 *
 * Lint: `toLocale*` calls are banned outside this directory
 * (eslint no-restricted-syntax, Phase 8).
 */
import { getUILocale, onUILocaleChange } from './uiLocale';

const dateTimeCache = new Map<string, Intl.DateTimeFormat>();
const numberCache = new Map<string, Intl.NumberFormat>();
const rtfCache = new Map<string, Intl.RelativeTimeFormat>();
const collatorCache = new Map<string, Intl.Collator>();

// A locale change invalidates every cached instance.
onUILocaleChange(() => {
  dateTimeCache.clear();
  numberCache.clear();
  rtfCache.clear();
  collatorCache.clear();
});

function dateTimeFormat(options: Intl.DateTimeFormatOptions, locale?: string): Intl.DateTimeFormat {
  const loc = locale ?? getUILocale();
  const key = `${loc}|${JSON.stringify(options)}`;
  let fmt = dateTimeCache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(loc, options);
    dateTimeCache.set(key, fmt);
  }
  return fmt;
}

function numberFormat(options: Intl.NumberFormatOptions, locale?: string): Intl.NumberFormat {
  const loc = locale ?? getUILocale();
  const key = `${loc}|${JSON.stringify(options)}`;
  let fmt = numberCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(loc, options);
    numberCache.set(key, fmt);
  }
  return fmt;
}

type DateInput = Date | number | string;

function toDate(input: DateInput): Date {
  return input instanceof Date ? input : new Date(input);
}

/** Date only — `6/12/2026` (en-US). The `toLocaleDateString()` replacement. */
export function formatDate(input: DateInput, locale?: string): string {
  return dateTimeFormat({ dateStyle: 'short' }, locale).format(toDate(input));
}

/** Time only, hour+minute — `3:42 PM` (en-US). */
export function formatTime(input: DateInput, locale?: string): string {
  return dateTimeFormat({ timeStyle: 'short' }, locale).format(toDate(input));
}

/** Date + time, both short — `6/12/26, 3:42 PM` (en-US). */
export function formatDateTime(input: DateInput, locale?: string): string {
  return dateTimeFormat({ dateStyle: 'short', timeStyle: 'short' }, locale).format(toDate(input));
}

/**
 * Relative time for a past (or future) timestamp — `5 min. ago`, `2 hr.
 * ago`, `now` (en). Falls back to {@link formatDate} beyond 7 days, like
 * every hand-rolled implementation it replaces did.
 */
export function formatRelativeTime(timestamp: number, nowMs: number = Date.now(), locale?: string): string {
  const loc = locale ?? getUILocale();
  let rtf = rtfCache.get(loc);
  if (!rtf) {
    rtf = new Intl.RelativeTimeFormat(loc, { numeric: 'auto', style: 'narrow' });
    rtfCache.set(loc, rtf);
  }

  const diffMs = timestamp - nowMs; // negative = past
  const absMs = Math.abs(diffMs);
  const MINUTE = 60_000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  if (absMs < MINUTE) return rtf.format(0, 'second'); // numeric:'auto' → "now" (en)
  if (absMs < HOUR) return rtf.format(Math.trunc(diffMs / MINUTE), 'minute');
  if (absMs < DAY) return rtf.format(Math.trunc(diffMs / HOUR), 'hour');
  if (absMs < 7 * DAY) return rtf.format(Math.trunc(diffMs / DAY), 'day');
  return formatDate(timestamp, locale);
}

const BYTE_UNITS = ['byte', 'kilobyte', 'megabyte', 'gigabyte', 'terabyte'] as const;

/**
 * Human byte size via Intl unit formatting — `1.2 MB`, `512 KB` (en).
 * Binary-1024 scaling, one decimal at most (matching the five formatters
 * it replaces).
 */
export function formatBytes(bytes: number, locale?: string): string {
  const abs = Math.abs(bytes);
  const exponent = abs < 1 ? 0 : Math.min(Math.floor(Math.log(abs) / Math.log(1024)), BYTE_UNITS.length - 1);
  const value = bytes / 1024 ** exponent;
  return numberFormat(
    { style: 'unit', unit: BYTE_UNITS[exponent], unitDisplay: 'short', maximumFractionDigits: exponent === 0 ? 0 : 1 },
    locale,
  ).format(value);
}

/** Format a number with commas — `12,500` (en-US). */
export function formatNumber(value: number, locale?: string): string {
  return numberFormat({}, locale).format(value);
}

/** Percentage from a 0..1 ratio — `42%` (en). */
export function formatPercent(ratio: number, locale?: string): string {
  return numberFormat({ style: 'percent', maximumFractionDigits: 0 }, locale).format(ratio);
}

/**
 * Duration from minutes — `2h 5m` / `12m` (en), via Intl unit parts.
 * Replaces the duplicated BookCard/BookListItem reading-time renderers.
 */
export function formatDuration(totalMinutes: number, locale?: string): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const minuteFmt = numberFormat({ style: 'unit', unit: 'minute', unitDisplay: 'narrow' }, locale);
  if (hours <= 0) return minuteFmt.format(rest);
  const hourFmt = numberFormat({ style: 'unit', unit: 'hour', unitDisplay: 'narrow' }, locale);
  return `${hourFmt.format(hours)} ${minuteFmt.format(rest)}`;
}

/**
 * Title comparator for sorted lists — cached `Intl.Collator` with numeric
 * collation ("Book 2" before "Book 10"), replacing the bare
 * `localeCompare` sorts (I18N-10). UI locale on purpose: per the
 * two-locale rule this does NOT switch to pinyin collation by
 * `book.language` (recorded ADR consequence).
 */
export function compareTitles(a: string, b: string, locale?: string): number {
  const loc = locale ?? getUILocale();
  let collator = collatorCache.get(loc);
  if (!collator) {
    collator = new Intl.Collator(loc, { numeric: true, sensitivity: 'base' });
    collatorCache.set(loc, collator);
  }
  return collator.compare(a, b);
}
