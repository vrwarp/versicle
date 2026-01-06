import { getDB } from './db';
import type { BookMetadata, Annotation, CachedSegment, BookLocations, TTSState, ContentAnalysis, ReadingListEntry, ReadingHistoryEntry, ReadingSession, ReadingEventType, TTSContent, SectionMetadata, TTSPosition, TableImage } from '../types/db';
import type { ContentType } from '../types/content-analysis';
import { DatabaseError, StorageFullError } from '../types/errors';
import { processEpub, generateFileFingerprint } from '../lib/ingestion';
import { validateBookMetadata } from './validators';
import { mergeCfiRanges } from '../lib/cfi-utils';
import { Logger } from '../lib/logger';
import type { TTSQueueItem } from '../lib/tts/AudioPlayerService';
import type { ExtractionOptions } from '../lib/tts';
import { crdtService } from '../lib/crdt/CRDTService';
import * as Y from 'yjs';

export type PersistenceMode = 'legacy' | 'shadow' | 'crdt';

class DBService {
  public mode: PersistenceMode = 'legacy';

  private saveTTSStateTimeout: NodeJS.Timeout | null = null;
  private pendingTTSState: { [bookId: string]: TTSState } = {};

  private saveTTSPositionTimeout: NodeJS.Timeout | null = null;
  private pendingTTSPosition: { [bookId: string]: TTSPosition } = {};

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
      if (this.mode === 'crdt') {
        await crdtService.waitForReady();
        const booksMap = crdtService.books;
        const validBooks: BookMetadata[] = [];

        booksMap.forEach((bookMap: Y.Map<any>) => {
             const book = bookMap.toJSON() as BookMetadata;
             if (validateBookMetadata(book)) {
                 validBooks.push(book);
             } else {
                 Logger.error('DBService', 'CRDT Integrity: Found corrupted book record', book);
             }
        });

        return validBooks.sort((a, b) => b.addedAt - a.addedAt);
      }

      const db = await this.getDB();
      const books = await db.getAll('books');

      const validBooks = books.filter((book) => {
        const isValid = validateBookMetadata(book);
        if (!isValid) {
          Logger.error('DBService', 'DB Integrity: Found corrupted book record', book);
        }
        return isValid;
      });

      return validBooks.sort((a, b) => b.addedAt - a.addedAt);
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
      // NOTE: Files are ALWAYS in IndexedDB (Heavy Layer), regardless of mode.
      const db = await this.getDB();
      const file = await db.get('files', id);

      if (this.mode === 'crdt') {
           await crdtService.waitForReady();
           const bookMap = crdtService.books.get(id);
           const metadata = bookMap ? (bookMap.toJSON() as BookMetadata) : undefined;
           return { metadata, file };
      }

      const metadata = await db.get('books', id);
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
          if (this.mode === 'crdt') {
              await crdtService.waitForReady();
              const bookMap = crdtService.books.get(id);
              return bookMap ? (bookMap.toJSON() as BookMetadata) : undefined;
          }
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
      // 1. Legacy / Shadow Path (IndexedDB)
      if (this.mode === 'legacy' || this.mode === 'shadow') {
          const db = await this.getDB();
          const tx = db.transaction('books', 'readwrite');
          const store = tx.objectStore('books');
          const existing = await store.get(id);

          if (existing) {
            await store.put({ ...existing, ...metadata });
          }
          await tx.done;
      }

