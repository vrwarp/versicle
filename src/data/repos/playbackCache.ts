/**
 * `cache_session_state` repository — the TTS playback session mirror
 * (Phase 3, D5.2 in plan/overhaul/prep/phase3-storage-gateway.md; the
 * WebKit-hang-safe block carved VERBATIM from src/db/DBService.ts — this
 * is an explicitly protected keeper, the product of a multi-week WebKit
 * IndexedDB investigation; see verification/_idb_probe.js).
 *
 * Worker-safe: the TTS engine worker imports this module (via
 * PlaybackStateManager/AudioPlayerService). It must never import stores,
 * sync services, React, or zustand.
 *
 * KNOWN GAPS deliberately deferred to P5b (the SessionStore port / single
 * session-owner fix of the C4 decomposition — engine surgery, not storage
 * motion):
 *  - P13a: a cold-start `savePauseTime` seeds the mirror from disk, but a
 *    cold-start `saveQueue` constructs a fresh record and can clobber a
 *    persisted `lastPauseTime` from a previous session.
 *  - Dual mirror: the worker and the main thread each hold their own
 *    `sessionCache` instance. The navigator.locks write gate removes the
 *    cross-context HANG hazard; single ownership lands with P5b.
 */
import { getConnection } from '../connection';
import { runExclusiveIdbWrite } from '../write-gate';
import { handleDbError } from '../errors';
import type { CacheSessionStateRow } from '../rows/cache';
import type { TTSQueueItem } from '~types/tts';

class PlaybackCacheRepo {
  // ── cache_session_state persistence (WebKit-hang-safe) ─────────────────────
  // WebKit's IndexedDB hangs on two patterns we hit during TTS, each leaving a lone
  // cache_session_state readwrite transaction outstanding for 5–15s (proven with
  // verification/_idb_probe.js) — which wedges the connection and, through it, the
  // single-chain TTS task sequencer (play/pause never settle):
  //   1. concurrent readwrite transactions on the same store, and
  //   2. a readwrite transaction with an intra-transaction await — read-modify-write
  //      (`await store.get()` then `await store.put()`). The transaction can go inactive
  //      across the await and never fire 'complete'.
  // Mitigation: keep an in-memory mirror of each book's record, serialise every write
  // through one chain (no concurrency), and write with a single synchronous put() and no
  // await before it (no intra-transaction read).
  private sessionWriteChain: Promise<void> = Promise.resolve();
  private sessionCache = new Map<string, CacheSessionStateRow>();

  private enqueueSessionWrite(work: () => Promise<void>): Promise<void> {
    const next = this.sessionWriteChain.then(work, work);
    // Keep the chain alive even if an individual write rejects.
    this.sessionWriteChain = next.then(() => {}, () => {});
    return next;
  }

  /** Resolve a book's session record, seeding the in-memory mirror from disk once. */
  private async loadSession(bookId: string): Promise<CacheSessionStateRow> {
    const cached = this.sessionCache.get(bookId);
    if (cached) return cached;
    let session: CacheSessionStateRow | undefined;
    try {
      const db = await getConnection();
      session = await db.get('cache_session_state', bookId);
    } catch (error) {
      handleDbError(error);
    }
    // A concurrent caller may have populated the mirror while we awaited the read.
    const current = this.sessionCache.get(bookId);
    if (current) return current;
    const resolved = session || { bookId, playbackQueue: [], updatedAt: Date.now() };
    this.sessionCache.set(bookId, resolved);
    return resolved;
  }

  /** Serialised, hang-safe write of a book's mirrored record (single synchronous put). */
  private writeSession(bookId: string): Promise<void> {
    return this.enqueueSessionWrite(async () => {
      const session = this.sessionCache.get(bookId);
      if (!session) return;
      // Snapshot now so a later in-memory mutation can't change the object mid-commit.
      const snapshot = { ...session };
      try {
        const db = await getConnection();
        // Serialised through the shared IDB write gate so this cache_session_state readwrite
        // transaction never overlaps a Yjs `updates` write — concurrent readwrite txns hang
        // WebKit (see src/data/write-gate.ts).
        await runExclusiveIdbWrite(async () => {
          const tx = db.transaction('cache_session_state', 'readwrite');
          // Single synchronous put, no await before it — the WebKit-hang-safe shape.
          tx.objectStore('cache_session_state').put(snapshot);
          await tx.done;
        });
      } catch (error) {
        handleDbError(error);
      }
    });
  }

