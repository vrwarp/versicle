/**
 * The service worker's read contract with EpubLibraryDB (Phase 3, D3 in
 * plan/overhaul/prep/phase3-storage-gateway.md; absorbs src/sw-utils.ts).
 *
 * The SW runs in its own JS context and cannot share the app's connection
 * (src/data/connection.ts), so it owns its own read-only connection at
 * whatever version is current (unversioned open — the SW must never trigger
 * or block an upgrade). The database name comes from the schema module
 * instead of the local copy sw-utils.ts used to re-declare, so the two can
 * no longer drift.
 *
 * The connection is MEMOIZED (P-perf): every visible cover used to pay a
 * full open/close handshake of its own — one per cover per paint, a
 * library grid's worth on every scroll. It is held in a module-level promise
 * with an idle-close timer, and mirrors connection.ts's lifecycle discipline:
 * `blocking` (another context is upgrading) closes it immediately so an
 * upgrade is never blocked by a cover read, and `terminated` drops it so the
 * next request reopens.
 *
 * The idle timer is BOUND to the connection it was armed for and cancelled
 * when a new request starts. Neither is cosmetic: `blocking`/`terminated`/a
 * failed open drop the memoized promise while reads are still in flight, and
 * each of those reads arms the timer from its `finally` afterwards — an
 * unbound timer would then close whichever connection the NEXT burst had
 * opened, mid-read, 30s later.
 *
 * The legacy `'books'`-store fallback survives until P9: a pre-v18
 * straggler's covers must render before their first main-app upgrade.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { DB_NAME } from './schema';

export { DB_NAME };
export const STATIC_MANIFESTS_STORE = 'static_manifests';
export const BOOKS_STORE = 'books'; // Legacy

/**
 * Covers arrive in bursts (a paint) and then not at all. Holding the
 * connection across a burst is the whole point; holding it forever would
 * keep a handle open in an otherwise idle service worker.
 */
const IDLE_CLOSE_MS = 30_000;

let dbPromise: Promise<IDBPDatabase> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

function cancelIdleClose(): void {
  if (idleTimer !== null) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
}

/** Drop `promise` as the shared connection, if it still is the shared one. */
function forgetConnection(promise: Promise<IDBPDatabase>): void {
  if (dbPromise !== promise) return;
  dbPromise = null;
  // The armed timer belongs to the connection being dropped; nothing may
  // inherit it.
  cancelIdleClose();
}

/**
 * Close the shared cover connection (if any) and cancel the idle timer.
 * Idempotent; safe to call while an open is still in flight.
 */
export async function closeCoverConnection(): Promise<void> {
  cancelIdleClose();
  const promise = dbPromise;
  dbPromise = null;
  if (!promise) return;
  try {
    (await promise).close();
  } catch {
    // The open itself failed — nothing to close.
  }
}

/**
 * Arm the idle close for `connection` — the connection the finished request
 * actually used. A request that outlived its connection (its promise is no
 * longer the shared one) arms nothing, and a timer that does fire re-checks
 * the binding, so a successor connection is never closed out from under live
 * requests.
 */
function scheduleIdleClose(connection: Promise<IDBPDatabase>): void {
  cancelIdleClose();
  if (dbPromise !== connection) return;
  idleTimer = setTimeout(() => {
    idleTimer = null;
    if (dbPromise !== connection) return;
    void closeCoverConnection();
  }, IDLE_CLOSE_MS);
}

function getCoverConnection(): Promise<IDBPDatabase> {
  // A new request begins: whatever idle close was armed for the burst before
  // it must not fire while this one is in flight.
  cancelIdleClose();
  if (!dbPromise) {
    const promise: Promise<IDBPDatabase> = openDB(DB_NAME, undefined, {
      // Never block another context's upgrade behind a cover read.
      blocking() {
        void closeCoverConnection();
      },
      terminated() {
        forgetConnection(promise);
      },
    }).catch((error) => {
      // Never cache a failed open (connection.ts's reset-on-failure).
      forgetConnection(promise);
      throw error;
    });
    dbPromise = promise;
  }
  return dbPromise;
}

export async function getCoverFromDB(bookId: string): Promise<Blob | ArrayBuffer | undefined> {
  const connection = getCoverConnection();
  const db = await connection;

  try {
    // V18 Architecture
    if (db.objectStoreNames.contains(STATIC_MANIFESTS_STORE)) {
        const manifest = await db.get(STATIC_MANIFESTS_STORE, bookId);
        return manifest?.coverBlob;
    }

    // Legacy Architecture (Fallback)
    if (db.objectStoreNames.contains(BOOKS_STORE)) {
        const book = await db.get(BOOKS_STORE, bookId);
        return book?.coverBlob;
    }

    return undefined;
  } finally {
      scheduleIdleClose(connection);
  }
}

/**
 * Bytes inspected to recognize a cover's format — the longest signature below
 * (`RIFF....WEBP`).
 */
const COVER_SNIFF_BYTES = 12;

/**
 * The cover's real content type, read from its leading bytes.
 *
 * Covers reach this route with no type of their own: ingest normalizes
 * Blob → ArrayBuffer (WebKit's IDB structured clone cannot hold a Blob) and a
 * restore decodes them straight out of base64, and BOTH drop the MIME type —
 * so the fallback below is what every current-format row is actually served
 * with. It used to be a flat `image/webp`, on the grounds that the import path
 * compresses thumbnails to webp; but `imageCompression` failures keep the
 * ORIGINAL cover bytes (`thumbnailBlob = coverBlob` in
 * domains/library/import/extract.ts), so a cover is just as legitimately jpeg,
 * png or gif. Asking the bytes costs 12 of them and is never wrong.
 *
 * Practically inert for `<img>`, which sniffs the payload regardless — but the
 * header is not inert everywhere: this response carries a one-year
 * `Cache-Control`, so a wrong type is what the HTTP cache (and anything doing
 * `(await fetch(coverUrl(id))).blob().type`) sees for a year.
 *
 * Returns undefined for anything that is not one of the four raster formats a
 * cover can be; the caller then says so honestly rather than inventing one.
 */
function sniffCoverType(head: Uint8Array): string | undefined {
  const at = (offset: number, ...expected: number[]) =>
    expected.every((byte, i) => head[offset + i] === byte);

  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif'; // GIF87a / GIF89a
  // RIFF <4-byte size> WEBP
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return undefined;
}

export async function createCoverResponse(bookId: string): Promise<Response> {
  try {
    const coverData = await getCoverFromDB(bookId);

    if (coverData) {
      const blob = coverData instanceof Blob ? coverData : new Blob([coverData as ArrayBuffer]);
      // A legacy row that still holds a real Blob carries its own type; every
      // other lane lost it, so sniff (see sniffCoverType). Unknown bytes are
      // served as opaque rather than mislabelled as an image format.
      const contentType = blob.type
        || sniffCoverType(new Uint8Array(await blob.slice(0, COVER_SNIFF_BYTES).arrayBuffer()))
        || 'application/octet-stream';

      return new Response(blob, {
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000', // Long cache
        },
      });
    }

    return new Response('Cover not found', { status: 404 });
  } catch {
    return new Response('Internal Server Error', { status: 500 });
  }
}