      // 2. Shadow / CRDT Path (Yjs)
      if (this.mode === 'shadow' || this.mode === 'crdt') {
          await crdtService.waitForReady();
          const booksMap = crdtService.books;
          const bookMap = booksMap.get(id);

          if (bookMap) {
             // In Yjs, we update individual fields in the Y.Map
             crtdTransact(() => {
                 for (const [key, value] of Object.entries(metadata)) {
                    // Note: Y.Map.set expects value, not undefined.
                    if (value !== undefined) {
                        bookMap.set(key, value);
                    }
                 }
                 // Always update lastModified? Or trust metadata has it?
                 // If not provided, we might want to set it, but usually caller provides it.
             });
          } else {
             // If missing in CRDT but we are updating it, it might be an issue.
             // In Shadow mode, we assume migration happened or we are tolerant.
             Logger.warn('DBService', `Attempted to update metadata for missing book ${id} in CRDT`);
          }
      }
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
   * Retrieves all sections for a book, ordered by playOrder.
   *
   * @param bookId - The book ID.
   * @returns A Promise resolving to an array of SectionMetadata.
   */
  async getSections(bookId: string): Promise<SectionMetadata[]> {
      try {
          const db = await this.getDB();
          const sections = await db.getAllFromIndex('sections', 'by_bookId', bookId);
          return sections.sort((a: any, b: any) => a.playOrder - b.playOrder);
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

      // 1. Heavy Layer Cleanup (Always runs)
      // We must delete from 'files' and 'table_images' etc regardless of mode.
      // We create a single transaction for all stores we want to clean.

      // Determine stores to include based on mode
      const heavyStores: any[] = ['files', 'locations', 'tts_queue', 'tts_position', 'content_analysis', 'tts_content', 'table_images'];
      const moralStores: any[] = ['books', 'annotations', 'lexicon'];

      let allStores = [...heavyStores];
      if (this.mode === 'legacy' || this.mode === 'shadow') {
          allStores = [...heavyStores, ...moralStores];
      }

      const tx = db.transaction(allStores, 'readwrite');

      // Heavy Layer deletions (Common)
      await Promise.all([
          tx.objectStore('files').delete(id),
          tx.objectStore('locations').delete(id),
          tx.objectStore('tts_queue').delete(id),
          tx.objectStore('tts_position').delete(id),
      ]);

      // Cursor deletions for heavy stores
      await this._deleteByCursor(tx, 'content_analysis', 'by_bookId', id);
      await this._deleteByCursor(tx, 'tts_content', 'by_bookId', id);
      await this._deleteByCursor(tx, 'table_images', 'by_bookId', id);

      // Moral Layer deletions (Legacy/Shadow only)
      if (this.mode === 'legacy' || this.mode === 'shadow') {
          await tx.objectStore('books').delete(id);
          await this._deleteByCursor(tx, 'annotations', 'by_bookId', id);
          await this._deleteByCursor(tx, 'lexicon', 'by_bookId', id);
      }

      await tx.done;

      // 2. CRDT Deletion (Shadow/CRDT)
      if (this.mode === 'shadow' || this.mode === 'crdt') {
          await crdtService.waitForReady();
          crtdTransact(() => {
              // Delete book metadata
              crdtService.books.delete(id);

              // Delete history
              crdtService.history.delete(id);

              // NOTE: Orphaned Annotations Risk
              // We do not currently delete annotations from the Y.Array because filtering/finding index
              // is expensive and Y.Array doesn't support key-based deletion.
              // This is a known technical debt item.
              // In future, 'annotations' should potentially be keyed by bookId in a Y.Map<Y.Array>.
          });
      }

    } catch (error) {
      this.handleError(error);
    }
  }

