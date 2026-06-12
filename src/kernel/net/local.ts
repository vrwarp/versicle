/**
 * Same-origin / local-URL fetch helper (Phase 7 §I).
 *
 * The lint ban on raw `fetch` outside src/kernel/net needs a home for the
 * handful of LOCAL fetches (blob: cover URLs from epub.js, `/books/…`,
 * `/dict/…`): they are not egress — no registry entry, no CSP host — but
 * routing them through here keeps the ban exception-free and makes "this
 * never leaves the device" a checked property instead of a comment.
 *
 * Throws (DEV-visible, structurally impossible to reach for the current
 * call sites) when handed a cross-origin absolute URL.
 */

function isLocalUrl(url: string): boolean {
  if (url.startsWith('blob:') || url.startsWith('data:')) return true;
  // Relative URLs are same-origin by construction.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return true;
  if (typeof location !== 'undefined') {
    try {
      return new URL(url).origin === location.origin;
    } catch {
      return false;
    }
  }
  return false;
}

/** Fetch a same-origin/blob/data URL. */
export function localFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!isLocalUrl(url)) {
    return Promise.reject(
      new Error(
        `localFetch only serves same-origin/blob/data URLs; "${url}" is remote — route it through NetworkGateway.egress() with a registry entry.`,
      ),
    );
  }
  return fetch(url, init);
}
