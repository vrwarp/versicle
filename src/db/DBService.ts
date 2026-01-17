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
  UserInventoryItem,
  StaticBookManifest,
  NavigationItem,
  CachedSegment,
  ReadingSession
} from '../types/db';
import type { Timepoint } from '../lib/tts/providers/types';
import type { ContentType } from '../types/content-analysis';
import { DatabaseError, StorageFullError } from '../types/errors';
import { extractBookData, type BookExtractionData, generateFileFingerprint } from '../lib/ingestion';

import { Logger } from '../lib/logger';
import type { TTSQueueItem } from '../lib/tts/AudioPlayerService';
import type { ExtractionOptions } from '../lib/tts';

class DBService {
  private async getDB() {
    return getDB();
  }

  private handleError(error: unknown): never {
    Logger.error('DBService', 'Database operation failed', error);

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
   * Post-Yjs migration: user_inventory is in Yjs, not IndexedDB.
   * We only need static_manifests for static metadata.
   */
  async getBookMetadata(id: string): Promise<BookMetadata | undefined> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['static_manifests', 'static_resources', 'user_inventory', 'user_progress'], 'readonly');

      const manifest = await tx.objectStore('static_manifests').get(id);

      // Check existence of resource for isOffloaded
      const resourceKey = await tx.objectStore('static_resources').getKey(id);
      const inventory = await tx.objectStore('user_inventory').get(id); // May be null (Yjs migration)
      const progress = await tx.objectStore('user_progress').get(id);

      await tx.done;

      if (!manifest) {
        return undefined; // Only manifest is required
      }

