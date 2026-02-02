import { getDB } from './db';
import type {
  BookMetadata,
  ReadingEventType,
  SectionMetadata,
  TableImage,
  BookLocations,
  Annotation,
  CacheTtsPreparation,
  CacheSessionState,
  TTSState,
  ContentAnalysis,
  StaticBookManifest,
  StaticStructure,
  NavigationItem,
  CachedSegment,
  ReadingSession
} from '../types/db';
import type { Timepoint } from '../lib/tts/providers/types';
import type { ContentType } from '../types/content-analysis';
import { DatabaseError, StorageFullError } from '../types/errors';
import { extractBookData, type BookExtractionData, generateFileFingerprint } from '../lib/ingestion';
import { useContentAnalysisStore } from '../store/useContentAnalysisStore';
import { useBookStore } from '../store/useBookStore';
import { useAnnotationStore } from '../store/useAnnotationStore';

import { createLogger } from '../lib/logger';

import type { TTSQueueItem } from '../lib/tts/AudioPlayerService';
import type { ExtractionOptions } from '../lib/tts';

const logger = createLogger('DBService');

class DBService {
  private async getDB() {
    return getDB();
  }

  private handleError(error: unknown): never {
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

  // --- Book Operations ---

  /**
   * Retrieves all books in the library.
   * JOINS: static_manifests, user_inventory, user_progress
   */


  /**
   * Retrieves a specific book and its file content.
   */


  /**
   * Retrieves only the metadata for a specific book.
   * Post-Yjs migration: user_inventory is in Yjs (useBookStore), not IndexedDB.
   */
  async getBookMetadata(id: string): Promise<BookMetadata | undefined> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['static_manifests', 'static_resources'], 'readonly');

      const manifest = await tx.objectStore('static_manifests').get(id);
      const resourceKey = await tx.objectStore('static_resources').getKey(id);

      await tx.done;

      if (!manifest) {
        return undefined;
      }

      // Get inventory from Yjs store (primary source)
      const inventory = useBookStore.getState().books[id];

