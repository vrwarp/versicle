import { getDB } from './db';
import type {
  SectionMetadata,
  TableImage,
  BookLocations,
  CacheTtsPreparation,
  CacheSessionState,
  TTSState,
  StaticBookManifest,
  StaticStructure,
  NavigationItem,
  CacheAudioBlob
} from '~types/db';
import type { Timepoint } from '@lib/tts/providers/types';
import { DatabaseError, StorageFullError } from '~types/errors';
import type { BookExtractionData } from '@lib/ingestion';
import { createLogger } from '@lib/logger';
import type { TTSQueueItem } from '@lib/tts/AudioPlayerService';
import { runExclusiveIdbWrite } from '@lib/idb-write-lock';

const logger = createLogger('DBService');

/**
 * Map a raw failure to the typed database errors. Shared with the services that layer on
 * top of DBService (e.g. BookImportService) so error semantics stay identical across the split.
 */
export function handleDbError(error: unknown): never {
  logger.error('Database operation failed', error);

  if (error instanceof DatabaseError) {
    throw error;
  }

  if (error instanceof Error) {
    if (error.name === 'QuotaExceededError') {
      throw new StorageFullError(error);
    }
  }
  // Check if it's a DOMException with code 22 (QuotaExceededError legacy)
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    throw new StorageFullError(error);
  }

  throw new DatabaseError('An unexpected database error occurred', error);
}

/**
 * The raw IndexedDB rows describing one book's static data. Consumed by BookRepository,
 * which merges in the yjs-backed user inventory to produce a BookMetadata.
 */
export interface ManifestBundle {
  manifest: StaticBookManifest;
  structure: StaticStructure | undefined;
  /** Whether the binary EPUB resource is present locally (false ⇒ offloaded). */
  hasResource: boolean;
}

/**
 * Pure-IndexedDB data layer. This module is worker-safe: it must not import the yjs-backed
 * Zustand stores (book inventory, content analysis, annotations) or the EPUB ingestion
 * pipeline — the TTS engine worker imports it for IndexedDB reads/writes. Inventory merging
 * lives in BookRepository; book import lives in BookImportService.
 */
class DBService {
  private async getDB() {
    return getDB();
  }

  private handleError(error: unknown): never {
    handleDbError(error);
  }

  // --- Book Operations ---

  /**
   * Retrieves the raw static rows for multiple books in a single transaction.
   * Optimized for bulk hydration by querying specifically requested IDs within one transaction.
   * Preserves the exact index mapping of the input array.
   */
  async getManifestBundleBulk(ids: string[]): Promise<(ManifestBundle | undefined)[]> {
    try {
      if (ids.length === 0) return [];
      const db = await this.getDB();
      const tx = db.transaction(['static_manifests', 'static_resources', 'static_structure'], 'readonly');

      const manifestStore = tx.objectStore('static_manifests');
      const resourceStore = tx.objectStore('static_resources');
      const structureStore = tx.objectStore('static_structure');

      // BOLT OPTIMIZATION: Avoid getAll() on large arrays across IDB bridge to prevent serialization OOMs
      // and use count() instead of getKey() to avoid fetching the key value itself.
      const manifestsPromise = Promise.all(ids.map(id => manifestStore.get(id)));
      const resourceCountPromise = Promise.all(ids.map(id => resourceStore.count(id)));
      const structuresPromise = Promise.all(ids.map(id => structureStore.get(id)));

      const [manifests, resourceCounts, structures] = await Promise.all([manifestsPromise, resourceCountPromise, structuresPromise]);

      await tx.done;

      const manifestsMap = new Map<string, ManifestBundle>();
      manifests.forEach((m, i) => {
          if (m) {
             manifestsMap.set(m.bookId, { manifest: m, structure: structures[i], hasResource: resourceCounts[i] > 0 });
          }
      });

      // Map results back preserving index and handling missing records
      return ids.map((id) => manifestsMap.get(id));
    } catch (error) {
      this.handleError(error);
    }
    return ids.map(() => undefined);
  }

