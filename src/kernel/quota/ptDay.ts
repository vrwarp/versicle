/**
 * The shared midnight-PT day-key helper (Phase A DRY). L0: imports NOTHING
 * internal — only the `Intl` global — so it honors kernel-imports-nothing the
 * same way the rest of kernel/quota does.
 *
 * The day key is the single source of truth for the RPD-reset / cross-device
 * embedSpend stamp: the kernel QuotaGovernor and the app-layer
 * embedSpendReconciler MUST produce structurally identical keys (a mismatch
 * would silently drop sibling spend), so both consume THIS helper instead of
 * carrying their own copy.
 */

/** Pad an integer to two digits for the day string. */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * The midnight-PT day key (`YYYY-MM-DD` in America/Los_Angeles) for an epoch.
 * Uses `Intl` formatting so DST is handled by the runtime rather than a
 * hand-rolled offset (the off-by-one/DST hazard the plan calls out).
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
