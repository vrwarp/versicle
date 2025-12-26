import { getDB } from './db';
import type { BookMetadata, Annotation, CachedSegment, BookLocations, TTSState, ContentAnalysis, ReadingListEntry, ReadingHistoryEntry, ReadingSession, ReadingEventType, TTSContent, SectionMetadata, TTSPosition } from '../types/db';
import { DatabaseError, StorageFullError } from '../types/errors';
import { processEpub, generateFileFingerprint } from '../lib/ingestion';
import { validateBookMetadata } from './validators';
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
   *
   * @returns A Promise resolving to an array of valid BookMetadata objects.
   */
  async getLibrary(): Promise<BookMetadata[]> {
    try {
      const db = await this.getDB();
      const books = await db.getAll('books');

      const validBooks = books.filter((book) => {
        const isValid = validateBookMetadata(book);
        if (!isValid) {
          Logger.error('DBService', 'DB Integrity: Found corrupted book record', book);
        }
        return isValid;
      });

      return validBooks.sort((a, b) => {
        // Sort by lastRead descending (most recent first)
        // If lastRead is undefined, it is treated as older than any timestamp
        const lastReadA = a.lastRead || 0;
        const lastReadB = b.lastRead || 0;
        if (lastReadA !== lastReadB) {
            return lastReadB - lastReadA;
        }
        // Fallback to addedAt descending
        return b.addedAt - a.addedAt;
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves a specific book and its file content.
   *
   * @param id - The unique identifier of the book.
   * @returns A Promise resolving to an object containing metadata and file content.
   */
  async getBook(id: string): Promise<{ metadata: BookMetadata | undefined; file: Blob | ArrayBuffer | undefined }> {
    try {
      const db = await this.getDB();
      const metadata = await db.get('books', id);
      const file = await db.get('files', id);
      return { metadata, file };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves only the metadata for a specific book.
   *
   * @param id - The unique identifier of the book.
   * @returns A Promise resolving to the BookMetadata or undefined if not found.
   */
  async getBookMetadata(id: string): Promise<BookMetadata | undefined> {
      try {
          const db = await this.getDB();
          return await db.get('books', id);
      } catch (error) {
          this.handleError(error);
      }
  }

  /**
   * Updates only the metadata for a specific book.
   *
   * @param id - The unique identifier of the book.
   * @param metadata - The partial metadata to update.
   */
  async updateBookMetadata(id: string, metadata: Partial<BookMetadata>): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('books', 'readwrite');
      const store = tx.objectStore('books');
      const existing = await store.get(id);

      if (existing) {
        await store.put({ ...existing, ...metadata });
      }
      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves the file content for a specific book.
   *
   * @param id - The unique identifier of the book.
   * @returns A Promise resolving to the file content (Blob or ArrayBuffer) or undefined.
   */
  async getBookFile(id: string): Promise<Blob | ArrayBuffer | undefined> {
      try {
          const db = await this.getDB();
          return await db.get('files', id);
      } catch (error) {
          this.handleError(error);
      }
  }

  /**
   * Retrieves the high-resolution cover image for a specific book.
   *
   * @param id - The unique identifier of the book.
   * @returns A Promise resolving to the cover Blob or undefined.
   */
  async getCover(id: string): Promise<Blob | undefined> {
      try {
          const db = await this.getDB();
          return await db.get('covers', id);
      } catch (error) {
          this.handleError(error);
      }
  }

  /**
   * Retrieves all sections for a book, ordered by playOrder.
   *
   * @param bookId - The book ID.
   * @returns A Promise resolving to an array of SectionMetadata.
   */
  async getSections(bookId: string): Promise<SectionMetadata[]> {
      try {
          const db = await this.getDB();
          const sections = await db.getAllFromIndex('sections', 'by_bookId', bookId);
          return sections.sort((a, b) => a.playOrder - b.playOrder);
      } catch (error) {
          this.handleError(error);
      }
  }

  /**
   * Adds a new book to the library.
   *
   * @param file - The EPUB file to add.
   * @param ttsOptions - Optional TTS extraction settings.
   * @returns A Promise that resolves when the book is added.
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
   * Deletes a book and all associated data (files, annotations, etc.) from the library.
   *
   * @param id - The unique identifier of the book to delete.
   * @returns A Promise that resolves when the book is deleted.
   */
  async deleteBook(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['books', 'files', 'annotations', 'locations', 'lexicon', 'tts_queue', 'tts_position', 'content_analysis', 'tts_content', 'covers'], 'readwrite');

      await Promise.all([
          tx.objectStore('books').delete(id),
          tx.objectStore('files').delete(id),
          tx.objectStore('covers').delete(id),
          tx.objectStore('locations').delete(id),
          tx.objectStore('tts_queue').delete(id),
          tx.objectStore('tts_position').delete(id),
      ]);

      // Delete annotations
      const annotationStore = tx.objectStore('annotations');
      const annotationIndex = annotationStore.index('by_bookId');
      let annotationCursor = await annotationIndex.openCursor(IDBKeyRange.only(id));
      while (annotationCursor) {
        await annotationCursor.delete();
        annotationCursor = await annotationCursor.continue();
      }

      // Delete lexicon rules
      const lexiconStore = tx.objectStore('lexicon');
      const lexiconIndex = lexiconStore.index('by_bookId');
      let lexiconCursor = await lexiconIndex.openCursor(IDBKeyRange.only(id));
      while (lexiconCursor) {
        await lexiconCursor.delete();
        lexiconCursor = await lexiconCursor.continue();
      }

      // Delete content analysis
      const analysisStore = tx.objectStore('content_analysis');
      const analysisIndex = analysisStore.index('by_bookId');
      let analysisCursor = await analysisIndex.openCursor(IDBKeyRange.only(id));
      while (analysisCursor) {
        await analysisCursor.delete();
        analysisCursor = await analysisCursor.continue();
      }

      // Delete TTS content
      const ttsContentStore = tx.objectStore('tts_content');
      const ttsContentIndex = ttsContentStore.index('by_bookId');
      let ttsContentCursor = await ttsContentIndex.openCursor(IDBKeyRange.only(id));
      while (ttsContentCursor) {
        await ttsContentCursor.delete();
        ttsContentCursor = await ttsContentCursor.continue();
      }

      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Offloads a book's file content to save space, keeping metadata and user data.
   *
   * @param id - The unique identifier of the book to offload.
   * @returns A Promise that resolves when the book is offloaded.
   */
  async offloadBook(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['books', 'files', 'covers'], 'readwrite');
      const bookStore = tx.objectStore('books');
      const book = await bookStore.get(id);

      if (!book) throw new Error('Book not found');

      // If missing hash, calculate fingerprint from existing file before deleting
      if (!book.fileHash) {
        const fileStore = tx.objectStore('files');
        const fileData = await fileStore.get(id);
        if (fileData) {
          const blob = fileData instanceof Blob ? fileData : new Blob([fileData]);
          book.fileHash = await generateFileFingerprint(blob, {
            title: book.title,
            author: book.author,
            filename: book.filename || 'unknown.epub'
          });
        }
      }

      book.isOffloaded = true;
      await bookStore.put(book);
      await tx.objectStore('files').delete(id);

      // Delete high-res cover; metadata thumbnail remains.
      await tx.objectStore('covers').delete(id);

      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Restores an offloaded book using a provided file.
   * Verifies the file hash against the stored hash.
   *
   * @param id - The unique identifier of the book to restore.
   * @param file - The EPUB file to restore from.
   * @returns A Promise that resolves when the book is restored.
   */
  async restoreBook(id: string, file: File): Promise<void> {
    try {
      const db = await this.getDB();
      const book = await db.get('books', id);

      if (!book) throw new Error('Book not found');

      const newFingerprint = await generateFileFingerprint(file, {
        title: book.title,
        author: book.author,
        filename: file.name
      });

      if (book.fileHash && book.fileHash !== newFingerprint) {
        throw new Error('File verification failed: Fingerprint mismatch.');
      } else if (!book.fileHash) {
        // If hash was missing, we accept the file and set the hash
        book.fileHash = newFingerprint;
      }

      const tx = db.transaction(['books', 'files'], 'readwrite');
      // Store File (Blob) instead of ArrayBuffer
      await tx.objectStore('files').put(file, id);

      book.isOffloaded = false;
      await tx.objectStore('books').put(book);
      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- Progress Operations ---

  private saveProgressTimeout: NodeJS.Timeout | null = null;
  private pendingProgress: { [key: string]: { cfi: string; progress: number } } = {};

  /**
   * Saves reading progress. Debounced to prevent frequent DB writes.
   *
   * @param bookId - The unique identifier of the book.
   * @param cfi - The Canonical Fragment Identifier (CFI) representing the current location.
   * @param progress - The progress percentage (0.0 to 1.0).
   */
  saveProgress(bookId: string, cfi: string, progress: number): void {
      this.pendingProgress[bookId] = { cfi, progress };

      if (this.saveProgressTimeout) return;

      this.saveProgressTimeout = setTimeout(async () => {
          this.saveProgressTimeout = null;
          const pending = { ...this.pendingProgress };
          this.pendingProgress = {};

          try {
              const db = await this.getDB();
              // Include 'reading_list' and 'files' in the transaction
              const tx = db.transaction(['books', 'reading_list', 'files'], 'readwrite');
              const bookStore = tx.objectStore('books');
              const rlStore = tx.objectStore('reading_list');
              const fileStore = tx.objectStore('files');

              for (const [id, data] of Object.entries(pending)) {
                  const book = await bookStore.get(id);
                  if (book) {
                      book.currentCfi = data.cfi;
                      book.progress = data.progress;
                      book.lastRead = Date.now();

                      // Update Reading List Logic
                      let filename = book.filename;
                      if (!filename) {
                          // Try to recover filename from file store if missing
                          try {
                              const fileData = await fileStore.get(id);
                              // Check if it's a File or has a name property (fake-indexeddb might strip prototype)
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              if (fileData instanceof File || (fileData && (fileData as any).name)) {
                                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                  filename = (fileData instanceof File) ? fileData.name : (fileData as any).name;
                                  book.filename = filename; // Update book metadata
                              }
                          } catch (e) {
                              // Ignore file fetch errors
                              Logger.warn('DBService', 'Failed to fetch file for filename recovery', e);
                          }
                      }

                      await bookStore.put(book);

                      if (filename) {
                           // Fetch existing entry to preserve fields like rating/isbn that aren't in book metadata
                           const existingEntry = await rlStore.get(filename);

                           const entry: ReadingListEntry = {
                               filename: filename,
                               title: book.title,
                               author: book.author,
                               isbn: existingEntry?.isbn,
                               rating: existingEntry?.rating,
                               percentage: data.progress,
                               lastUpdated: Date.now(),
                               status: data.progress > 0.98 ? 'read' : 'currently-reading'
                           };
                           await rlStore.put(entry);
                      }
                  }
              }
              await tx.done;
          } catch (error) {
              Logger.error('DBService', 'Failed to save progress', error);
              // We don't throw here to avoid interrupting the user flow,
              // but we might want to surface this via a global error handler eventually.
          }
      }, 1000); // 1 second debounce
  }

  // --- Reading List Operations ---

  /**
   * Retrieves all entries in the reading list.
   *
   * @returns A Promise resolving to an array of ReadingListEntry objects.
   */
  async getReadingList(): Promise<ReadingListEntry[]> {
    try {
      const db = await this.getDB();
      return await db.getAll('reading_list');
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Updates or adds a reading list entry.
   *
   * @param entry - The reading list entry to upsert.
   */
  async upsertReadingListEntry(entry: ReadingListEntry): Promise<void> {
    try {
      const db = await this.getDB();
      await db.put('reading_list', entry);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Deletes a reading list entry.
   *
   * @param filename - The filename of the entry to delete.
   */
  async deleteReadingListEntry(filename: string): Promise<void> {
    try {
      const db = await this.getDB();
      await db.delete('reading_list', filename);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Deletes multiple reading list entries.
   *
   * @param filenames - The filenames of the entries to delete.
   */
  async deleteReadingListEntries(filenames: string[]): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction('reading_list', 'readwrite');
      const store = tx.objectStore('reading_list');

      await Promise.all(filenames.map(filename => store.delete(filename)));
      await tx.done;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Imports reading list entries and syncs progress to books.
   *
   * @param entries - The list of entries to import.
   */
  async importReadingList(entries: ReadingListEntry[]): Promise<void> {
      try {
          const db = await this.getDB();
          const tx = db.transaction(['reading_list', 'books'], 'readwrite');
          const rlStore = tx.objectStore('reading_list');
          const bookStore = tx.objectStore('books');

          // 1. Bulk upsert to reading_list
          for (const entry of entries) {
              await rlStore.put(entry);
          }

          // 2. Reconciliation with books
          let cursor = await bookStore.openCursor();
          while (cursor) {
              const book = cursor.value;
              if (book.filename) {
                  const rlEntry = await rlStore.get(book.filename);
                  if (rlEntry) {
                      if (rlEntry.percentage > (book.progress || 0)) {
                          book.progress = rlEntry.percentage;
                          book.lastRead = Date.now();
                          cursor.update(book);
                      }
                  }
              }
              cursor = await cursor.continue();
          }

          await tx.done;
      } catch (error) {
          this.handleError(error);
      }
  }

  /**
   * Updates the last playback state for a book.
   *
   * @param bookId - The unique identifier of the book.
   * @param lastPlayedCfi - Optional CFI of the last played segment.
   * @param lastPauseTime - Optional timestamp of when playback was paused.
   * @returns A Promise that resolves when the state is updated.
   */
  async updatePlaybackState(bookId: string, lastPlayedCfi?: string, lastPauseTime?: number | null): Promise<void> {
      try {
          const db = await this.getDB();
          const tx = db.transaction('books', 'readwrite');
          const store = tx.objectStore('books');
          const book = await store.get(bookId);
          if (book) {
              if (lastPlayedCfi !== undefined) book.lastPlayedCfi = lastPlayedCfi;
              if (lastPauseTime !== undefined) book.lastPauseTime = lastPauseTime === null ? undefined : lastPauseTime;
              await store.put(book);
          }
          await tx.done;
      } catch (error) {
          this.handleError(error);
      }
  }

  // --- TTS State Operations ---

  private saveTTSStateTimeout: NodeJS.Timeout | null = null;
  private pendingTTSState: { [bookId: string]: TTSState } = {};

  private saveTTSPositionTimeout: NodeJS.Timeout | null = null;
  private pendingTTSPosition: { [bookId: string]: TTSPosition } = {};

  /**
   * Saves TTS Queue and Index. Debounced.
   *
   * @param bookId - The unique identifier of the book.
   * @param queue - The current TTS queue.
   * @param currentIndex - The index of the currently playing item.
   * @param sectionIndex - The index of the current section in the playlist (optional).
   */
  saveTTSState(bookId: string, queue: TTSQueueItem[], currentIndex: number, sectionIndex?: number): void {
      this.pendingTTSState[bookId] = {
          bookId,
          queue,
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
              const tx = db.transaction('tts_queue', 'readwrite');
              const store = tx.objectStore('tts_queue');

              for (const state of Object.values(pending)) {
                  await store.put(state);
              }
              await tx.done;
          } catch (error) {
              Logger.error('DBService', 'Failed to save TTS state', error);
          }
      }, 1000); // 1s debounce
  }

  /**
   * Saves only the TTS playback position (lightweight).
   * Debounced separately to allow more frequent updates without heavy serialization.
   *
   * @param bookId - The unique identifier of the book.
   * @param currentIndex - The current index in the queue.
   * @param sectionIndex - The index of the current section in the playlist (optional).
   */
  saveTTSPosition(bookId: string, currentIndex: number, sectionIndex?: number): void {
      this.pendingTTSPosition[bookId] = {
          bookId,
          currentIndex,
          sectionIndex,
          updatedAt: Date.now()
      };

      if (this.saveTTSPositionTimeout) return;

      this.saveTTSPositionTimeout = setTimeout(async () => {
          this.saveTTSPositionTimeout = null;
          const pending = { ...this.pendingTTSPosition };
          this.pendingTTSPosition = {};

          try {
              const db = await this.getDB();
              const tx = db.transaction('tts_position', 'readwrite');
              const store = tx.objectStore('tts_position');

              for (const position of Object.values(pending)) {
                  await store.put(position);
              }
              await tx.done;
          } catch (error) {
              Logger.error('DBService', 'Failed to save TTS position', error);
          }
      }, 500); // 500ms debounce
  }

  /**
   * Retrieves the saved TTS state for a book.
   * Merges data from both `tts_queue` and `tts_position` stores.
   *
   * @param bookId - The unique identifier of the book.
   * @returns A Promise resolving to the TTSState or undefined.
   */
  async getTTSState(bookId: string): Promise<TTSState | undefined> {
      try {
          const db = await this.getDB();
          const state = await db.get('tts_queue', bookId);
          const position = await db.get('tts_position', bookId);

          if (state && position && position.updatedAt > state.updatedAt) {
              return {
                  ...state,
                  currentIndex: position.currentIndex,
                  sectionIndex: position.sectionIndex !== undefined ? position.sectionIndex : state.sectionIndex
              };
          }

          return state;
      } catch (error) {
          this.handleError(error);
      }
  }

  // --- Annotation Operations ---

  /**
   * Adds a new annotation to the database.
   *
   * @param annotation - The annotation object to add.
   * @returns A Promise that resolves when the annotation is saved.
   */
  async addAnnotation(annotation: Annotation): Promise<void> {
    try {
      const db = await this.getDB();
      await db.put('annotations', annotation);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves all annotations for a specific book.
   *
   * @param bookId - The unique identifier of the book.
   * @returns A Promise resolving to an array of Annotation objects.
   */
  async getAnnotations(bookId: string): Promise<Annotation[]> {
    try {
      const db = await this.getDB();
      return await db.getAllFromIndex('annotations', 'by_bookId', bookId);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Deletes an annotation by its ID.
   *
   * @param id - The unique identifier of the annotation.
   * @returns A Promise that resolves when the annotation is deleted.
   */
  async deleteAnnotation(id: string): Promise<void> {
      try {
          const db = await this.getDB();
          await db.delete('annotations', id);
      } catch (error) {
          this.handleError(error);
      }
  }

  // --- TTS Cache Operations ---

  /**
   * Retrieves a cached TTS segment.
   *
   * @param key - The cache key.
   * @returns A Promise resolving to the CachedSegment or undefined.
   */
  async getCachedSegment(key: string): Promise<CachedSegment | undefined> {
      try {
          const db = await this.getDB();
          const segment = await db.get('tts_cache', key);

          if (segment) {
              // Fire and forget update to lastAccessed
              // We don't await this to keep read fast
              db.put('tts_cache', { ...segment, lastAccessed: Date.now() }).catch((err) => Logger.error('DBService', 'Failed to update TTS cache lastAccessed', err));
          }
          return segment;
      } catch (error) {
          this.handleError(error);
      }
  }

  /**
   * Caches a TTS segment.
   *
   * @param key - The cache key.
   * @param audio - The audio data.
   * @param alignment - Optional alignment data.
   * @returns A Promise that resolves when the segment is cached.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async cacheSegment(key: string, audio: ArrayBuffer, alignment?: any[]): Promise<void> {
      try {
          const db = await this.getDB();
          const segment: CachedSegment = {
              key,
              audio,
              alignment,
              createdAt: Date.now(),
              lastAccessed: Date.now(),
          };
          await db.put('tts_cache', segment);
      } catch (error) {
          this.handleError(error);
      }
  }

  // --- Locations ---

  /**
   * Retrieves stored locations for a book.
   *
   * @param bookId - The unique identifier of the book.
   * @returns A Promise resolving to the BookLocations object or undefined.
   */
  async getLocations(bookId: string): Promise<BookLocations | undefined> {
      try {
          const db = await this.getDB();
          return await db.get('locations', bookId);
      } catch (error) {
          this.handleError(error);
      }
  }

  /**
   * Saves generated locations for a book.
   *
   * @param bookId - The unique identifier of the book.
   * @param locations - The locations string (JSON).
   * @returns A Promise that resolves when the locations are saved.
   */
  async saveLocations(bookId: string, locations: string): Promise<void> {
      try {
          const db = await this.getDB();
          await db.put('locations', { bookId, locations });
      } catch (error) {
          this.handleError(error);
      }
  }

  // --- Reading History Operations ---

  /**
   * Retrieves the reading history for a book.
   *
   * @param bookId - The unique identifier of the book.
   * @returns A Promise resolving to an array of CFI ranges.
   */
  async getReadingHistory(bookId: string): Promise<string[]> {
      try {
          const db = await this.getDB();
          const entry = await db.get('reading_history', bookId);
          return entry ? entry.readRanges : [];
      } catch (error) {
          this.handleError(error);
      }
  }

  /**
   * Retrieves the full reading history entry for a book.
   *
   * @param bookId - The unique identifier of the book.
   * @returns A Promise resolving to the ReadingHistoryEntry or undefined.
   */
  async getReadingHistoryEntry(bookId: string): Promise<ReadingHistoryEntry | undefined> {
      try {
          const db = await this.getDB();
          return await db.get('reading_history', bookId);
      } catch (error) {
          this.handleError(error);
      }
  }

  /**
   * Updates the reading history for a book by merging a new range.
   *
   * @param bookId - The unique identifier of the book.
   * @param newRange - The new CFI range to add.
   * @param type - The source of the reading event.
   * @param label - Optional contextual label.
   * @returns A Promise that resolves when the history is updated.
   */
  async updateReadingHistory(bookId: string, newRange: string, type: ReadingEventType, label?: string, skipSession: boolean = false): Promise<void> {
      try {
          const db = await this.getDB();
          const tx = db.transaction('reading_history', 'readwrite');
          const store = tx.objectStore('reading_history');
          const entry = await store.get(bookId);

          let readRanges: string[] = [];
          let sessions: ReadingSession[] = [];

          if (entry) {
              readRanges = entry.readRanges;
              if (entry.sessions) {
                  sessions = entry.sessions;
              }
          }

          let updatedRanges = mergeCfiRanges(readRanges, newRange);

          // Enforce limit on history size to prevent unbounded growth
          if (updatedRanges.length > 100) {
              updatedRanges = updatedRanges.slice(updatedRanges.length - 100);
          }

          if (!skipSession) {
              // Coalescing Logic
              const newTimestamp = Date.now();
              const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;

              let shouldCoalesce = false;

              if (lastSession && lastSession.type === type && type !== 'tts') {
                   const timeDiff = newTimestamp - lastSession.timestamp;
                   // 5 minutes = 300,000 ms
                   if (timeDiff < 300000) {
                       shouldCoalesce = true;
                   }
              }

              if (shouldCoalesce && lastSession) {
                  // Update last session
                  lastSession.cfiRange = newRange;
                  lastSession.timestamp = newTimestamp;
                  if (label) lastSession.label = label;

                  // Update in array
                  sessions[sessions.length - 1] = lastSession;
              } else {
                  // Add new session
                  const newSession: ReadingSession = {
                      cfiRange: newRange,
                      timestamp: newTimestamp,
                      type: type,
                      label: label
                  };
                  sessions.push(newSession);
              }

              // Limit sessions size too
              if (sessions.length > 100) {
                 sessions = sessions.slice(sessions.length - 100);
              }
          }

          await store.put({
              bookId,
              readRanges: updatedRanges,
              sessions,
              lastUpdated: Date.now()
          });
          await tx.done;
      } catch (error) {
          this.handleError(error);
      }
  }

  // --- Content Analysis ---

  /**
   * Saves content analysis results.
   *
   * @param analysis - The analysis object to save.
   * @returns A Promise that resolves when the analysis is saved.
   */
  async saveContentAnalysis(analysis: ContentAnalysis): Promise<void> {
    try {
      const db = await this.getDB();
      await db.put('content_analysis', analysis);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves content analysis for a specific section.
   *
   * @param bookId - The book ID.
   * @param sectionId - The section ID.
   * @returns A Promise resolving to the ContentAnalysis or undefined.
   */
  async getContentAnalysis(bookId: string, sectionId: string): Promise<ContentAnalysis | undefined> {
    try {
      const db = await this.getDB();
      return await db.get('content_analysis', `${bookId}-${sectionId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves all content analysis entries for a book.
   *
   * @param bookId - The book ID.
   * @returns A Promise resolving to an array of ContentAnalysis objects.
   */
  async getBookAnalysis(bookId: string): Promise<ContentAnalysis[]> {
      try {
          const db = await this.getDB();
          return await db.getAllFromIndex('content_analysis', 'by_bookId', bookId);
      } catch (error) {
          this.handleError(error);
      }
  }

  // --- Lexicon ---
  // Adding minimal support for lexicon to match removeBook requirements,
  // full service migration for LexiconManager can be done later or added here if needed.

  // --- TTS Content Operations ---

  /**
   * Saves extracted TTS content for a section.
   *
   * @param content - The TTS content to save.
   * @returns A Promise that resolves when the content is saved.
   */
  async saveTTSContent(content: TTSContent): Promise<void> {
    try {
      const db = await this.getDB();
      await db.put('tts_content', content);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Retrieves extracted TTS content for a specific section.
   *
   * @param bookId - The book ID.
   * @param sectionId - The section ID.
   * @returns A Promise resolving to the TTSContent or undefined.
   */
  async getTTSContent(bookId: string, sectionId: string): Promise<TTSContent | undefined> {
    try {
      const db = await this.getDB();
      return await db.get('tts_content', `${bookId}-${sectionId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Cleans up any pending operations/timeouts.
   * Call this before deleting the database or when shutting down the service.
   */
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