  /**
   * Retrieves the raw static rows for a specific book.
   * Inventory merging (yjs) happens in BookRepository.
   */
  async getManifestBundle(id: string): Promise<ManifestBundle | undefined> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['static_manifests', 'static_resources', 'static_structure'], 'readonly');

      const manifest = await tx.objectStore('static_manifests').get(id);
      const resourceKey = await tx.objectStore('static_resources').getKey(id);
      const structure = await tx.objectStore('static_structure').get(id);

      await tx.done;

      if (!manifest) {
        return undefined;
      }

      return { manifest, structure, hasResource: !!resourceKey };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Updates only the metadata for a specific book.
   */
  // Deprecated: updateBookMetadata removed. Use useBookStore/useReadingStateStore.

  /**
   * Retrieves the file content for a specific book.
   */
  async getBookFile(id: string): Promise<Blob | ArrayBuffer | undefined> {
    try {
      const db = await this.getDB();
      const res = await db.get('static_resources', id);
      return res?.epubBlob;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves all sections for a book.
   */
  async getSections(bookId: string): Promise<SectionMetadata[]> {
    try {
      const db = await this.getDB();
      const structure = await db.get('static_structure', bookId);
      if (!structure) return [];

      return structure.spineItems.map(item => ({
        id: `${bookId}-${item.id}`,
        bookId: bookId,
        sectionId: item.id,
        characterCount: item.characterCount,
        playOrder: item.index
      })).sort((a, b) => a.playOrder - b.playOrder);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Ingests extracted book data into the database (Phase 2: Static Only).
   * Only writes to static_*, cache_*, and minimal legacy stores.
   * Does NOT write user_inventory - caller (Yjs store action) handles that.
   */
  async ingestBook(data: BookExtractionData, mode: 'add' | 'overwrite' = 'add'): Promise<void> {
    try {
      // Pre-convert Blobs to ArrayBuffers before the transaction.
      // WebKit's IDB structured clone does not support Blob objects; ArrayBuffer is required.
      const coverBlob = data.manifest.coverBlob;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const manifestToStore: any = {
        ...data.manifest,
        coverBlob: coverBlob instanceof Blob ? await coverBlob.arrayBuffer() : coverBlob,
      };

      const epubBlob = data.resource.epubBlob;
      const resourceToStore = {
        ...data.resource,
        epubBlob: epubBlob instanceof Blob ? await epubBlob.arrayBuffer() : epubBlob,
      };

      const tablesToStore = await Promise.all(
        data.tableBatches.map(async (table) => {
          const imageBlob = table.imageBlob;
          return {
            ...table,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            imageBlob: imageBlob instanceof Blob ? await imageBlob.arrayBuffer() : imageBlob as any,
          };
        })
      );

      const db = await this.getDB();
      const tx = db.transaction([
        'static_manifests', 'static_resources', 'static_structure',
        'cache_tts_preparation', 'cache_table_images'
      ], 'readwrite');

      const manifestStore = tx.objectStore('static_manifests');
      const resourceStore = tx.objectStore('static_resources');
      const structureStore = tx.objectStore('static_structure');

      if (mode === 'overwrite') {
        await manifestStore.put(manifestToStore);
        await resourceStore.put(resourceToStore);
        await structureStore.put(data.structure);
      } else {
        await manifestStore.add(manifestToStore);
        await resourceStore.add(resourceToStore);
        await structureStore.add(data.structure);
      }

      // User data (overrides, progress, inventory) is now handled by Yjs stores exclusively.

      const ttsStore = tx.objectStore('cache_tts_preparation');
      const ttsPromises = data.ttsContentBatches.map(batch =>
        mode === 'overwrite' ? ttsStore.put(batch) : ttsStore.add(batch)
      );
      await Promise.all(ttsPromises);

      const tableStore = tx.objectStore('cache_table_images');
      const tablePromises = tablesToStore.map(table => {
        return mode === 'overwrite' ? tableStore.put(table) : tableStore.add(table);
      });
      await Promise.all(tablePromises);

      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves the full static structure (TOC, Spine) for a book.
   */
  async getBookStructure(bookId: string): Promise<StaticStructure | undefined> {
    try {
      const db = await this.getDB();
      return await db.get('static_structure', bookId);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Updates the static structure (TOC) for a book.
   * Used by Smart TOC enhancement.
   */
  async updateBookStructure(bookId: string, toc: NavigationItem[]): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('static_structure', 'readwrite');
      const store = tx.objectStore('static_structure');

      const structure = await store.get(bookId);
      if (!structure) {
        throw new DatabaseError(`Book structure not found for ${bookId}`);
      }

      structure.toc = toc;
      await store.put(structure);

      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Deletes a book's static and cache rows. Yjs cleanup (content analysis, inventory)
   * is orchestrated by BookRepository.deleteBook.
   */
  async deleteBook(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      // Delete from static and cache stores only
      // User data stores are managed by Yjs and cleared via their respective stores
      const tx = db.transaction([
        'static_manifests', 'static_resources', 'static_structure',
        'cache_render_metrics', 'cache_session_state', 'cache_tts_preparation',
        'cache_table_images'
      ], 'readwrite');

      await Promise.all([
        tx.objectStore('static_manifests').delete(id),
        tx.objectStore('static_resources').delete(id),
        tx.objectStore('static_structure').delete(id),
        tx.objectStore('cache_render_metrics').delete(id),
        tx.objectStore('cache_session_state').delete(id),
      ]);

      logger.debug(`deleteBook: keys deleted for ${id}`);

      // Delete from index-based cache stores
      const deleteFromIndex = async (storeName: 'cache_tts_preparation' | 'cache_table_images', indexName: string) => {
        const store = tx.objectStore(storeName);
        // @ts-expect-error - index() types are tricky with generic strings
        const index = store.index(indexName);
        const keys = await index.getAllKeys(IDBKeyRange.only(id));
        await Promise.all(keys.map(key => store.delete(key)));
      };

      await deleteFromIndex('cache_tts_preparation', 'by_bookId');
      await deleteFromIndex('cache_table_images', 'by_bookId');

      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Offloads a book's file content.
   */
  async offloadBook(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['static_resources', 'static_manifests'], 'readwrite');

      const resStore = tx.objectStore('static_resources');
      // Delete the record entire to signal offloading (so getKey returns undefined)
      await resStore.delete(id);

      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Writes a restored book's binary content. Fingerprint verification (which needs the
   * ingestion pipeline) happens in BookImportService.restoreBook before this is called.
   * Stores the file as ArrayBuffer (WebKit IDB does not support Blob structured clone).
   */
  async restoreBookResource(id: string, epubArrayBuffer: ArrayBuffer): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['static_resources'], 'readwrite');
      const store = tx.objectStore('static_resources');
      const resource = await store.get(id) || { bookId: id, epubBlob: epubArrayBuffer };
      resource.epubBlob = epubArrayBuffer;
      await store.put(resource);
      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Returns a Map of bookId -> isOffloaded status for the requested book IDs.
   * If bookIds is empty, returns status for all books.
   */
  async getOffloadedStatus(bookIds?: string[]): Promise<Map<string, boolean>> {
    try {
      const db = await this.getDB();
      const result = new Map<string, boolean>();

      // If specific IDs requested
      if (bookIds && bookIds.length > 0) {
        const tx = db.transaction('static_resources', 'readonly');
        const store = tx.objectStore('static_resources');

        // BOLT OPTIMIZATION: Avoid getAllKeys() across IDB boundary. Map to count() promises instead.
        const promises = bookIds.map(async (id) => {
            const count = await store.count(id);
            const exists = count > 0;
            logger.debug(`getOffloadedStatus: ${id} exists in static_resources? ${exists}`);
            result.set(id, !exists);
        });
        await Promise.all(promises);
        await tx.done;
      } else {
        // Return for all resources (inverse: if in set, not offloaded)
        // Ideally we need the list of ALL books to know which are offloaded (missing from set)
        // So we get all inventory keys
        // const inventoryKeys = await db.getAllKeys('user_inventory'); // Migrated? No, inventory is in Yjs.
        // We can just return the set of PRESENT resources, and let the caller infer.
        // Actually, better to just return the Set of available Resource IDs.
        // But to match the signature, let's Stick to checking specific IDs if provided,
        // or just return a helper to check existence.
      }
      return result;
    } catch (error) {
      this.handleError(error);
    }
    return new Map();
  }

  /**
   * Returns a Set of all book IDs that have binary content locally (NOT offloaded).
   */
  async getAvailableResourceIds(): Promise<Set<string>> {
    try {
      const db = await this.getDB();
      const keys = await db.getAllKeys('static_resources');
      return new Set(keys as string[]);
    } catch (error) {
      this.handleError(error);
    }
    return new Set();
  }



  // --- Playback State ---

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
  private sessionCache = new Map<string, CacheSessionState>();

  private enqueueSessionWrite(work: () => Promise<void>): Promise<void> {
    const next = this.sessionWriteChain.then(work, work);
    // Keep the chain alive even if an individual write rejects.
    this.sessionWriteChain = next.then(() => {}, () => {});
    return next;
  }

  /** Resolve a book's session record, seeding the in-memory mirror from disk once. */
  private async loadSession(bookId: string): Promise<CacheSessionState> {
    const cached = this.sessionCache.get(bookId);
    if (cached) return cached;
    let session: CacheSessionState | undefined;
    try {
      const db = await this.getDB();
      session = await db.get('cache_session_state', bookId);
    } catch (error) {
      this.handleError(error);
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
        const db = await this.getDB();
        // Serialised through the shared IDB write lock so this cache_session_state readwrite
        // transaction never overlaps a Yjs `updates` write — concurrent readwrite txns hang
        // WebKit (see src/lib/idb-write-lock.ts).
        await runExclusiveIdbWrite(async () => {
          const tx = db.transaction('cache_session_state', 'readwrite');
          // Single synchronous put, no await before it — the WebKit-hang-safe shape.
          tx.objectStore('cache_session_state').put(snapshot);
          await tx.done;
        });
      } catch (error) {
        this.handleError(error);
      }
    });
  }

  async updatePlaybackState(bookId: string, _lastPlayedCfi?: string, lastPauseTime?: number | null): Promise<void> {
    // CFI is no longer persisted here; only lastPauseTime is written.
    if (lastPauseTime === undefined) return;
    const session = await this.loadSession(bookId);
    session.lastPauseTime = lastPauseTime === null ? undefined : lastPauseTime;
    session.updatedAt = Date.now();
    this.scheduleSessionWrite(bookId);
  }

  // --- TTS State Operations ---

  saveTTSState(bookId: string, queue: TTSQueueItem[]): void {
    // Update the in-memory mirror (preserving lastPauseTime), then debounce the disk write.
    const session = this.sessionCache.get(bookId) || { bookId, playbackQueue: [], updatedAt: Date.now() };
    session.playbackQueue = queue;
    session.updatedAt = Date.now();
    this.sessionCache.set(bookId, session);
    this.scheduleSessionWrite(bookId);
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

  /**
   * Deterministically flush the debounced cache_session_state writes NOW
   * instead of waiting out the 500ms timer. Used by the E2E test API
   * (`window.__versicleTest.flushPersistence()`) so tests can await
   * persistence instead of sleeping past the debounce window; safe for any
   * caller because writeSession is serialised through the shared exclusive
   * IDB write lock like every other session write.
   */
  async flushSessionWrites(): Promise<void> {
    if (this.sessionFlushTimer) {
      clearTimeout(this.sessionFlushTimer);
      this.sessionFlushTimer = null;
    }
    const books = [...this.sessionDirty];
    this.sessionDirty.clear();
    await Promise.all(books.map((id) => this.writeSession(id)));
  }

  async getTTSState(bookId: string): Promise<TTSState | undefined> {
    try {
      const db = await this.getDB();
      const session = await db.get('cache_session_state', bookId);

      if (session) {
        // Seed the in-memory mirror so later writes never need an intra-transaction read.
        this.sessionCache.set(bookId, session);
        return {
          bookId,
          queue: session.playbackQueue,
          updatedAt: session.updatedAt
        };
      }
      return undefined;
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- TTS Cache Operations ---

  async getCachedSegment(key: string): Promise<CacheAudioBlob | undefined> {
    try {
      const db = await this.getDB();
      const segment = await db.get('cache_audio_blobs', key);
      if (segment) {
        db.put('cache_audio_blobs', { ...segment, lastAccessed: Date.now() }).catch(() => { });
        // Read-shim: rows written by older builds stored alignment under
        // `alignmentData`. Normalize them onto the canonical `alignment` field so
        // cached cloud-TTS timepoints are never silently dropped on a cache hit.
        if (!segment.alignment && segment.alignmentData) {
          return { ...segment, alignment: segment.alignmentData };
        }
      }
      return segment;
    } catch (error) {
      this.handleError(error);
    }
  }

  async cacheSegment(key: string, audio: ArrayBuffer, alignment?: Timepoint[]): Promise<void> {
    try {
      const db = await this.getDB();
      await db.put('cache_audio_blobs', {
        key,
        audio,
        alignment,
        createdAt: Date.now(),
        lastAccessed: Date.now(),
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- Locations ---

  async getLocations(bookId: string): Promise<BookLocations | undefined> {
    try {
      const db = await this.getDB();
      const metrics = await db.get('cache_render_metrics', bookId);
      return metrics ? { bookId, locations: metrics.locations } : undefined;
    } catch (error) {
      this.handleError(error);
    }
  }

  async saveLocations(bookId: string, locations: string): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('cache_render_metrics', 'readwrite');
      const store = tx.objectStore('cache_render_metrics');
      const metrics = await store.get(bookId) || { bookId, locations: '' };
      metrics.locations = locations;
      await store.put(metrics);
      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }



  // --- Table Images ---

  async getTableImages(bookId: string): Promise<TableImage[]> {
    try {
      const db = await this.getDB();
      const rows = await db.getAllFromIndex('cache_table_images', 'by_bookId', bookId);
      return rows.map(row => {
        // imageBlob may be ArrayBuffer at runtime (stored as ArrayBuffer for WebKit IDB compatibility)
        const rawImageBlob = row.imageBlob as unknown as Blob | ArrayBuffer;
        return {
          ...row,
          imageBlob: rawImageBlob instanceof ArrayBuffer ? new Blob([rawImageBlob]) : rawImageBlob,
        };
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- Cleanup ---

  cleanup(): void {
    // Cancel any pending (debounced) session write. cleanup() runs at teardown; the
    // in-memory mirror still holds the latest state, and writing during teardown can race
    // a closing DB connection — so drop the pending write rather than flush it.
    if (this.sessionFlushTimer) {
      clearTimeout(this.sessionFlushTimer);
      this.sessionFlushTimer = null;
    }
    this.sessionDirty.clear();
  }

  // --- TTS Content Operations (For Migration/Caching) ---

  async saveTTSContent(content: CacheTtsPreparation): Promise<void> {
    try {
      const db = await this.getDB();
      await db.put('cache_tts_preparation', content);
    } catch (error) {
      this.handleError(error);
    }
  }

  async getTTSContent(bookId: string, sectionId: string): Promise<CacheTtsPreparation | undefined> {
    try {
      const db = await this.getDB();
      // Using composite key logic
      const id = `${bookId}-${sectionId}`;
      return await db.get('cache_tts_preparation', id);
    } catch (error) {
      this.handleError(error);
    }
  }



}

// Singleton export
export const dbService = new DBService();
