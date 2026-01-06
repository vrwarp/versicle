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
import { CRDTService } from '../lib/crdt/CRDTService';
import { CRDT_KEYS } from '../lib/crdt/types';
import * as Y from 'yjs';

// We import the singleton instance of CRDTService.
// Note: In a real app, we might use dependency injection, but for now we'll instantiate or import it.
// Assuming we have a way to access the global CRDT service instance.
// For Phase 2A, we'll import a shared instance or create one if it doesn't exist,
// but ideally this should be passed in or accessed via a singleton pattern.
// Let's assume we can access it via a global singleton for now or pass it in.
// To keep it simple and consistent with `dbService` being a singleton, we'll instantiate it here lazily or assume usage.

// However, `CRDTService` is exported as a class.
// We need to ensure we're using the SAME instance as the rest of the app.
// Since `dbService` is a singleton exported at the bottom, we can add `crdtService` property to it.

class DBService {
  private _mode: 'legacy' | 'shadow' | 'crdt' = 'legacy';
  private crdtService: CRDTService | null = null;

  public setMode(mode: 'legacy' | 'shadow' | 'crdt') {
      this._mode = mode;
  }

  public setCRDTService(service: CRDTService) {
      this.crdtService = service;
  }

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
      // Legacy or Shadow Mode
      if (this._mode !== 'crdt') {
        const db = await this.getDB();
        const tx = db.transaction('books', 'readwrite');
        const store = tx.objectStore('books');
        const existing = await store.get(id);

        if (existing) {
          await store.put({ ...existing, ...metadata });
        }
        await tx.done;
      }