      return {
        id: manifest.bookId,
        title: inventory?.customTitle || inventory?.title || manifest.title,
        author: inventory?.customAuthor || inventory?.author || manifest.author,
        description: manifest.description,
        coverBlob: manifest.coverBlob,
        addedAt: inventory?.addedAt || Date.now(),

        bookId: manifest.bookId,
        filename: inventory?.sourceFilename || 'unknown.epub',
        fileHash: manifest.fileHash,
        fileSize: manifest.fileSize,
        totalChars: manifest.totalChars,
        version: manifest.schemaVersion,

        isOffloaded: !resourceKey
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves the book ID associated with a given filename.
   * Uses Yjs store (useBookStore) instead of IDB.
   */
  getBookIdByFilename(filename: string): string | undefined {
    const books = useBookStore.getState().books;
    for (const book of Object.values(books)) {
      if (book.sourceFilename === filename) {
        return book.bookId;
      }
    }
    return undefined;
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
   * Adds a new book to the library (Phase 2: Pure Ingestion).
   * Returns the StaticBookManifest for the caller to create UserInventoryItem.
   * Only writes to static_* and cache_* stores. Does NOT write user_inventory.
   */
  async addBook(
    file: File,
    ttsOptions?: ExtractionOptions,
    onProgress?: (progress: number, message: string) => void
  ): Promise<StaticBookManifest> {
    try {
      const data = await extractBookData(file, ttsOptions, onProgress);
      await this.ingestBook(data);
      return data.manifest;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Imports a book with a specific book ID.
   * Used for restoring synced books where the inventory already exists via Yjs
   * but the local static data (manifest, resources, structure) doesn't exist.
   * 
   * This extracts the book, overrides all bookId references with the specified ID,
   * then ingests the data.
   */
  async importBookWithId(
    bookId: string,
    file: File,
    ttsOptions?: ExtractionOptions,
    onProgress?: (progress: number, message: string) => void
  ): Promise<StaticBookManifest> {
    try {
      const data = await extractBookData(file, ttsOptions, onProgress);

      // Override all bookId references with the specified ID
      const originalBookId = data.bookId;

      data.bookId = bookId;
      data.manifest.bookId = bookId;
      data.resource.bookId = bookId;
      data.structure.bookId = bookId;
      data.inventory.bookId = bookId;
      data.progress.bookId = bookId;
      data.overrides.bookId = bookId;

      // Update section IDs that include the bookId
      data.structure.spineItems = data.structure.spineItems.map(item => ({
        ...item,
        id: item.id.replace(originalBookId, bookId)
      }));

      // Update TTS batch IDs
      data.ttsContentBatches = data.ttsContentBatches.map(batch => ({
        ...batch,
        id: batch.id.replace(originalBookId, bookId),
        bookId
      }));

      // Update table batch IDs
      data.tableBatches = data.tableBatches.map(table => ({
        ...table,
        id: table.id.replace(originalBookId, bookId),
        bookId
      }));

      await this.ingestBook(data, 'overwrite');
      return data.manifest;
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
      const db = await this.getDB();
      const tx = db.transaction([
        'static_manifests', 'static_resources', 'static_structure',
        'cache_tts_preparation', 'cache_table_images'
      ], 'readwrite');

      const manifestStore = tx.objectStore('static_manifests');
      const resourceStore = tx.objectStore('static_resources');
      const structureStore = tx.objectStore('static_structure');

      if (mode === 'overwrite') {
        await manifestStore.put(data.manifest);
        await resourceStore.put(data.resource);
        await structureStore.put(data.structure);
      } else {
        await manifestStore.add(data.manifest);
        await resourceStore.add(data.resource);
        await structureStore.add(data.structure);
      }

      // User data (overrides, progress, inventory) is now handled by Yjs stores exclusively.

      const ttsStore = tx.objectStore('cache_tts_preparation');
      for (const batch of data.ttsContentBatches) {
        if (mode === 'overwrite') {
          await ttsStore.put({
            id: batch.id,
            bookId: batch.bookId,
            sectionId: batch.sectionId,
            sentences: batch.sentences
          });
        } else {
          await ttsStore.add({
            id: batch.id,
            bookId: batch.bookId,
            sectionId: batch.sectionId,
            sentences: batch.sentences
          });
        }
      }

      const tableStore = tx.objectStore('cache_table_images');
      for (const table of data.tableBatches) {
        if (mode === 'overwrite') {
          await tableStore.put(table);
        } else {
          await tableStore.add(table);
        }
      }

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
   * Deletes a book and all associated data.
   */
  async deleteBook(id: string): Promise<void> {
    try {
      // Clean up Yjs content analysis for this book
      useContentAnalysisStore.getState().deleteBookAnalysis(id);

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
        let cursor = await index.openCursor(IDBKeyRange.only(id));
        while (cursor) {
          await cursor.delete();
          cursor = await cursor.continue();
        }
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
   * Restores an offloaded book.
   */
  async restoreBook(id: string, file: File): Promise<void> {
    try {
      const db = await this.getDB();

      const manifest = await db.get('static_manifests', id);
      if (!manifest) throw new Error('Book metadata not found');

      // Verify Hash
      const newFingerprint = await generateFileFingerprint(file, {
        title: manifest.title,
        author: manifest.author,
        filename: file.name
      });

      if (manifest.fileHash && manifest.fileHash !== newFingerprint) {
        throw new Error('File verification failed: Fingerprint mismatch.');
      }

      // Store File
      const tx = db.transaction(['static_resources'], 'readwrite');
      const store = tx.objectStore('static_resources');
      const resource = await store.get(id) || { bookId: id, epubBlob: file };
      resource.epubBlob = file;
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
      const resourceKeys = await db.getAllKeys('static_resources');
      const resourceSet = new Set(resourceKeys);
      const result = new Map<string, boolean>();

      // If specific IDs requested
      if (bookIds && bookIds.length > 0) {
        for (const id of bookIds) {
          const exists = resourceSet.has(id);
          logger.debug(`getOffloadedStatus: ${id} exists in static_resources? ${exists} (Keys: ${resourceKeys.length})`);
          result.set(id, !exists);
        }
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


  // --- Progress Operations ---
  // Deprecated: saveProgress removed. Use useReadingStateStore.

  // --- Reading List Operations (Legacy/Mapped) ---
  // Mapping UserInventory to ReadingListEntry for backward compatibility



  // --- Playback State ---

  async updatePlaybackState(bookId: string, _lastPlayedCfi?: string, lastPauseTime?: number | null): Promise<void> {
    try {
      const db = await this.getDB();
      // Only cache_session_state is updated now
      const tx = db.transaction(['cache_session_state'], 'readwrite');

      if (lastPauseTime !== undefined) {
        const sessionStore = tx.objectStore('cache_session_state');
        const session = await sessionStore.get(bookId) || { bookId, playbackQueue: [], updatedAt: Date.now() };
        session.lastPauseTime = lastPauseTime === null ? undefined : lastPauseTime;
        await sessionStore.put(session);
      }

      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- TTS State Operations ---

  private saveTTSStateTimeout: NodeJS.Timeout | null = null;
  private pendingTTSState: { [bookId: string]: CacheSessionState } = {};

  saveTTSState(bookId: string, queue: TTSQueueItem[]): void {
    this.pendingTTSState[bookId] = {
      bookId,
      playbackQueue: queue,
      updatedAt: Date.now()
    };

    if (this.saveTTSStateTimeout) return;

    this.saveTTSStateTimeout = setTimeout(async () => {
      this.saveTTSStateTimeout = null;
      const pending = { ...this.pendingTTSState };
      this.pendingTTSState = {};

      try {
        const db = await this.getDB();
        const tx = db.transaction('cache_session_state', 'readwrite');
        const store = tx.objectStore('cache_session_state');

        for (const state of Object.values(pending)) {
          await store.put(state);
        }
        await tx.done;
      } catch (error) {
        logger.error('Failed to save TTS state', error);
      }
    }, 1000);
  }

  async getTTSState(bookId: string): Promise<TTSState | undefined> {
    try {
      const db = await this.getDB();
      const session = await db.get('cache_session_state', bookId);

      if (session) {
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

  // --- Annotation Operations ---
  // Uses useAnnotationStore (Yjs) as primary source.

  getAnnotations(bookId: string): Annotation[] {
    const allAnnotations = useAnnotationStore.getState().annotations;
    return Object.values(allAnnotations).filter(ann => ann.bookId === bookId);
  }

  // --- TTS Cache Operations ---

  async getCachedSegment(key: string): Promise<CachedSegment | undefined> {
    try {
      const db = await this.getDB();
      const segment = await db.get('cache_audio_blobs', key);
      if (segment) {
        db.put('cache_audio_blobs', { ...segment, lastAccessed: Date.now() }).catch(() => { });
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
        alignmentData: alignment,
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



  // --- Content Analysis & Accessibility Operations ---
  // Uses useContentAnalysisStore (Yjs) as primary and only source.

  getContentAnalysis(bookId: string, sectionId: string): ContentAnalysis | undefined {
    const yjsAnalysis = useContentAnalysisStore.getState().getAnalysis(bookId, sectionId);
    if (!yjsAnalysis) return undefined;

    return {
      id: `${bookId}-${sectionId}`,
      bookId,
      sectionId,
      structure: { title: yjsAnalysis.title, footnoteMatches: [] },
      contentTypes: yjsAnalysis.semanticMap,
      tableAdaptations: yjsAnalysis.tableAdaptations,
      lastAnalyzed: yjsAnalysis.generatedAt
    };
  }

  saveContentClassifications(bookId: string, sectionId: string, results: { rootCfi: string; type: ContentType }[]): void {
    useContentAnalysisStore.getState().saveClassifications(bookId, sectionId, results);
  }

  clearContentAnalysis(): void {
    useContentAnalysisStore.getState().clearAll();
  }

  async getTableImages(bookId: string): Promise<TableImage[]> {
    try {
      const db = await this.getDB();
      return await db.getAllFromIndex('cache_table_images', 'by_bookId', bookId);
    } catch (error) {
      this.handleError(error);
    }
  }

  saveTableAdaptations(bookId: string, sectionId: string, adaptations: { rootCfi: string; text: string }[]): void {
    useContentAnalysisStore.getState().saveTableAdaptations(bookId, sectionId, adaptations);
  }

  // --- Reading History Operations ---



  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async updateReadingHistory(bookId: string, range: string, _type: ReadingEventType, _label?: string, _isCompletion: boolean = false): Promise<void> {
    // Phase 2 Cleanup: dedicated user_journey store is removed.
    // We now rely on completedRanges in useReadingStateStore (Yjs) as a fallback for history display.
    try {
      const { useReadingStateStore } = await import('../store/useReadingStateStore');
      useReadingStateStore.getState().addCompletedRange(bookId, range);
    } catch (error) {
      logger.error('Failed to update reading history (completed ranges)', error);
    }
  }



  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
  async logReadingEvent(_bookId: string, _eventType: ReadingEventType, _data?: any): Promise<void> {
    // Deprecated: user_journey store removed.
    return Promise.resolve();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getJourneyEvents(_bookId: string): Promise<ReadingSession[]> {
    // Deprecated: user_journey store removed.
    return Promise.resolve([]);
  }

  // --- Cleanup ---

  cleanup(): void {
    if (this.saveTTSStateTimeout) {
      clearTimeout(this.saveTTSStateTimeout);
      this.saveTTSStateTimeout = null;
    }
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
