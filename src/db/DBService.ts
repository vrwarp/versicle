import { getDB } from './db';
import type {
  BookMetadata,
  ReadingListEntry, ReadingHistoryEntry,
  // Legacy / Composite Types used in Service Layer
  TTSState, CachedSegment, BookLocations,
  CacheSessionState,
  UserAiInference,
  SectionMetadata,
  TableImage
} from '../types/db';
import type { Timepoint } from '../lib/tts/providers/types';
import { DatabaseError, StorageFullError } from '../types/errors';
import { processEpub, generateFileFingerprint } from '../lib/ingestion';
import { Logger } from '../lib/logger';
import type { TTSQueueItem } from '../lib/tts/AudioPlayerService';
import type { ExtractionOptions } from '../lib/tts';
import type { ContentType } from '../types/content-analysis';

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
        const rlEntry = inv.sourceFilename ? rlMap.get(inv.sourceFilename) : undefined;
        const localPct = prog?.percentage || 0;
        const rlPct = rlEntry?.percentage || 0;
        const displayPct = Math.max(localPct, rlPct);

        const composite: BookMetadata = {
          id: man.bookId,
          title: inv.customTitle || man.title,
          author: inv.customAuthor || man.author,
          description: man.description,
          coverUrl: undefined,
          coverBlob: man.coverBlob,
          addedAt: inv.addedAt,
          bookId: man.bookId,
          filename: inv.sourceFilename,
          fileHash: man.fileHash,
          fileSize: man.fileSize,
          totalChars: man.totalChars,
          version: man.schemaVersion,
          lastRead: prog?.lastRead,
          progress: displayPct,
          currentCfi: prog?.currentCfi,
          lastPlayedCfi: prog?.lastPlayedCfi,
          isOffloaded: false
        };
        library.push(composite);
      }
      return library.sort((a, b) => b.addedAt - a.addedAt);
    } catch (error) {
      this.handleError(error);
    }
  }

  async getBook(id: string): Promise<{ metadata: BookMetadata | undefined; file: Blob | ArrayBuffer | undefined }> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['static_manifests', 'static_resources', 'user_inventory', 'user_progress', 'user_reading_list'], 'readonly');

      const manifest = await tx.objectStore('static_manifests').get(id);
      const resource = await tx.objectStore('static_resources').get(id);
      const inventory = await tx.objectStore('user_inventory').get(id);
      const progress = await tx.objectStore('user_progress').get(id);

      let readingListEntry;
      if (inventory?.sourceFilename) {
        readingListEntry = await tx.objectStore('user_reading_list').get(inventory.sourceFilename);
      }

      await tx.done;

      if (!manifest) return { metadata: undefined, file: undefined };

      const localPct = progress?.percentage || 0;
      const rlPct = readingListEntry?.percentage || 0;
      const displayPct = (localPct > 0) ? localPct : rlPct;

      const metadata: BookMetadata = {
        id: manifest.bookId,
        title: inventory?.customTitle || manifest.title,
        author: inventory?.customAuthor || manifest.author,
        description: manifest.description,
        coverBlob: manifest.coverBlob,
        addedAt: inventory?.addedAt || Date.now(),
        bookId: manifest.bookId,
        filename: inventory?.sourceFilename,
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

  async getBookMetadata(id: string): Promise<BookMetadata | undefined> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['static_manifests', 'static_resources', 'user_inventory', 'user_progress'], 'readonly');
      const manifest = await tx.objectStore('static_manifests').get(id);
      const resourceKey = await tx.objectStore('static_resources').getKey(id);
      const inventory = await tx.objectStore('user_inventory').get(id);
      const progress = await tx.objectStore('user_progress').get(id);
      await tx.done;

      if (!manifest) return undefined;

      return {
        id: manifest.bookId,
        title: inventory?.customTitle || manifest.title,
        author: inventory?.customAuthor || manifest.author,
        description: manifest.description,
        coverBlob: manifest.coverBlob,
        addedAt: inventory?.addedAt || Date.now(),
        bookId: manifest.bookId,
        filename: inventory?.sourceFilename,
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

  async getBookFile(id: string): Promise<Blob | ArrayBuffer | undefined> {
    try {
      const db = await this.getDB();
      const res = await db.get('static_resources', id);
      return res?.epubBlob;
    } catch (error) {
      this.handleError(error);
    }
  }

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

  async addBook(
    file: File,
    ttsOptions?: ExtractionOptions,
    onProgress?: (progress: number, message: string) => void
  ): Promise<BookMetadata> {
    try {
      return await processEpub(file, ttsOptions, onProgress);
    } catch (error) {
      this.handleError(error);
    }
  }

  async updateBookMetadata(id: string, metadata: Partial<BookMetadata>): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['user_inventory', 'static_structure'], 'readwrite');

      // Update User Inventory (Custom Metadata)
      const invStore = tx.objectStore('user_inventory');
      const invItem = await invStore.get(id);
      if (invItem) {
        if (metadata.title) invItem.customTitle = metadata.title;
        if (metadata.author) invItem.customAuthor = metadata.author;
        // invItem.aiAnalysisStatus = metadata.aiAnalysisStatus; // Not in UserInventoryItem yet, ignoring for now or strict typing
        await invStore.put(invItem);
      }

      // Update Synthetic TOC (Static Structure)
      if (metadata.syntheticToc) {
        const structStore = tx.objectStore('static_structure');
        const struct = await structStore.get(id);
        if (struct) {
          struct.toc = metadata.syntheticToc;
          await structStore.put(struct);
        }
      }

      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- TTS Content (Cache) ---

  async getTTSContent(bookId: string, sectionId: string): Promise<any | undefined> {
    try {
      const db = await this.getDB();
      return await db.get('cache_tts_preparation', `${bookId}-${sectionId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- AI Inference Actions ---

  async saveTableAdaptations(bookId: string, sectionId: string, adaptations: { rootCfi: string; text: string }[]): Promise<void> {
    try {
      const db = await this.getDB();
      const id = `${bookId}-${sectionId}`;
      const store = 'user_ai_inference';

      const existing = await db.get(store, id) || {
        id,
        bookId,
        sectionId,
        semanticMap: [],
        accessibilityLayers: [],
        generatedAt: Date.now()
      };

      // Filter out existing table adaptations to replace them
      const otherLayers = existing.accessibilityLayers.filter(l => l.type !== 'table-adaptation');
      const newLayers = adaptations.map(a => ({
        type: 'table-adaptation' as const,
        rootCfi: a.rootCfi,
        content: a.text
      }));

      existing.accessibilityLayers = [...otherLayers, ...newLayers];
      existing.generatedAt = Date.now();

      await db.put(store, existing);
    } catch (error) {
      this.handleError(error);
    }
  }

  async saveContentClassifications(bookId: string, sectionId: string, classifications: { rootCfi: string; type: ContentType }[]): Promise<void> {
    try {
      const db = await this.getDB();
      const id = `${bookId}-${sectionId}`;
      const store = 'user_ai_inference';

      const existing = await db.get(store, id) || {
        id,
        bookId,
        sectionId,
        semanticMap: [],
        accessibilityLayers: [],
        generatedAt: Date.now()
      };

      existing.semanticMap = classifications;
      existing.generatedAt = Date.now();

      await db.put(store, existing);
    } catch (error) {
      this.handleError(error);
    }
  }

  async deleteBook(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction([
        'static_manifests', 'static_resources', 'static_structure',
        'user_inventory', 'user_progress', 'user_annotations',
        'user_overrides', 'user_journey', 'user_ai_inference',
        'cache_render_metrics', 'cache_session_state', 'cache_tts_preparation',
        'cache_table_images'
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

      const deleteFromIndex = async (storeName: 'user_annotations' | 'user_journey' | 'user_ai_inference' | 'cache_tts_preparation' | 'cache_table_images', indexName: string) => {
        const store = tx.objectStore(storeName);
        // @ts-expect-error - IDB logic
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
      await deleteFromIndex('cache_tts_preparation', 'by_bookId');
      await deleteFromIndex('cache_table_images', 'by_bookId');

      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  async offloadBook(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['static_resources', 'static_manifests'], 'readwrite');
      await tx.objectStore('static_resources').delete(id);
      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  async restoreBook(id: string, file: File): Promise<void> {
    try {
      const db = await this.getDB();
      const manifest = await db.get('static_manifests', id);
      if (!manifest) throw new Error('Book metadata not found');
      const newFingerprint = await generateFileFingerprint(file, {
        title: manifest.title,
        author: manifest.author,
        filename: file.name
      });
      if (manifest.fileHash && manifest.fileHash !== newFingerprint) {
        throw new Error('File verification failed: Fingerprint mismatch.');
      }
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

  // --- TTS State Operations (Cache) ---

  private saveTTSStateTimeout: NodeJS.Timeout | null = null;
  private pendingTTSState: { [bookId: string]: CacheSessionState } = {};

  saveTTSState(bookId: string, queue: TTSQueueItem[], currentIndex: number, sectionIndex?: number): void {
    this.pendingTTSState[bookId] = {
      bookId,
      playbackQueue: queue,
      currentIndex,
      sectionIndex,
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
      if (session) {
        return {
          bookId,
          queue: session.playbackQueue,
          currentIndex: session.currentIndex,
          sectionIndex: session.sectionIndex,
          updatedAt: session.updatedAt
        };
      }
      return undefined;
    } catch (error) {
      this.handleError(error);
    }
  }

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

  // --- Locations (Cache) ---

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

  // --- Reading History (Event Log) Operations ---

  async updateReadingHistory(bookId: string, cfiRange: string, type: 'scroll' | 'page' | 'tts' = 'scroll', label?: string): Promise<void> {
    try {
      const db = await this.getDB();
      await db.add('user_journey', {
        bookId,
        cfiRange,
        startTimestamp: Date.now(),
        endTimestamp: Date.now(), // Estimate
        duration: 0,
        type: type === 'tts' ? 'tts' : 'visual',
        label: label || (type === 'scroll' ? 'Scroll' : type === 'page' ? 'Page Turn' : 'TTS')
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  async saveTTSPosition(bookId: string, currentIndex: number, sectionIndex: number): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('cache_session_state', 'readwrite');
      const store = tx.objectStore('cache_session_state');
      const state = await store.get(bookId);
      if (state) {
        state.currentIndex = currentIndex;
        state.sectionIndex = sectionIndex;
        state.updatedAt = Date.now();
        await store.put(state);
      }
      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  async updatePlaybackState(bookId: string, lastPlayedCfi?: string, _lastPauseTime?: number | null): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('user_progress', 'readwrite');
      const store = tx.objectStore('user_progress');
      const progress = await store.get(bookId);
      if (progress) {
        if (lastPlayedCfi) progress.lastPlayedCfi = lastPlayedCfi;
        // user_progress doesn't explicitly store lastPauseTime in the interface we saw earlier,
        // but we can add it or ignore if not present.
        // Checking src/types/db.ts: UserProgress has lastPlayedCfi. It does NOT have lastPauseTime.
        // Logic typically uses lastRead as timestamp?
        // Legacy BookState had lastPauseTime.
        // We'll just update lastPlayedCfi and lastRead.
        progress.lastRead = Date.now();
        await store.put(progress);
      }
      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  async getReadingHistory(bookId: string): Promise<string[]> {
    try {
      const db = await this.getDB();
      const journey = await db.getAllFromIndex('user_journey', 'by_bookId', bookId);
      return journey.map(j => j.cfiRange);
    } catch (error) {
      this.handleError(error);
    }
  }

  async getReadingHistoryEntry(bookId: string): Promise<ReadingHistoryEntry | undefined> {
    try {
      const db = await this.getDB();
      const prog = await db.get('user_progress', bookId);
      const journey = await db.getAllFromIndex('user_journey', 'by_bookId', bookId);

      if (!prog && journey.length === 0) return undefined;

      return {
        bookId,
        readRanges: prog?.completedRanges || [], // Legacy prog
        sessions: journey.map((j: any) => ({
          cfiRange: j.cfiRange,
          timestamp: j.startTimestamp,
          type: j.type || 'visual',
          label: j.label || 'Session'
        })),
        lastUpdated: prog?.lastRead || 0
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- AI / Content Analysis Operations ---

  async getContentAnalysis(bookId: string, sectionId: string): Promise<UserAiInference | undefined> {
    try {
      const db = await this.getDB();
      // 'user_ai_inference' store, index 'by_bookId' ? No, get by bookId might be too many.
      // Actually schema says user_ai_inference key is [bookId, sectionId] or just UUID?
      // Schema: keyPath: 'id', indexes: 'by_bookId', 'by_type'.
      // So we query by bookId.
      const all = await db.getAllFromIndex('user_ai_inference', 'by_bookId', bookId);
      const match = all.find(item => item.sectionId === sectionId);
      return match;
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- Table Images ---

  async getTableImages(bookId: string): Promise<TableImage[]> {
    try {
      const db = await this.getDB();
      return await db.getAllFromIndex('cache_table_images', 'by_bookId', bookId);
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- Reading List (Export/Import) ---

  async getReadingList(): Promise<ReadingListEntry[]> {
    try {
      const db = await this.getDB();
      return await db.getAll('user_reading_list');
    } catch (error) {
      this.handleError(error);
    }
  }

  async importReadingList(list: ReadingListEntry[]): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('user_reading_list', 'readwrite');
      const store = tx.objectStore('user_reading_list');
      for (const entry of list) {
        await store.put(entry);
      }
      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- Maintenance ---

  async cleanup(): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction([
        'cache_audio_blobs', 'cache_render_metrics', 'cache_session_state',
        'cache_tts_preparation', 'cache_table_images'
      ], 'readwrite');

      if (this.saveTTSStateTimeout) {
        clearTimeout(this.saveTTSStateTimeout);
        this.saveTTSStateTimeout = null;
      }

      await Promise.all([
        tx.objectStore('cache_audio_blobs').clear(),
        tx.objectStore('cache_render_metrics').clear(),
        tx.objectStore('cache_session_state').clear(),
        tx.objectStore('cache_tts_preparation').clear(),
        tx.objectStore('cache_table_images').clear()
      ]);
      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }
}

export const dbService = new DBService();
