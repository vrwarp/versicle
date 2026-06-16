/**
 * Shared helper that turns an epoch time into a midnight-Pacific calendar-day
 * key. Imports nothing internal — only the `Intl` global — so kernel modules can
 * use it without violating the import rule.
 *
 * This key is the single source of truth for two things that must agree: when
 * the daily request budget resets, and the per-day stamp used to sum AI spend
 * across the user's devices. The governor here and the app-side cross-device
 * reconciler MUST produce identical keys — a mismatch would silently drop a
 * sibling device's spend — so both call THIS helper instead of each rolling
 * their own.
 */

/** Pad an integer to two digits for the day string. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The midnight-PT day key (`YYYY-MM-DD` in America/Los_Angeles) for an epoch.
 * Uses `Intl` formatting so the runtime handles daylight-saving transitions,
 * avoiding the off-by-one errors a hand-rolled UTC offset would introduce.
 */
export function ptDayString(epochMs: number): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  // en-CA already yields YYYY-MM-DD, but assemble defensively so locale data
  // changes cannot reorder the key.
  return `${year}-${pad2(Number(month))}-${pad2(Number(day))}`;
}
