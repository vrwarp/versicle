import { getDB } from './db';
import type {
    BookMetadata,
    ReadingListEntry, ReadingHistoryEntry, ReadingEventType, TTSContent, SectionMetadata, TableImage,
    // Legacy / Composite Types used in Service Layer
    TTSState, Annotation, CachedSegment, BookLocations, ContentAnalysis,
    CacheSessionState
} from '../types/db';
import type { ContentType } from '../types/content-analysis';
import { DatabaseError, StorageFullError } from '../types/errors';
import { processEpub, generateFileFingerprint } from '../lib/ingestion';
import { mergeCfiRanges } from '../lib/cfi-utils';
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

      const [manifests, inventory, progress] = await Promise.all([
          db.getAll('static_manifests'),
          db.getAll('user_inventory'),
          db.getAll('user_progress')
      ]);

      const invMap = new Map(inventory.map(i => [i.bookId, i]));
      const progMap = new Map(progress.map(p => [p.bookId, p]));

      const library: BookMetadata[] = [];

      for (const man of manifests) {
          const inv = invMap.get(man.bookId);
          const prog = progMap.get(man.bookId);

          if (!inv) continue;

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
              progress: prog?.percentage,
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
      const tx = db.transaction(['static_manifests', 'static_resources', 'user_inventory', 'user_progress'], 'readonly');

      const manifest = await tx.objectStore('static_manifests').get(id);
      const resource = await tx.objectStore('static_resources').get(id);
      const inventory = await tx.objectStore('user_inventory').get(id);
      const progress = await tx.objectStore('user_progress').get(id);

      await tx.done;

      if (!manifest || !inventory) return { metadata: undefined, file: undefined };

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
          progress: progress?.percentage,
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
      await processEpub(file, ttsOptions, onProgress);
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const index = store.index(indexName as any);
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
              const tx = db.transaction(['user_progress', 'user_inventory'], 'readwrite');
              const progStore = tx.objectStore('user_progress');
              const invStore = tx.objectStore('user_inventory');

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
      const inventory = await db.getAll('user_inventory');
      const manifests = await db.getAll('static_manifests');
      const progress = await db.getAll('user_progress');

      const manMap = new Map(manifests.map(m => [m.bookId, m]));
      const progMap = new Map(progress.map(p => [p.bookId, p]));

      return inventory.map(inv => {
          const man = manMap.get(inv.bookId);
          const prog = progMap.get(inv.bookId);
          return {
              filename: inv.sourceFilename || 'unknown',
              title: inv.customTitle || man?.title || 'Unknown',
              author: inv.customAuthor || man?.author || 'Unknown',
              isbn: man?.isbn,
              percentage: prog?.percentage || 0,
              lastUpdated: inv.lastInteraction,
              status: inv.status === 'completed' ? 'read' : (inv.status === 'reading' ? 'currently-reading' : 'to-read'),
              rating: inv.rating
          };
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async upsertReadingListEntry(_entry: ReadingListEntry): Promise<void> {
      Logger.warn('DBService', 'upsertReadingListEntry is deprecated in v18 architecture');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deleteReadingListEntry(_filename: string): Promise<void> {
      Logger.warn('DBService', 'deleteReadingListEntry is deprecated in v18 architecture');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async deleteReadingListEntries(_filenames: string[]): Promise<void> {
       Logger.warn('DBService', 'deleteReadingListEntries is deprecated in v18 architecture');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async importReadingList(_entries: ReadingListEntry[]): Promise<void> {
       Logger.warn('DBService', 'importReadingList is deprecated in v18 architecture');
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
  private pendingTTSPosition: { [bookId: string]: {idx: number, secIdx?: number} } = {};

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
              db.put('cache_audio_blobs', { ...segment, lastAccessed: Date.now() }).catch(() => {});
          }
          return segment;
      } catch (error) {
          this.handleError(error);
      }
  }

  async cacheSegment(key: string, audio: ArrayBuffer, alignment?: any[]): Promise<void> {
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

          return {
              bookId,
              readRanges: prog.completedRanges,
              sessions: journey.map(j => ({
                  cfiRange: j.cfiRange,
                  timestamp: j.startTimestamp,
                  type: j.type === 'tts' ? 'tts' : 'page', // Map back
                  label: undefined // Lost label unless we store it in UserJourneyStep
              })),
              lastUpdated: prog.lastRead
          };
      } catch (error) {
          this.handleError(error);
      }
  }

  async updateReadingHistory(bookId: string, newRange: string, type: ReadingEventType, _label?: string, skipSession: boolean = false): Promise<void> {
      try {
          const db = await this.getDB();
          const tx = db.transaction(['user_progress', 'user_journey'], 'readwrite');
          const progStore = tx.objectStore('user_progress');
          const journeyStore = tx.objectStore('user_journey');

          const prog = await progStore.get(bookId) || { bookId, percentage: 0, lastRead: Date.now(), completedRanges: [] };

          prog.completedRanges = mergeCfiRanges(prog.completedRanges, newRange);
          if (prog.completedRanges.length > 100) prog.completedRanges = prog.completedRanges.slice(-100);

          await progStore.put(prog);

          if (!skipSession) {
              await journeyStore.add({
                  bookId,
                  startTimestamp: Date.now(),
                  endTimestamp: Date.now(),
                  duration: 0,
                  cfiRange: newRange,
                  type: type === 'tts' ? 'tts' : 'visual'
              });
          }
          await tx.done;
      } catch (error) {
          this.handleError(error);
      }
  }

  // --- Content Analysis ---

  async saveContentAnalysis(analysis: ContentAnalysis): Promise<void> {
    try {
      const db = await this.getDB();
      await db.put('user_ai_inference', {
          id: analysis.id,
          bookId: analysis.bookId,
          sectionId: analysis.sectionId,
          semanticMap: analysis.contentTypes || [],
          accessibilityLayers: (analysis.tableAdaptations || []).map(t => ({
              type: 'table-adaptation' as const,
              rootCfi: t.rootCfi,
              content: t.text
          })),
          summary: analysis.summary,
          structure: analysis.structure,
          generatedAt: analysis.lastAnalyzed
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  async getContentAnalysis(bookId: string, sectionId: string): Promise<ContentAnalysis | undefined> {
    try {
      const db = await this.getDB();
      const ai = await db.get('user_ai_inference', `${bookId}-${sectionId}`);
      if (!ai) return undefined;

      return {
          id: ai.id,
          bookId: ai.bookId,
          sectionId: ai.sectionId,
          contentTypes: ai.semanticMap,
          tableAdaptations: ai.accessibilityLayers.filter(l => l.type === 'table-adaptation').map(l => ({
              rootCfi: l.rootCfi,
              text: l.content
          })),
          summary: ai.summary,
          structure: ai.structure || { footnoteMatches: [] },
          lastAnalyzed: ai.generatedAt
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  async saveContentClassifications(bookId: string, sectionId: string, classifications: { rootCfi: string; type: ContentType }[]): Promise<void> {
      try {
          const db = await this.getDB();
          const id = `${bookId}-${sectionId}`;
          const tx = db.transaction('user_ai_inference', 'readwrite');
          const store = tx.objectStore('user_ai_inference');

          const existing = await store.get(id) || {
              id, bookId, sectionId, semanticMap: [], accessibilityLayers: [], generatedAt: Date.now()
          };

          existing.semanticMap = classifications;
          existing.generatedAt = Date.now();

          await store.put(existing);
          await tx.done;
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
              id, bookId, sectionId, semanticMap: [], accessibilityLayers: [], generatedAt: Date.now()
          };

          // Merge layers
          const layerMap = new Map(existing.accessibilityLayers.map(l => [l.rootCfi, l]));
          for (const adp of adaptations) {
              layerMap.set(adp.rootCfi, {
                  type: 'table-adaptation' as const, // Explicit literal type
                  rootCfi: adp.rootCfi,
                  content: adp.text
              });
          }
          existing.accessibilityLayers = Array.from(layerMap.values());
          existing.generatedAt = Date.now();

          await store.put(existing);
          await tx.done;
      } catch (error) {
          this.handleError(error);
      }
  }

  async getBookAnalysis(bookId: string): Promise<ContentAnalysis[]> {
      try {
          const db = await this.getDB();
          const ais = await db.getAllFromIndex('user_ai_inference', 'by_bookId', bookId);
          return ais.map(ai => ({
              id: ai.id,
              bookId: ai.bookId,
              sectionId: ai.sectionId,
              contentTypes: ai.semanticMap,
              tableAdaptations: ai.accessibilityLayers.filter(l => l.type === 'table-adaptation').map(l => ({
                  rootCfi: l.rootCfi,
                  text: l.content
              })),
              summary: ai.summary,
              structure: ai.structure || { footnoteMatches: [] },
              lastAnalyzed: ai.generatedAt
          }));
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

  // --- TTS Content Operations ---

  async saveTTSContent(content: TTSContent): Promise<void> {
    try {
      const db = await this.getDB();
      await db.put('cache_tts_preparation', {
          id: content.id,
          bookId: content.bookId,
          sectionId: content.sectionId,
          sentences: content.sentences
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  async getTTSContent(bookId: string, sectionId: string): Promise<TTSContent | undefined> {
    try {
      const db = await this.getDB();
      const prep = await db.get('cache_tts_preparation', `${bookId}-${sectionId}`);
      if (!prep) return undefined;
      return {
          id: prep.id,
          bookId: prep.bookId,
          sectionId: prep.sectionId,
          sentences: prep.sentences
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- Table Images Operations ---

  async getTableImages(bookId: string): Promise<TableImage[]> {
      try {
          const db = await this.getDB();
          const metrics = await db.get('cache_render_metrics', bookId);

          if (!metrics || !metrics.tableSnapshots) {
              return [];
          }

          const images: TableImage[] = [];
          for (const [key, blob] of Object.entries(metrics.tableSnapshots)) {
              // Key format: `${sectionId}|${cfi}`
              const parts = key.split('|');
              if (parts.length >= 2) {
                  const sectionId = parts[0];
                  // Join rest in case CFI contained separator (unlikely but safe)
                  const cfi = parts.slice(1).join('|');

                  images.push({
                      id: `${bookId}-${cfi}`,
                      bookId,
                      sectionId,
                      cfi,
                      imageBlob: blob
                  });
              }
          }
          return images;
      } catch (error) {
          this.handleError(error);
          return [];
      }
  }

  cleanup(): void {
      if (this.saveProgressTimeout) {
          clearTimeout(this.saveProgressTimeout);
          this.saveProgressTimeout = null;
          this.pendingProgress = {};
      }
      if (this.saveTTSStateTimeout) {
          clearTimeout(this.saveTTSStateTimeout);
          this.saveTTSStateTimeout = null;
          this.pendingTTSState = {};
      }
      if (this.saveTTSPositionTimeout) {
          clearTimeout(this.saveTTSPositionTimeout);
          this.saveTTSPositionTimeout = null;
          this.pendingTTSPosition = {};
      }
  }
}

export const dbService = new DBService();