      // Shadow or CRDT Mode
      if (this._mode !== 'legacy' && this.crdtService) {
        // Yjs Update
        this.crdtService.doc.transact(() => {
             const booksMap = this.crdtService!.doc.getMap(CRDT_KEYS.BOOKS);
             if (booksMap.has(id)) {
                 const bookMap = booksMap.get(id) as any; // Y.Map<any>
                 // If it's a Y.Map
                 if (bookMap && typeof bookMap.set === 'function') {
                    Object.entries(metadata).forEach(([key, value]) => {
                         if (value !== undefined) {
                             bookMap.set(key, value);
                         }
                    });
                 }
             } else {
                 // Note: We typically don't create books here, only update.
                 // Creation usually happens in addBook (ingestion).
                 // But if we need to support creation via update:
                 // const newBookMap = new Y.Map();
                 // ... populate ...
                 // booksMap.set(id, newBookMap);
             }
        });
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
      // 1. Process EPUB and write to IDB (Heavy Layer + Metadata)
      // This returns the bookId after successfully writing to 'books' (legacy/shadow source)
      // and 'files' (heavy layer).
      const bookId = await processEpub(file, ttsOptions, onProgress);

      // 2. Shadow / CRDT Mode: Write Metadata to Yjs
      if (this._mode !== 'legacy' && this.crdtService) {
          const db = await this.getDB();
          const bookMetadata = await db.get('books', bookId);

          if (bookMetadata) {
             this.crdtService.doc.transact(() => {
                 const booksMap = this.crdtService!.doc.getMap(CRDT_KEYS.BOOKS);
                 // Create a new Y.Map for the book
                 const bookMap = new Y.Map();

                 Object.entries(bookMetadata).forEach(([key, value]) => {
                     // We skip blob fields if we want to keep CRDT light, but plan says:
                     // "Value: A child Y.Map containing BookMetadata fields."
                     // However, covers are heavy. 'coverBlob' is in BookMetadata.
                     // The plan for Phase 2A/B doesn't explicitly exclude them yet,
                     // but general CRDT best practice is to avoid large blobs.
                     // For now, we will mirror structure, but we should be careful.
                     // The 'files' store handles the EPUB binary. 'coverBlob' is usually a thumbnail.
                     // Let's include it for now to be true "Shadow" of IDB 'books' store.
                     if (value !== undefined) {
                         bookMap.set(key, value);
                     }
                 });

                 booksMap.set(bookId, bookMap);
             });
          }
      }

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

      // 1. Heavy Layer Deletion (Always performed on local DB)
      // Note: 'books' is metadata (Moral layer), but 'files' and others are Heavy layer.
      // We must handle metadata deletion according to the shunt mode.
      const heavyStores = ['files', 'locations', 'tts_queue', 'tts_position', 'content_analysis', 'tts_content', 'table_images'];

      // If mode is legacy, we include 'books', 'annotations', 'lexicon' in the transaction
      // If mode is crdt, we do NOT touch 'books', 'annotations', 'lexicon' in IndexedDB (they are in Yjs)
      // EXCEPT: 'annotations' and 'lexicon' are currently indexed by bookId in IDB.
      // Ideally in CRDT mode, we don't use IDB for them.
      // But for Phase 2A, we might still be using IDB for read?
      // "Standard stores become read-only caches or are cleared entirely."

      const storesToTransact = [...heavyStores];
      if (this._mode !== 'crdt') {
          storesToTransact.push('books', 'annotations', 'lexicon');
      } else {
          // Even in CRDT mode, we might want to clean up legacy data if it exists?
          // But if we are in CRDT mode, we assume the source of truth is Yjs.
          // However, to be safe and clean up space, we should probably delete them from IDB regardless.
          // But the plan says: "Metadata deletion in the books map follows the shunt logic."
          // "The refactored function must always call db.delete('files', id) first to free up IndexedDB space."
          // So we should delete files first.

          // Let's stick to the plan:
          // 1. Delete Heavy Assets (files, etc)
          // 2. Delete Metadata via Shunt

          // Actually, 'annotations' and 'lexicon' are Moral layer too.
          // So they should also follow the shunt logic.

          // To safely delete heavy assets regardless of mode:
          // We'll add 'books', 'annotations', 'lexicon' to the transaction ONLY if we are in legacy/shadow mode
          // OR if we want to aggressively clean up IDB even in CRDT mode.
          // Let's behave as if we are cleaning up IDB in all modes for Heavy Assets.
      }

      // We'll open a transaction for Heavy Assets first.
      const txHeavy = db.transaction(heavyStores, 'readwrite');

      await Promise.all([
          txHeavy.objectStore('files').delete(id),
          txHeavy.objectStore('locations').delete(id),
          txHeavy.objectStore('tts_queue').delete(id),
          txHeavy.objectStore('tts_position').delete(id),
      ]);

      // Heavy loop deletions
      const cleanupIndex = async (storeName: string) => {
          const store = txHeavy.objectStore(storeName);
          const index = store.index('by_bookId');
          let cursor = await index.openCursor(IDBKeyRange.only(id));
          while (cursor) {
              await cursor.delete();
              cursor = await cursor.continue();
          }
      };

      await Promise.all([
          cleanupIndex('content_analysis'),
          cleanupIndex('tts_content'),
          cleanupIndex('table_images')
      ]);

      await txHeavy.done;

      // 2. Moral Layer Deletion (Metadata, Annotations, Lexicon)

      // Legacy / Shadow Mode
      if (this._mode !== 'crdt') {
          const txMoral = db.transaction(['books', 'annotations', 'lexicon'], 'readwrite');

          await txMoral.objectStore('books').delete(id);

          // Annotations
           const annotationStore = txMoral.objectStore('annotations');
           const annotationIndex = annotationStore.index('by_bookId');
           let annotationCursor = await annotationIndex.openCursor(IDBKeyRange.only(id));
           while (annotationCursor) {
               await annotationCursor.delete();
               annotationCursor = await annotationCursor.continue();
           }

           // Lexicon
           const lexiconStore = txMoral.objectStore('lexicon');
           const lexiconIndex = lexiconStore.index('by_bookId');
           let lexiconCursor = await lexiconIndex.openCursor(IDBKeyRange.only(id));
           while (lexiconCursor) {
               await lexiconCursor.delete();
               lexiconCursor = await lexiconCursor.continue();
           }

           await txMoral.done;
      }

      // Shadow / CRDT Mode
      if (this._mode !== 'legacy' && this.crdtService) {
          this.crdtService.doc.transact(() => {
              // Delete from Books Map
              const booksMap = this.crdtService!.doc.getMap(CRDT_KEYS.BOOKS);
              if (booksMap.has(id)) {
                  booksMap.delete(id);
              }

              // Delete Annotations (Global Array filter? No, that's expensive)
              // The Y.Array is append-only for history, but for annotations we might want to delete.
              // Annotations in Yjs are in a global Y.Array<Annotation>.
              // To delete by bookId efficiently is hard.
              // However, the plan says: "annotations: Y.Array<Annotation>".
              // If we delete a book, we should probably mark annotations as deleted or filter them out.
              // Or better, iterate and delete.

              // Wait, plan says: "annotations: Y.Array<Annotation>"
              // Y.Array deletions are by index.
              // We need to iterate and find indices.
              // This is O(N).
              const annotationsArray = this.crdtService!.doc.getArray<Annotation>(CRDT_KEYS.ANNOTATIONS);
              let i = 0;
              while (i < annotationsArray.length) {
                  const ann = annotationsArray.get(i);
                  if (ann.bookId === id) {
                      annotationsArray.delete(i, 1);
                      // Do not increment i, as the array shifted
                  } else {
                      i++;
                  }
              }

              // Lexicon
              const lexiconArray = this.crdtService!.doc.getArray<LexiconRule>(CRDT_KEYS.LEXICON);
              let j = 0;
              while (j < lexiconArray.length) {
                  const rule = lexiconArray.get(j);
                  if (rule.bookId === id) {
                      lexiconArray.delete(j, 1);
                  } else {
                      j++;
                  }
              }

              // History
              const historyMap = this.crdtService!.doc.getMap(CRDT_KEYS.HISTORY);
              if (historyMap.has(id)) {
                  historyMap.delete(id);
              }

              // Transient
              const transientMap = this.crdtService!.doc.getMap(CRDT_KEYS.TRANSIENT);
              if (transientMap.has(id)) {
                  transientMap.delete(id);
              }
          });
      }

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
      const tx = db.transaction(['books', 'files'], 'readwrite');
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
   * Saves content classifications for a section.
   * Merges with existing analysis if present, or creates a new one.
   *
   * @param bookId - The book ID.
   * @param sectionId - The section ID.
   * @param classifications - The detected content types.
   */
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

  /**
   * Saves table adaptations for a section.
   * Merges with existing analysis if present, or creates a new one.
   *
   * @param bookId - The book ID.
   * @param sectionId - The section ID.
   * @param adaptations - The generated adaptations.
   */
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

  /**
   * Clears the entire content analysis cache.
   *
   * @returns A Promise that resolves when the cache is cleared.
   */
  async clearContentAnalysis(): Promise<void> {
    try {
      const db = await this.getDB();
      await db.clear('content_analysis');
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

  // --- Table Images Operations ---

  /**
   * Retrieves all table images for a book.
   *
   * @param bookId - The book ID.
   * @returns A Promise resolving to an array of TableImage objects.
   */
  async getTableImages(bookId: string): Promise<TableImage[]> {
      try {
          const db = await this.getDB();
          return await db.getAllFromIndex('table_images', 'by_bookId', bookId);
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