  // Debounced, coalesced disk persistence for cache_session_state. The in-memory mirror is
  // the source of truth during a session, so disk writes (which only matter for
  // cross-session resume) can be batched. Coalescing also minimises how often a
  // cache_session_state readwrite txn is in flight: WebKit can still intermittently hang
  // even a single clean put(), and a hung txn wedges the whole connection (and the TTS
  // sequencer behind it) — so fewer writes means fewer chances to wedge during the
  // play/pause window. (The window is shorter than the 1s the queue write already used, so
  // cross-session resume is no more delayed than before.)
  private sessionDirty = new Set<string>();
  private sessionFlushTimer: ReturnType<typeof setTimeout> | null = null;

  private scheduleSessionWrite(bookId: string): void {
    this.sessionDirty.add(bookId);
    if (this.sessionFlushTimer) return;
    this.sessionFlushTimer = setTimeout(() => {
      this.sessionFlushTimer = null;
      const books = [...this.sessionDirty];
      this.sessionDirty.clear();
      for (const id of books) void this.writeSession(id);
    }, 500);
  }

  // ── Public surface (D5.2) ──────────────────────────────────────────────────

  /**
   * Read a book's persisted session row, seeding the in-memory mirror so
   * later writes never need an intra-transaction read (getTTSState's seed).
   */
  async getSession(bookId: string): Promise<CacheSessionStateRow | undefined> {
    try {
      const db = await getConnection();
      const session = await db.get('cache_session_state', bookId);
      if (session) {
        this.sessionCache.set(bookId, session);
      }
      return session;
    } catch (error) {
      handleDbError(error);
    }
  }

  /** Mirror-update + debounced disk write of the playback queue (saveTTSState). */
  saveQueue(bookId: string, queue: TTSQueueItem[]): void {
    // Update the in-memory mirror (preserving lastPauseTime), then debounce the disk write.
    const session = this.sessionCache.get(bookId) || { bookId, playbackQueue: [], updatedAt: Date.now() };
    session.playbackQueue = queue;
    session.updatedAt = Date.now();
    this.sessionCache.set(bookId, session);
    this.scheduleSessionWrite(bookId);
  }

  /**
   * Persist the last pause timestamp (updatePlaybackState). `null` clears it.
   * Seeds the mirror from disk on first touch so the write cannot clobber a
   * persisted queue.
   */
  async savePauseTime(bookId: string, lastPauseTime: number | null): Promise<void> {
    const session = await this.loadSession(bookId);
    session.lastPauseTime = lastPauseTime === null ? undefined : lastPauseTime;
    session.updatedAt = Date.now();
    this.scheduleSessionWrite(bookId);
  }

  /**
   * Deterministically flush the debounced cache_session_state writes NOW
   * instead of waiting out the 500ms timer. Used by the E2E test API
   * (`window.__versicleTest.flushPersistence()`) so tests can await
   * persistence instead of sleeping past the debounce window; safe for any
   * caller because writeSession is serialised through the shared exclusive
   * IDB write lock like every other session write.
   */
  async flushPending(): Promise<void> {
    if (this.sessionFlushTimer) {
      clearTimeout(this.sessionFlushTimer);
      this.sessionFlushTimer = null;
    }
    const books = [...this.sessionDirty];
    this.sessionDirty.clear();
    await Promise.all(books.map((id) => this.writeSession(id)));
  }

  /**
   * Cancel any pending (debounced) session write WITHOUT flushing (cleanup).
   * Runs at teardown/wipe: the in-memory mirror still holds the latest state,
   * and writing during teardown can race a closing DB connection — so drop
   * the pending write rather than flush it (the wipe path depends on
   * drop-not-flush, src/db/wipe.ts).
   */
  dropPending(): void {
    if (this.sessionFlushTimer) {
      clearTimeout(this.sessionFlushTimer);
      this.sessionFlushTimer = null;
    }
    this.sessionDirty.clear();
  }
}

/** Singleton — the in-memory session mirror is per-JS-context state. */
export const playbackCache = new PlaybackCacheRepo();
