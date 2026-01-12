import { getDB } from './db';
import type {
  BookMetadata,
  ReadingListEntry, ReadingHistoryEntry, ReadingEventType, TTSContent, SectionMetadata, TableImage,
  // Legacy / Composite Types used in Service Layer
  TTSState, Annotation, CachedSegment, BookLocations, ContentAnalysis,
  CacheSessionState,
  CacheTtsPreparation,
  UserInventoryItem
} from '../types/db';
import type { Timepoint } from '../lib/tts/providers/types';
import type { ContentType } from '../types/content-analysis';
import { DatabaseError, StorageFullError } from '../types/errors';
import { extractBookData, type BookExtractionData, generateFileFingerprint } from '../lib/ingestion';
import { mergeCfiRanges } from '../lib/cfi-utils';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../lib/logger';
import type { TTSQueueItem } from '../lib/tts/AudioPlayerService';
import type { ExtractionOptions } from '../lib/tts';

class DBService {
  private async getDB() {
    return getDB();
  }

  private handleError(error: unknown): never {
    Logger.error('DBService', 'Database operation failed', error);

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
  async getLibrary(): Promise<BookMetadata[]> {
    try {
      const db = await this.getDB();

      const [manifests, inventory, progress, readingList] = await Promise.all([
        db.getAll('static_manifests'),
        db.getAll('user_inventory'),
        db.getAll('user_progress'),
        db.getAll('user_reading_list')
      ]);

      const invMap = new Map(inventory.map(i => [i.bookId, i]));
      const progMap = new Map(progress.map(p => [p.bookId, p]));
      const rlMap = new Map(readingList.map(r => [r.filename, r]));

      const library: BookMetadata[] = [];

      for (const man of manifests) {
        const inv = invMap.get(man.bookId);
        const prog = progMap.get(man.bookId);

        if (!inv) continue;

        // Resolve Reading List entry via filename
        const rlEntry = inv.sourceFilename ? rlMap.get(inv.sourceFilename) : undefined;

        // Calculate Display Progress (Highest Wins)
        const localPct = prog?.percentage || 0;
        const rlPct = rlEntry?.percentage || 0;
        const displayPct = Math.max(localPct, rlPct);

        const composite: BookMetadata = {
          // Book Interface
          id: man.bookId,
          title: inv.customTitle || man.title,
          author: inv.customAuthor || man.author,
          description: man.description,
          coverUrl: undefined, // Needs blob, managed by UI/SW
          coverBlob: man.coverBlob, // Thumbnail is now in manifest
          addedAt: inv.addedAt,
          // BookSource Interface
          bookId: man.bookId,
          filename: inv.sourceFilename,
          fileHash: man.fileHash,
          fileSize: man.fileSize,
          totalChars: man.totalChars,
          version: man.schemaVersion,
          // BookState Interface
          lastRead: prog?.lastRead,
          progress: displayPct,
          currentCfi: prog?.currentCfi,
          lastPlayedCfi: prog?.lastPlayedCfi,
          isOffloaded: false // Placeholder, see logic below
        };
        library.push(composite);
      }

      // Optimization for isOffloaded: Get all keys from static_resources
      const resourceKeys = await db.getAllKeys('static_resources');
      const resourceSet = new Set(resourceKeys);

      for (const book of library) {
        book.isOffloaded = !resourceSet.has(book.id);
      }

      return library.sort((a, b) => b.addedAt - a.addedAt);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves a specific book and its file content.
   */
  async getBook(id: string): Promise<{ metadata: BookMetadata | undefined; file: Blob | ArrayBuffer | undefined }> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['static_manifests', 'static_resources', 'user_inventory', 'user_progress', 'user_reading_list'], 'readonly');

      const manifest = await tx.objectStore('static_manifests').get(id);
      const resource = await tx.objectStore('static_resources').get(id);
      const inventory = await tx.objectStore('user_inventory').get(id);
      const progress = await tx.objectStore('user_progress').get(id);

      // Fetch Reading List Entry if possible
      let readingListEntry;
      if (inventory?.sourceFilename) {
        readingListEntry = await tx.objectStore('user_reading_list').get(inventory.sourceFilename);
      }

      await tx.done;

      if (!manifest || !inventory) return { metadata: undefined, file: undefined };

      // Determine progress: prefer local if > 0, else fallback to reading list
      const localPct = progress?.percentage || 0;
      const rlPct = readingListEntry?.percentage || 0;
      const displayPct = (localPct > 0) ? localPct : rlPct;

      const metadata: BookMetadata = {
        id: manifest.bookId,
        title: inventory.customTitle || manifest.title,
        author: inventory.customAuthor || manifest.author,
        description: manifest.description,
        coverBlob: manifest.coverBlob, // Use thumbnail
        addedAt: inventory.addedAt,

        bookId: manifest.bookId,
        filename: inventory.sourceFilename,
        fileHash: manifest.fileHash,
        fileSize: manifest.fileSize,
        totalChars: manifest.totalChars,
        version: manifest.schemaVersion,

        lastRead: progress?.lastRead,
        progress: displayPct,
        currentCfi: progress?.currentCfi,
        lastPlayedCfi: progress?.lastPlayedCfi,
        isOffloaded: !resource?.epubBlob
      };

      return { metadata, file: resource?.epubBlob };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves only the metadata for a specific book.
   */
  async getBookMetadata(id: string): Promise<BookMetadata | undefined> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['static_manifests', 'static_resources', 'user_inventory', 'user_progress'], 'readonly');

      const manifest = await tx.objectStore('static_manifests').get(id);
      // Check existence of resource for isOffloaded
      const resourceKey = await tx.objectStore('static_resources').getKey(id);
      const inventory = await tx.objectStore('user_inventory').get(id);
      const progress = await tx.objectStore('user_progress').get(id);

      await tx.done;

      if (!manifest || !inventory) return undefined;

      return {
        id: manifest.bookId,
        title: inventory.customTitle || manifest.title,
        author: inventory.customAuthor || manifest.author,
        description: manifest.description,
        coverBlob: manifest.coverBlob, // Use thumbnail
        addedAt: inventory.addedAt,

        bookId: manifest.bookId,
        filename: inventory.sourceFilename,
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
   * Updates only the metadata for a specific book.
   */
  async updateBookMetadata(id: string, metadata: Partial<BookMetadata>): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['user_inventory', 'user_progress'], 'readwrite');

      const invStore = tx.objectStore('user_inventory');
      const progStore = tx.objectStore('user_progress');

      const inventory = await invStore.get(id);
      const progress = await progStore.get(id);

      if (inventory) {
        if (metadata.title) inventory.customTitle = metadata.title;
        if (metadata.author) inventory.customAuthor = metadata.author;
        await invStore.put(inventory);
      }

      if (progress) {
        if (metadata.progress !== undefined) progress.percentage = metadata.progress;
        if (metadata.lastRead !== undefined) progress.lastRead = metadata.lastRead;
        if (metadata.currentCfi !== undefined) progress.currentCfi = metadata.currentCfi;
        await progStore.put(progress);
      }

      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

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
   * Adds a new book to the library.
   */
  async addBook(
    file: File,
    ttsOptions?: ExtractionOptions,
    onProgress?: (progress: number, message: string) => void
  ): Promise<void> {
    try {
      const data = await extractBookData(file, ttsOptions, onProgress);
      await this.ingestBook(data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Ingests extracted book data into the database.
   */
  async ingestBook(data: BookExtractionData): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction([
        'static_manifests', 'static_resources', 'static_structure',
        'user_inventory', 'user_progress', 'user_overrides',
        'cache_tts_preparation', 'cache_table_images',
        'user_reading_list'
      ], 'readwrite');

      await tx.objectStore('static_manifests').add(data.manifest);
      await tx.objectStore('static_resources').add(data.resource);
      await tx.objectStore('static_structure').add(data.structure);
      await tx.objectStore('user_inventory').add(data.inventory);
      await tx.objectStore('user_progress').add(data.progress);
      await tx.objectStore('user_overrides').add(data.overrides);
      await tx.objectStore('user_reading_list').add(data.readingListEntry);

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
        'cache_render_metrics', 'cache_session_state', 'cache_tts_preparation'
      ], 'readwrite');

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

  // --- Progress Operations ---

  private saveProgressTimeout: NodeJS.Timeout | null = null;
  private pendingProgress: { [key: string]: { cfi: string; progress: number } } = {};

  saveProgress(bookId: string, cfi: string, progress: number): void {
    this.pendingProgress[bookId] = { cfi, progress };

    if (this.saveProgressTimeout) return;

    this.saveProgressTimeout = setTimeout(async () => {
      this.saveProgressTimeout = null;
      const pending = { ...this.pendingProgress };
      this.pendingProgress = {};

      try {
        const db = await this.getDB();
        const tx = db.transaction(['user_progress', 'user_inventory', 'user_reading_list', 'static_manifests'], 'readwrite');
        const progStore = tx.objectStore('user_progress');
        const invStore = tx.objectStore('user_inventory');
        const rlStore = tx.objectStore('user_reading_list');
        const manStore = tx.objectStore('static_manifests');

        for (const [id, data] of Object.entries(pending)) {
          let userProg = await progStore.get(id);
          if (!userProg) {
            // Should exist, but handle edge case
            userProg = {
              bookId: id, percentage: 0, lastRead: Date.now(), completedRanges: []
            };
          }
          userProg.currentCfi = data.cfi;
          userProg.percentage = data.progress;
          userProg.lastRead = Date.now();
          await progStore.put(userProg);

          // Update Inventory Status
          const inv = await invStore.get(id);
          if (inv) {
            inv.lastInteraction = Date.now();
            if (data.progress > 0.98) inv.status = 'completed';
            else if (inv.status !== 'completed') inv.status = 'reading';
            await invStore.put(inv);

            // --- Sync to Reading List ---
            if (inv.sourceFilename) {
              // Fetch Manifest for Metadata if needed (or use Inv)
              // We prefer manifest for ISBN
              const man = await manStore.get(id);
              await rlStore.put({
                filename: inv.sourceFilename,
                title: inv.customTitle || man?.title || 'Unknown',
                author: inv.customAuthor || man?.author || 'Unknown',
                isbn: man?.isbn,
                percentage: data.progress,
                lastUpdated: Date.now(),
                status: inv.status === 'completed' ? 'read' : (inv.status === 'reading' ? 'currently-reading' : 'to-read'),
                rating: inv.rating
              });
            }
          }
        }
        await tx.done;
      } catch (error) {
        Logger.error('DBService', 'Failed to save progress', error);
      }
    }, 1000);
  }

  // --- Reading List Operations (Legacy/Mapped) ---
  // Mapping UserInventory to ReadingListEntry for backward compatibility

  async getReadingList(): Promise<ReadingListEntry[]> {
    try {
      const db = await this.getDB();
      return await db.getAll('user_reading_list');
    } catch (error) {
      this.handleError(error);
    }
  }

  async upsertReadingListEntry(entry: ReadingListEntry): Promise<void> {
    try {
      const db = await this.getDB();

      const tx = db.transaction(['user_reading_list', 'user_inventory', 'user_progress'], 'readwrite');
      const rlStore = tx.objectStore('user_reading_list');
      const invStore = tx.objectStore('user_inventory');
      const progStore = tx.objectStore('user_progress');

      // 1. Always upsert to Reading List
      await rlStore.put(entry);

      // 2. Try to sync with Library
      let bookId: string | undefined;
      let inventoryItem: UserInventoryItem | undefined;

      let cursor = await invStore.openCursor();
      while (cursor) {
        if (cursor.value.sourceFilename === entry.filename) {
          bookId = cursor.value.bookId;
          inventoryItem = cursor.value;
          break;
        }
        cursor = await cursor.continue();
      }

      if (bookId && inventoryItem) {
        // Update Inventory (Sync Back)
        // We only update if the reading list entry has meaningful data?
        // Yes, Title/Author/Rating/Status
        inventoryItem.customTitle = entry.title;
        inventoryItem.customAuthor = entry.author;
        inventoryItem.rating = entry.rating;
        // inv.lastInteraction? Maybe.
        inventoryItem.lastInteraction = entry.lastUpdated;

        if (entry.status === 'read') inventoryItem.status = 'completed';
        else if (entry.status === 'currently-reading') inventoryItem.status = 'reading';
        else if (entry.status === 'to-read') inventoryItem.status = 'unread';

        await invStore.put(inventoryItem);

        // Update Progress (Highest Wins)
        const prog = await progStore.get(bookId);
        if (prog) {
          if (entry.percentage > prog.percentage) {
            prog.percentage = entry.percentage;
            prog.lastRead = entry.lastUpdated;
            await progStore.put(prog);
          }
        }
      }

      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  async deleteReadingListEntry(filename: string): Promise<void> {
    try {
      const db = await this.getDB();
      await db.delete('user_reading_list', filename);
    } catch (error) {
      this.handleError(error);
    }
  }

  async deleteReadingListEntries(filenames: string[]): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('user_reading_list', 'readwrite');
      const store = tx.objectStore('user_reading_list');
      for (const f of filenames) {
        await store.delete(f);
      }
      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  async importReadingList(entries: ReadingListEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.upsertReadingListEntry(entry);
    }
  }

  // --- Playback State ---

  async updatePlaybackState(bookId: string, lastPlayedCfi?: string, lastPauseTime?: number | null): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['user_progress', 'cache_session_state'], 'readwrite');

      if (lastPlayedCfi !== undefined) {
        const progStore = tx.objectStore('user_progress');
        const prog = await progStore.get(bookId);
        if (prog) {
          prog.lastPlayedCfi = lastPlayedCfi;
          await progStore.put(prog);
        }
      }

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

  saveTTSState(bookId: string, queue: TTSQueueItem[], currentIndex: number, sectionIndex?: number): void {
    this.pendingTTSState[bookId] = {
      bookId,
      playbackQueue: queue,
      updatedAt: Date.now()
    };

    // Also update progress index
    this.saveTTSPosition(bookId, currentIndex, sectionIndex);

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

  private saveTTSPositionTimeout: NodeJS.Timeout | null = null;
  private pendingTTSPosition: { [bookId: string]: { idx: number, secIdx?: number } } = {};

  saveTTSPosition(bookId: string, currentIndex: number, sectionIndex?: number): void {
    this.pendingTTSPosition[bookId] = { idx: currentIndex, secIdx: sectionIndex };

    if (this.saveTTSPositionTimeout) return;

    this.saveTTSPositionTimeout = setTimeout(async () => {
      this.saveTTSPositionTimeout = null;
      const pending = { ...this.pendingTTSPosition };
      this.pendingTTSPosition = {};

      try {
        const db = await this.getDB();
        const tx = db.transaction('user_progress', 'readwrite');
        const store = tx.objectStore('user_progress');

        for (const [id, val] of Object.entries(pending)) {
          const prog = await store.get(id);
          if (prog) {
            prog.currentQueueIndex = val.idx;
            prog.currentSectionIndex = val.secIdx;
            await store.put(prog);
          }
        }
        await tx.done;
      } catch (error) {
        Logger.error('DBService', 'Failed to save TTS position', error);
      }
    }, 500);
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

  async addAnnotation(annotation: Annotation): Promise<void> {
    try {
      const db = await this.getDB();
      await db.put('user_annotations', {
        id: annotation.id,
        bookId: annotation.bookId,
        cfiRange: annotation.cfiRange,
        text: annotation.text,
        type: annotation.type,
        color: annotation.color,
        note: annotation.note,
        created: annotation.created
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  async getAnnotations(bookId: string): Promise<Annotation[]> {
    try {
      const db = await this.getDB();
      const anns = await db.getAllFromIndex('user_annotations', 'by_bookId', bookId);
      return anns as Annotation[];
    } catch (error) {
      this.handleError(error);
    }
  }

  async deleteAnnotation(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      await db.delete('user_annotations', id);
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

  // --- Reading History Operations ---

  private lastJourneyEntry: { bookId: string; timestamp: number; type: ReadingEventType } | null = null;

  async updateReadingHistory(bookId: string, range: string, type: ReadingEventType): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['user_progress', 'user_journey'], 'readwrite');
      const progStore = tx.objectStore('user_progress');
      const journeyStore = tx.objectStore('user_journey');

      // 1. Update Progress (Completed Ranges)
      const prog = await progStore.get(bookId) || {
        bookId, percentage: 0, lastRead: Date.now(), completedRanges: []
      };

      const newRanges = mergeCfiRanges(prog.completedRanges || [], range);
      prog.completedRanges = newRanges;
      prog.lastRead = Date.now();
      await progStore.put(prog);

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
        // Check if journey store uses autoIncrement or keyPath
        // Assuming auto-generated keys or UUID usage in higher level. 
        // For now, adhere to Schema: user_journey { id: string, ... }
        // If we don't provide ID and it's not auto-increment, it will fail.
        // Schema definition in db.ts: keyPath: 'id'
        // We need an ID. 
        // Since we can't easily import uuid here without checking imports, I'll use a simple generator fallback.
        const id = uuidv4();

        await journeyStore.add({
          id,
          bookId,
          startTimestamp: now,
          endTimestamp: now,
          duration: 0,
          cfiRange: range,
          type: type // matches expanded UserJourneyStep type
        });
        this.lastJourneyEntry = { bookId, timestamp: now, type };
      }

      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getReadingHistory(bookId: string): Promise<string[]> {
    try {
      const db = await this.getDB();
      const prog = await db.get('user_progress', bookId);
      return prog ? prog.completedRanges : [];
    } catch (error) {
      this.handleError(error);
    }
  }

  async getReadingHistoryEntry(bookId: string): Promise<ReadingHistoryEntry | undefined> {
    try {
      const db = await this.getDB();
      const prog = await db.get('user_progress', bookId);
      const journey = await db.getAllFromIndex('user_journey', 'by_bookId', bookId);
      if (!prog) return undefined;

      // Note: Logic to aggregate session times would go here.
      // For now, return stub data or calculate from journey events.
      // Assuming basic totalTimeRead for now.

      return {
        bookId,
        date: new Date().toISOString().split('T')[0], // Today
        totalTimeRead: 0, // Placeholder
        sessions: []
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async logReadingEvent(bookId: string, eventType: ReadingEventType, data?: any): Promise<void> {
    try {
      const db = await this.getDB();
      await db.put('user_journey', {
        id: uuidv4(), // Need uuid import, but not imported. Assuming simple ID or importing uuid.
        // Wait, I am not importing uuid in DBService.
        // I should rely on auto-id or import it.
        // user_journey id is string in schema.
        // I'll skip uuid for now and use timestamp-random
        bookId,
        timestamp: Date.now(),
        eventType,
        data
      });
      // But wait, schema says user_journey needs 'id'.
      // I will use crypto.randomUUID if available or fallback.
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- Cleanup ---

  cleanup(): void {
    if (this.saveProgressTimeout) {
      clearTimeout(this.saveProgressTimeout);
      this.saveProgressTimeout = null;
    }
    if (this.saveTTSStateTimeout) {
      clearTimeout(this.saveTTSStateTimeout);
      this.saveTTSStateTimeout = null;
    }
    if (this.saveTTSPositionTimeout) {
      clearTimeout(this.saveTTSPositionTimeout);
      this.saveTTSPositionTimeout = null;
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
      // Using composite key logic or index
      // The store uses 'id' as keyPath, which is `${bookId}-${sectionId}`
      const id = `${bookId}-${sectionId}`;
      return await db.get('cache_tts_preparation', id);
    } catch (error) {
      this.handleError(error);
    }
  }

}

// Singleton export
export const dbService = new DBService();
