/**
 * The cover-route contract between the app and the service worker.
 *
 * Book covers render through a virtual same-origin endpoint served by the
 * SW (src/sw.ts → sw-contract.ts) instead of blob: URLs — no
 * createObjectURL leaks, long-lived HTTP caching. This module is the ONLY
 * place the path literal is defined, so app and SW can never drift.
 *
 * Pure string functions only: imported by UI, selectors, AND the
 * worker-resident PlaybackController — keep it dependency-free.
 */

/** Same-origin virtual path prefix the service worker intercepts. */
export const COVERS_ENDPOINT_PREFIX = '/__versicle__/covers/';

/**
 * The URL serving `bookId`'s cover through the SW route. The id is
 * interpolated raw (NOT URL-encoded) — book ids are UUIDs today and the SW
 * slices the pathname without decoding; encoding here would break the
 * existing contract.
 */
export function coverUrl(bookId: string): string {
  return `${COVERS_ENDPOINT_PREFIX}${bookId}`;
}

/**
 * Inverse of {@link coverUrl}: extract the bookId from a pathname, or null
 * when the path is not a cover route (or has an empty id).
 */
export function parseCoverPath(pathname: string): string | null {
  if (!pathname.startsWith(COVERS_ENDPOINT_PREFIX)) return null;
  const bookId = pathname.slice(COVERS_ENDPOINT_PREFIX.length);
  return bookId.length > 0 ? bookId : null;
}