  private async _deleteByCursor(tx: any, storeName: string, indexName: string, key: any) {
      const store = tx.objectStore(storeName);
      const index = store.index(indexName);
      let cursor = await index.openCursor(IDBKeyRange.only(key));
      while (cursor) {
          await cursor.delete();
          cursor = await cursor.continue();
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
      // Offloading logic is tricky with CRDT because 'isOffloaded' is metadata.
      // And 'fileHash' is metadata.

      // We need to update metadata.
      // First, get the book to calc hash if needed.
      // This part reads from 'books' or CRDT?
      let book: BookMetadata | undefined;
      if (this.mode === 'crdt') {
          await crdtService.waitForReady();
          const map = crdtService.books.get(id);
          book = map ? (map.toJSON() as BookMetadata) : undefined;
      } else {
          book = await db.get('books', id);
      }

      if (!book) throw new Error('Book not found');

      // Calculate hash if missing (Requires file from IDB)
      if (!book.fileHash) {
        const fileStore = await db.transaction('files').objectStore('files');
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

      // Update Metadata
      await this.updateBookMetadata(id, { isOffloaded: true, fileHash: book.fileHash });

      // Delete file (Heavy Layer, IDB)
      const tx = db.transaction(['files'], 'readwrite');
      await tx.objectStore('files').delete(id);
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
      let book: BookMetadata | undefined;

      if (this.mode === 'crdt') {
          await crdtService.waitForReady();
          const map = crdtService.books.get(id);
          book = map ? (map.toJSON() as BookMetadata) : undefined;
      } else {
          book = await db.get('books', id);
      }

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

      const tx = db.transaction(['files'], 'readwrite');
      // Store File (Blob) instead of ArrayBuffer
      await tx.objectStore('files').put(file, id);
      await tx.done;

      // Update Metadata
      await this.updateBookMetadata(id, { isOffloaded: false, fileHash: book.fileHash });

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
              // Shunt Logic for Progress
              // 1. Legacy/Shadow (IDB)
              if (this.mode === 'legacy' || this.mode === 'shadow') {
                  const db = await this.getDB();
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

                          // Update Reading List Logic (Legacy)
                          let filename = book.filename;
                          if (!filename) {
                              try {
                                  const fileData = await fileStore.get(id);
                                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                  if (fileData instanceof File || (fileData && (fileData as any).name)) {
                                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                      filename = (fileData instanceof File) ? fileData.name : (fileData as any).name;
                                      book.filename = filename;
                                  }
                              } catch (e) {
                                  Logger.warn('DBService', 'Failed to fetch file for filename recovery', e);
                              }
                          }

                          await bookStore.put(book);

                          if (filename) {
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
              }

              // 2. Shadow/CRDT (Yjs)
              if (this.mode === 'shadow' || this.mode === 'crdt') {
                   await crdtService.waitForReady();
                   crtdTransact(() => {
                       for (const [id, data] of Object.entries(pending)) {
                           const bookMap = crdtService.books.get(id);
                           if (bookMap) {
                               bookMap.set('currentCfi', data.cfi);
                               bookMap.set('progress', data.progress);
                               bookMap.set('lastRead', Date.now());

                               // Reading List Update in CRDT
                               const filename = bookMap.get('filename') as string;
                               if (filename) {
                                   const existingEntry = crdtService.readingList.get(filename);
                                    const entry: ReadingListEntry = {
                                       filename: filename,
                                       title: bookMap.get('title') as string,
                                       author: bookMap.get('author') as string,
                                       isbn: existingEntry?.isbn,
                                       rating: existingEntry?.rating,
                                       percentage: data.progress,
                                       lastUpdated: Date.now(),
                                       status: data.progress > 0.98 ? 'read' : 'currently-reading'
                                   };
                                   crdtService.readingList.set(filename, entry);
                               }
                           }
                       }
                   });
              }

          } catch (error) {
              Logger.error('DBService', 'Failed to save progress', error);
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
      if (this.mode === 'crdt') {
          await crdtService.waitForReady();
          return Array.from(crdtService.readingList.values());
      }
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
      if (this.mode === 'legacy' || this.mode === 'shadow') {
          const db = await this.getDB();
          await db.put('reading_list', entry);
      }
      if (this.mode === 'shadow' || this.mode === 'crdt') {
          await crdtService.waitForReady();
          crdtService.readingList.set(entry.filename, entry);
      }
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
      if (this.mode === 'legacy' || this.mode === 'shadow') {
          const db = await this.getDB();
          await db.delete('reading_list', filename);
      }
      if (this.mode === 'shadow' || this.mode === 'crdt') {
          await crdtService.waitForReady();
          crdtService.readingList.delete(filename);
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  async deleteReadingListEntries(filenames: string[]): Promise<void> {
    try {
      if (this.mode === 'legacy' || this.mode === 'shadow') {
          const db = await this.getDB();
          const tx = db.transaction('reading_list', 'readwrite');
          const store = tx.objectStore('reading_list');
          await Promise.all(filenames.map(filename => store.delete(filename)));
          await tx.done;
      }
      if (this.mode === 'shadow' || this.mode === 'crdt') {
           await crdtService.waitForReady();
           crtdTransact(() => {
               filenames.forEach(f => crdtService.readingList.delete(f));
           });
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  // --- Import Reading List ---
  async importReadingList(entries: ReadingListEntry[]): Promise<void> {
       try {
          if (this.mode === 'legacy' || this.mode === 'shadow') {
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
          }

          if (this.mode === 'shadow' || this.mode === 'crdt') {
              await crdtService.waitForReady();
              crtdTransact(() => {
                  for (const entry of entries) {
                      crdtService.readingList.set(entry.filename, entry);

                      // Reconciliation with books (Reverse lookup is expensive in Yjs, skipping for Phase 2A)
                      // Ideally we would iterate all books and update progress if matching filename.
                      // Given this is an "Import" action, we assume it's a one-off.
                  }
              });
          }
      } catch (error) {
          this.handleError(error);
      }
  }

  async updatePlaybackState(bookId: string, lastPlayedCfi?: string, lastPauseTime?: number | null): Promise<void> {
      try {
          if (this.mode === 'legacy' || this.mode === 'shadow') {
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
          }
          if (this.mode === 'shadow' || this.mode === 'crdt') {
               await crdtService.waitForReady();
               const bookMap = crdtService.books.get(bookId);
               if (bookMap) {
                   crtdTransact(() => {
                       if (lastPlayedCfi !== undefined) bookMap.set('lastPlayedCfi', lastPlayedCfi);
                       if (lastPauseTime !== undefined) {
                           if (lastPauseTime === null) {
                               bookMap.delete('lastPauseTime');
                           } else {
                               bookMap.set('lastPauseTime', lastPauseTime);
                           }
                       }
                   });
               }
          }
      } catch (error) {
          this.handleError(error);
      }
  }

  async saveTTSState(bookId: string, queue: TTSQueueItem[], currentIndex: number, sectionIndex?: number): Promise<void> {
      // Legacy implementation for now
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
      }, 1000);
  }

  async saveTTSPosition(bookId: string, currentIndex: number, sectionIndex?: number): Promise<void> {
      // Legacy
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
      }, 500);
  }

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

  async addAnnotation(annotation: Annotation): Promise<void> {
    try {
      if (this.mode === 'legacy' || this.mode === 'shadow') {
          const db = await this.getDB();
          await db.put('annotations', annotation);
      }
      if (this.mode === 'shadow' || this.mode === 'crdt') {
          await crdtService.waitForReady();
          crdtService.annotations.push([annotation]);
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  async getAnnotations(bookId: string): Promise<Annotation[]> {
    try {
      if (this.mode === 'crdt') {
          await crdtService.waitForReady();
          // Filter annotations by bookId (inefficient in Y.Array, but that's the schema)
          return crdtService.annotations.toArray().filter((a: Annotation) => a.bookId === bookId);
      }
      const db = await this.getDB();
      return await db.getAllFromIndex('annotations', 'by_bookId', bookId);
    } catch (error) {
      this.handleError(error);
    }
  }

  async deleteAnnotation(id: string): Promise<void> {
      try {
          if (this.mode === 'legacy' || this.mode === 'shadow') {
              const db = await this.getDB();
              await db.delete('annotations', id);
          }
          if (this.mode === 'shadow' || this.mode === 'crdt') {
              await crdtService.waitForReady();
              // Delete from Y.Array requires finding index.
              const index = crdtService.annotations.toArray().findIndex((a: Annotation) => a.id === id);
              if (index !== -1) {
                  crdtService.annotations.delete(index, 1);
              }
          }
      } catch (error) {
          this.handleError(error);
      }
  }

  async getCachedSegment(key: string): Promise<CachedSegment | undefined> {
      try {
          const db = await this.getDB();
          const segment = await db.get('tts_cache', key);
          if (segment) {
              db.put('tts_cache', { ...segment, lastAccessed: Date.now() }).catch((err) => Logger.error('DBService', 'Failed to update TTS cache lastAccessed', err));
          }
          return segment;
      } catch (error) {
          this.handleError(error);
      }
  }

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

  async getLocations(bookId: string): Promise<BookLocations | undefined> {
      try {
          const db = await this.getDB();
          return await db.get('locations', bookId);
      } catch (error) {
          this.handleError(error);
      }
  }

  async saveLocations(bookId: string, locations: string): Promise<void> {
      try {
          const db = await this.getDB();
          await db.put('locations', { bookId, locations });
      } catch (error) {
          this.handleError(error);
      }
  }

  async getReadingHistory(bookId: string): Promise<string[]> {
      try {
          if (this.mode === 'crdt') {
              await crdtService.waitForReady();
              const hist = crdtService.history.get(bookId);
              return hist ? hist.toArray() : [];
          }
          const db = await this.getDB();
          const entry = await db.get('reading_history', bookId);
          return entry ? entry.readRanges : [];
      } catch (error) {
          this.handleError(error);
      }
  }

  async getReadingHistoryEntry(bookId: string): Promise<ReadingHistoryEntry | undefined> {
      try {
          const db = await this.getDB();
          return await db.get('reading_history', bookId);
      } catch (error) {
          this.handleError(error);
      }
  }

  async updateReadingHistory(bookId: string, newRange: string, type: ReadingEventType, label?: string, skipSession: boolean = false): Promise<void> {
      try {
          if (this.mode === 'legacy' || this.mode === 'shadow') {
              // ... existing logic ...
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

              if (updatedRanges.length > 100) {
                  updatedRanges = updatedRanges.slice(updatedRanges.length - 100);
              }

              if (!skipSession) {
                  const newTimestamp = Date.now();
                  const lastSession = sessions.length > 0 ? sessions[sessions.length - 1] : null;

                  let shouldCoalesce = false;

                  if (lastSession && lastSession.type === type && type !== 'tts') {
                       const timeDiff = newTimestamp - lastSession.timestamp;
                       if (timeDiff < 300000) {
                           shouldCoalesce = true;
                       }
                  }

                  if (shouldCoalesce && lastSession) {
                      lastSession.cfiRange = newRange;
                      lastSession.timestamp = newTimestamp;
                      if (label) lastSession.label = label;
                      sessions[sessions.length - 1] = lastSession;
                  } else {
                      const newSession: ReadingSession = {
                          cfiRange: newRange,
                          timestamp: newTimestamp,
                          type: type,
                          label: label
                      };
                      sessions.push(newSession);
                  }

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
          }

          if (this.mode === 'shadow' || this.mode === 'crdt') {
               await crdtService.waitForReady();
               crtdTransact(() => {
                   let hist = crdtService.history.get(bookId);
                   if (!hist) {
                       hist = new Y.Array<string>();
                       crdtService.history.set(bookId, hist);
                   }
                   // Simply push the new range.
                   // NOTE: The legacy logic merges and coalesces.
                   // The Plan for Phase 2D.1 says: "Legacy data must be passed through mergeCfiRanges... A user might have 1000 small scroll sessions... compress... before enter CRDT log."
                   // Here we are pushing live updates.
                   // If we just push `newRange` every time, we bloat the CRDT.
                   // Ideally we should do intelligent updating (delete old range, add new merged range?)
                   // But `mergeCfiRanges` returns a list of disjoint ranges.

                   // For now, in Shadow mode, just pushing is safer to avoid logic bugs,
                   // BUT for 1:1 parity, we might want to replicate the merge logic.
                   // However, Y.Array operations are append-only mostly for sync.
                   // If we constantly replace the array, it might be weird.
                   // The plan says: "history... Array of CFI strings. If Device A adds Range1... Yjs array simply contains both. A computed getter... will merge."
                   // So we SHOULD just push the raw range?
                   // "A user might have 1,000 small "scroll" sessions. We should compress these into unified ranges *before* they enter the permanent CRDT log."

                   // This implies we should debounce or coalesce locally before pushing.
                   // The `updateReadingHistory` is called often?
                   // No, `updateReadingHistory` is called by `Reader` on pause/leave or periodically?
                   // Actually `saveProgress` is the high freq one. `updateReadingHistory` is for "Sessions".

                   // TECH DEBT: Unbounded History Growth.
                   // In CRDT mode, we are currently appending every new range to the Y.Array.
                   // This differs from the legacy implementation which merges ranges (mergeCfiRanges) and coalesces sessions.
                   // This will lead to unbounded growth of the history array over time.
                   // Resolution: Implement a coalescing strategy that respects CRDT convergence (e.g., periodic compaction or smarter append logic).
                   hist.push([newRange]);
               });
          }
      } catch (error) {
          this.handleError(error);
      }
  }

  async saveContentAnalysis(analysis: ContentAnalysis): Promise<void> {
    try {
      const db = await this.getDB();
      await db.put('content_analysis', analysis);
    } catch (error) {
      this.handleError(error);
    }
  }

  async getContentAnalysis(bookId: string, sectionId: string): Promise<ContentAnalysis | undefined> {
    try {
      const db = await this.getDB();
      return await db.get('content_analysis', `${bookId}-${sectionId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  async saveContentClassifications(bookId: string, sectionId: string, classifications: { rootCfi: string; type: ContentType }[]): Promise<void> {
      try {
          const db = await this.getDB();
          const tx = db.transaction('content_analysis', 'readwrite');
          const store = tx.objectStore('content_analysis');
          const id = `${bookId}-${sectionId}`;
          const existing = await store.get(id);

          const analysis: ContentAnalysis = existing || {
              id,
              bookId,
              sectionId,
              structure: { footnoteMatches: [] }, // Default empty structure
              lastAnalyzed: Date.now()
          };

          analysis.contentTypes = classifications;
          analysis.lastAnalyzed = Date.now();

          await store.put(analysis);
          await tx.done;
      } catch (error) {
          this.handleError(error);
      }
  }

  async saveTableAdaptations(bookId: string, sectionId: string, adaptations: { rootCfi: string; text: string }[]): Promise<void> {
      try {
          const db = await this.getDB();
          const tx = db.transaction('content_analysis', 'readwrite');
          const store = tx.objectStore('content_analysis');
          const id = `${bookId}-${sectionId}`;
          const existing = await store.get(id);

          const analysis: ContentAnalysis = existing || {
              id,
              bookId,
              sectionId,
              structure: { footnoteMatches: [] },
              lastAnalyzed: Date.now()
          };

          // Merge with existing adaptations
          const existingAdaptations = analysis.tableAdaptations || [];
          const newAdaptationsMap = new Map(existingAdaptations.map(a => [a.rootCfi, a]));

          for (const adaptation of adaptations) {
              newAdaptationsMap.set(adaptation.rootCfi, adaptation);
          }

          analysis.tableAdaptations = Array.from(newAdaptationsMap.values());
          analysis.lastAnalyzed = Date.now();

          await store.put(analysis);
          await tx.done;
      } catch (error) {
          this.handleError(error);
      }
  }

  async getBookAnalysis(bookId: string): Promise<ContentAnalysis[]> {
      try {
          const db = await this.getDB();
          return await db.getAllFromIndex('content_analysis', 'by_bookId', bookId);
      } catch (error) {
          this.handleError(error);
      }
  }

  async clearContentAnalysis(): Promise<void> {
    try {
      const db = await this.getDB();
      await db.clear('content_analysis');
    } catch (error) {
      this.handleError(error);
    }
  }

  async saveTTSContent(content: TTSContent): Promise<void> {
    try {
      const db = await this.getDB();
      await db.put('tts_content', content);
    } catch (error) {
      this.handleError(error);
    }
  }

  async getTTSContent(bookId: string, sectionId: string): Promise<TTSContent | undefined> {
    try {
      const db = await this.getDB();
      return await db.get('tts_content', `${bookId}-${sectionId}`);
    } catch (error) {
      this.handleError(error);
    }
  }

  async getTableImages(bookId: string): Promise<TableImage[]> {
      try {
          const db = await this.getDB();
          return await db.getAllFromIndex('table_images', 'by_bookId', bookId);
      } catch (error) {
          this.handleError(error);
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

// Helper for transactions
function crtdTransact(callback: () => void) {
    crdtService.doc.transact(callback);
}

export const dbService = new DBService();
