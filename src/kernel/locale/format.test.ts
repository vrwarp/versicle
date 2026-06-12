/**
 * Formatter unit suite (Phase 8 §F / prep PR-1) — pinned locales: every
 * assertion passes an explicit locale so the host's ICU defaults cannot
 * flake the suite.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  formatDate,
  formatTime,
  formatDateTime,
  formatRelativeTime,
  formatBytes,
  formatPercent,
  formatDuration,
  compareTitles,
} from './format';
import {
  getUILocale,
  setUILocale,
  resetUILocaleCacheForTests,
  UI_LOCALE_STORAGE_KEY,
} from './uiLocale';
import { formatMessage, resolveMessage, isMessageKey, ERROR_MESSAGE_KEYS, messages } from './messages';
import { APP_ERROR_CODES } from '~types/errors';

// A fixed instant: 2026-06-12T15:42:30 local time.
const T = new Date(2026, 5, 12, 15, 42, 30).getTime();

describe('kernel/locale formatters (pinned locales)', () => {
  it('formatDate/Time/DateTime: en-US short styles', () => {
    expect(formatDate(T, 'en-US')).toBe('6/12/26');
    expect(formatTime(T, 'en-US')).toBe('3:42 PM');
    expect(formatDateTime(T, 'en-US')).toBe('6/12/26, 3:42 PM');
  });

  it('formatDate: de-DE renders the same instant in German conventions', () => {
    expect(formatDate(T, 'de-DE')).toBe('12.06.26');
  });

  it('formatRelativeTime: minute/hour/day buckets and the date fallback', () => {
    expect(formatRelativeTime(T - 10_000, T, 'en-US')).toBe('now');
    // narrow en matches the hand-rolled "5m ago"/"3h ago" output exactly.
    expect(formatRelativeTime(T - 5 * 60_000, T, 'en-US')).toBe('5m ago');
    expect(formatRelativeTime(T - 3 * 3_600_000, T, 'en-US')).toBe('3h ago');
    expect(formatRelativeTime(T - 2 * 86_400_000, T, 'en-US')).toBe('2d ago');
    // ≥ 7 days falls back to the absolute date (the behavior the three
    // hand-rolled implementations converged on).
    expect(formatRelativeTime(T - 30 * 86_400_000, T, 'en-US')).toBe('5/13/26');
  });

  it('formatBytes: 1024 scaling with localized unit suffixes', () => {
    expect(formatBytes(0, 'en-US')).toBe('0 byte');
    expect(formatBytes(512, 'en-US')).toBe('512 byte');
    expect(formatBytes(2048, 'en-US')).toBe('2 kB');
    expect(formatBytes(1.5 * 1024 * 1024, 'en-US')).toBe('1.5 MB');
    expect(formatBytes(3 * 1024 ** 3, 'en-US')).toBe('3 GB');
  });

  it('formatPercent: 0..1 ratio in', () => {
    expect(formatPercent(0.42, 'en-US')).toBe('42%');
    expect(formatPercent(1, 'en-US')).toBe('100%');
  });

  it('formatDuration: minutes / hours+minutes', () => {
    expect(formatDuration(12, 'en-US')).toBe('12m');
    expect(formatDuration(125, 'en-US')).toBe('2h 5m');
    expect(formatDuration(0, 'en-US')).toBe('0m');
  });

  it('compareTitles: numeric collation sorts "Book 2" before "Book 10" (I18N-10)', () => {
    const titles = ['Book 10', 'Book 2', 'book 1'];
    titles.sort((a, b) => compareTitles(a, b, 'en-US'));
    expect(titles).toEqual(['book 1', 'Book 2', 'Book 10']);
    // Bare localeCompare-style default collation would have yielded
    // lexicographic "Book 10" < "Book 2".
    expect('Book 2'.localeCompare('Book 10') > 0).toBe(true);
  });
});

describe('kernel/locale UI-locale resolution', () => {
  afterEach(() => {
    localStorage.removeItem(UI_LOCALE_STORAGE_KEY);
    resetUILocaleCacheForTests();
  });

  it('resolves override → navigator.language → en, and caches', () => {
    resetUILocaleCacheForTests();
    // jsdom default navigator.language is en-US.
    expect(getUILocale()).toBe(navigator.language || 'en');

    setUILocale('de-DE');
    expect(getUILocale()).toBe('de-DE');

    setUILocale(null);
    expect(getUILocale()).toBe(navigator.language || 'en');
  });

  it('ignores an invalid stored override', () => {
    localStorage.setItem(UI_LOCALE_STORAGE_KEY, 'not a locale!!');
    resetUILocaleCacheForTests();
    expect(getUILocale()).toBe(navigator.language || 'en');
  });
});

describe('kernel/locale message catalog (i18n ADR §2)', () => {
  it('formatMessage substitutes {param} placeholders', () => {
    expect(formatMessage('sync.signedInViaRedirect', { email: 'a@b.c' })).toBe('Signed in as a@b.c');
  });

  it('leaves unknown placeholders verbatim', () => {
    expect(formatMessage('sync.signedInViaRedirect', {})).toBe('Signed in as {email}');
  });

  it('resolveMessage: key | {key, params} | raw prose (the transitional overload)', () => {
    expect(resolveMessage('sync.cleanSync.applied')).toBe('Sync complete!');
    expect(resolveMessage({ key: 'sync.signedInViaRedirect', params: { email: 'x@y.z' } })).toBe(
      'Signed in as x@y.z',
    );
    expect(resolveMessage('Free-form prose stays as-is')).toBe('Free-form prose stays as-is');
    expect(isMessageKey('sync.cleanSync.applied')).toBe(true);
    expect(isMessageKey('Free-form prose stays as-is')).toBe(false);
  });

  it('errors.* namespace keys 1:1 by AppErrorCode (C10)', () => {
    for (const code of APP_ERROR_CODES) {
      expect(messages[`errors.${code}`], `errors.${code}`).toBeTypeOf('string');
    }
    expect(ERROR_MESSAGE_KEYS).toHaveLength(APP_ERROR_CODES.length);
  });
});