      return {
        id: manifest.bookId,
        title: inventory?.customTitle || manifest.title,
        author: inventory?.customAuthor || manifest.author,
        description: manifest.description,
        coverBlob: manifest.coverBlob, // Use thumbnail
        addedAt: inventory?.addedAt || Date.now(), // Fallback to now if no inventory

        bookId: manifest.bookId,
        filename: inventory?.sourceFilename || 'unknown.epub', // Fallback
        fileHash: manifest.fileHash,
        fileSize: manifest.fileSize,
        totalChars: manifest.totalChars,
        version: manifest.schemaVersion,

        lastRead: progress?.lastRead,
        progress: progress?.percentage,
        currentCfi: progress?.currentCfi,
        lastPlayedCfi: progress?.lastPlayedCfi,
        isOffloaded: !resourceKey
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves all inventory items directly from the IDB store.
   * Used for migration and self-repair if Yjs data is missing.
   */
  async getAllInventoryItems(): Promise<UserInventoryItem[]> {
    try {
      const db = await this.getDB();
      return await db.getAll('user_inventory');
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves the book ID associated with a given filename.
   * Scans user_inventory as there is no index on sourceFilename.
   */
  async getBookIdByFilename(filename: string): Promise<string | undefined> {
    try {
      const db = await this.getDB();
      // Optimization: Try reading list first to fail fast?
      // But reading list doesn't have ID.
      // Just scan inventory.
      let cursor = await db.transaction('user_inventory').store.openCursor();
      while (cursor) {
        if (cursor.value.sourceFilename === filename) {
          return cursor.value.bookId;
        }
        cursor = await cursor.continue();
      }
      return undefined;
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

      await this.ingestBook(data);
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
  async ingestBook(data: BookExtractionData): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction([
        'static_manifests', 'static_resources', 'static_structure',
        'user_progress', 'user_overrides',
        'cache_tts_preparation', 'cache_table_images',
        'user_reading_list'
      ], 'readwrite');

      await tx.objectStore('static_manifests').add(data.manifest);
      await tx.objectStore('static_resources').add(data.resource);
      await tx.objectStore('static_structure').add(data.structure);
      // Phase 2: user_inventory, user_progress, user_reading_list NO LONGER written here
      // Yjs store handles inventory. Reading State store handles progress/reading list.
      await tx.objectStore('user_overrides').add(data.overrides);

      const ttsStore = tx.objectStore('cache_tts_preparation');
      for (const batch of data.ttsContentBatches) {
        await ttsStore.add({
          id: batch.id,
          bookId: batch.bookId,
          sectionId: batch.sectionId,
          sentences: batch.sentences
        });
      }

      const tableStore = tx.objectStore('cache_table_images');
      for (const table of data.tableBatches) {
        await tableStore.add(table);
      }

      await tx.done;
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
      const db = await this.getDB();
      // Delete from all stores
      const tx = db.transaction([
        'static_manifests', 'static_resources', 'static_structure',
        'user_inventory', 'user_progress', 'user_annotations',
        'user_overrides', 'user_journey', 'user_ai_inference',
        'cache_render_metrics', 'cache_session_state', 'cache_tts_preparation',
        'user_reading_list'
      ], 'readwrite');

      // Cleanup Reading List (Requires filename lookup)
      const inv = await tx.objectStore('user_inventory').get(id);
      if (inv && inv.sourceFilename) {
        await tx.objectStore('user_reading_list').delete(inv.sourceFilename);
      }

      await Promise.all([
        tx.objectStore('static_manifests').delete(id),
        tx.objectStore('static_resources').delete(id),
        tx.objectStore('static_structure').delete(id),
        tx.objectStore('user_inventory').delete(id),
        tx.objectStore('user_progress').delete(id),
        tx.objectStore('user_overrides').delete(id),
        tx.objectStore('cache_render_metrics').delete(id),
        tx.objectStore('cache_session_state').delete(id),
      ]);

      console.log(`[DBService] deleteBook: keys deleted for ${id}. Verifying static_resources deletion...`);
      const res = await tx.objectStore('static_resources').get(id);
      console.log(`[DBService] deleteBook: static_resources.get(${id}) after delete = ${res}`);

      // Delete from index-based stores
      const deleteFromIndex = async (storeName: 'user_annotations' | 'user_journey' | 'user_ai_inference' | 'cache_tts_preparation', indexName: string) => {
        const store = tx.objectStore(storeName);
        // @ts-expect-error - index() types are tricky with generic strings, casting or expect error is needed
        const index = store.index(indexName);
        let cursor = await index.openCursor(IDBKeyRange.only(id));
        while (cursor) {
          await cursor.delete();
          cursor = await cursor.continue();
        }
      };

      await deleteFromIndex('user_annotations', 'by_bookId');
      await deleteFromIndex('user_journey', 'by_bookId');
      await deleteFromIndex('user_ai_inference', 'by_bookId');
      // Added index support for cache_tts_preparation
      await deleteFromIndex('cache_tts_preparation', 'by_bookId');

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
          console.log(`[DBService] getOffloadedStatus: ${id} exists in static_resources? ${exists} (Keys: ${resourceKeys.length})`);
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
        Logger.error('DBService', 'Failed to save TTS state', error);
      }
    }, 1000);
  }

  async getTTSState(bookId: string): Promise<TTSState | undefined> {
    try {
      const db = await this.getDB();
      const session = await db.get('cache_session_state', bookId);
      const progress = await db.get('user_progress', bookId);

      if (session) {
        return {
          bookId,
          queue: session.playbackQueue,
          currentIndex: progress?.currentQueueIndex || 0,
          sectionIndex: progress?.currentSectionIndex || 0,
          updatedAt: session.updatedAt
        };
      }
      return undefined;
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- Annotation Operations ---
  // Deprecated: addAnnotation/deleteAnnotation removed. Use useAnnotationStore.

  async getAnnotations(bookId: string): Promise<Annotation[]> {
    try {
      const db = await this.getDB();
      const anns = await db.getAllFromIndex('user_annotations', 'by_bookId', bookId);
      return anns as Annotation[];
    } catch (error) {
      this.handleError(error);
    }
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



  // --- Content Analysis & Accessibility Operations (Restored) ---

  async getContentAnalysis(bookId: string, sectionId: string): Promise<ContentAnalysis | undefined> {
    try {
      const db = await this.getDB();
      const inference = await db.get('user_ai_inference', `${bookId}-${sectionId}`);

      if (!inference) return undefined;

      // Map UserAiInference to Legacy ContentAnalysis for compatibility
      return {
        id: inference.id,
        bookId: inference.bookId,
        sectionId: inference.sectionId,
        structure: inference.structure || { footnoteMatches: [] },
        contentTypes: inference.semanticMap,
        tableAdaptations: inference.accessibilityLayers
          .filter(l => l.type === 'table-adaptation')
          .map(l => ({ rootCfi: l.rootCfi, text: l.content })),
        summary: inference.summary,
        lastAnalyzed: inference.generatedAt
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async saveContentClassifications(bookId: string, sectionId: string, results: { rootCfi: string; type: ContentType }[]): Promise<void> {
    try {
      const db = await this.getDB();
      const id = `${bookId}-${sectionId}`;
      const tx = db.transaction('user_ai_inference', 'readwrite');
      const store = tx.objectStore('user_ai_inference');

      const existing = await store.get(id) || {
        id, bookId, sectionId,
        semanticMap: [],
        accessibilityLayers: [],
        generatedAt: Date.now()
      };

      existing.semanticMap = results;
      existing.generatedAt = Date.now();

      await store.put(existing);
      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  async clearContentAnalysis(): Promise<void> {
    try {
      const db = await this.getDB();
      await db.clear('user_ai_inference');
    } catch (error) {
      this.handleError(error);
    }
  }

  async getTableImages(bookId: string): Promise<TableImage[]> {
    try {
      const db = await this.getDB();
      return await db.getAllFromIndex('cache_table_images', 'by_bookId', bookId);
    } catch (error) {
      this.handleError(error);
    }
  }

  async saveTableAdaptations(bookId: string, sectionId: string, adaptations: { rootCfi: string; text: string }[]): Promise<void> {
    try {
      const db = await this.getDB();
      const id = `${bookId}-${sectionId}`;
      const tx = db.transaction('user_ai_inference', 'readwrite');
      const store = tx.objectStore('user_ai_inference');

      const existing = await store.get(id) || {
        id, bookId, sectionId,
        semanticMap: [],
        accessibilityLayers: [],
        generatedAt: Date.now()
      };

      // Merge or Overwrite adaptations
      // Remove existing table adaptations for these CFIs (if any strategy needed? for now simple append/replace logic)
      // Actually we should probably rebuild the table-adaptation layers.
      const others = existing.accessibilityLayers.filter(l => l.type !== 'table-adaptation');
      const newLayers = adaptations.map(a => ({
        type: 'table-adaptation' as const,
        rootCfi: a.rootCfi,
        content: a.text
      }));

      existing.accessibilityLayers = [...others, ...newLayers];
      existing.generatedAt = Date.now();

      await store.put(existing);
      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- Reading History Operations ---

  private lastJourneyEntry: { bookId: string; timestamp: number; type: ReadingEventType } | null = null;

  async updateReadingHistory(
    bookId: string,
    range: string,
    type: ReadingEventType,
    _data?: string,
    _isStart?: boolean
  ): Promise<void> {
    void _data;
    void _isStart;
    try {
      const db = await this.getDB();
      const tx = db.transaction(['user_journey'], 'readwrite');
      const journeyStore = tx.objectStore('user_journey');

      // 2. Log Journey Event (with Coalescing)
      const now = Date.now();
      const COALESCE_WINDOW = 5 * 60 * 1000; // 5 minutes

      let shouldLog = true;
      if (type === 'scroll' && this.lastJourneyEntry) {
        if (this.lastJourneyEntry.bookId === bookId &&
          this.lastJourneyEntry.type === 'scroll' &&
          (now - this.lastJourneyEntry.timestamp) < COALESCE_WINDOW) {
          shouldLog = false;
        }
      }

      if (shouldLog) {
        await journeyStore.add({
          // id is auto-incremented
          bookId,
          startTimestamp: now,
          endTimestamp: now,
          duration: 0,
          cfiRange: range,
          type: type === 'tts' || type === 'scroll' || type === 'page' ? type : 'page'
        });
        this.lastJourneyEntry = { bookId, timestamp: now, type };
      }

      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }



  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async logReadingEvent(bookId: string, eventType: ReadingEventType, _data?: any): Promise<void> {
    void _data;
    try {
      const db = await this.getDB();
      await db.add('user_journey', {
        // id is auto-incremented
        bookId,
        startTimestamp: Date.now(),
        endTimestamp: Date.now(),
        duration: 0,
        cfiRange: '', // Missing usage requires placeholder
        type: eventType === 'tts' || eventType === 'scroll' || eventType === 'page' ? eventType : 'page'
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  async getJourneyEvents(bookId: string): Promise<ReadingSession[]> {
    try {
      const db = await this.getDB();
      const journey = await db.getAllFromIndex('user_journey', 'by_bookId', bookId);

      return journey.map((step): ReadingSession => {
        const mappedType = (step.type === 'visual' ? 'page' : step.type) as ReadingEventType;
        return {
          timestamp: step.startTimestamp,
          duration: step.duration || 0,
          cfiRange: step.cfiRange,
          type: mappedType
        };
      }).sort((a, b) => b.timestamp - a.timestamp);
    } catch (error) {
      this.handleError(error);
      return [];
    }
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
