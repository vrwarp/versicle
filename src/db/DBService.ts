import { getDB, type EpubLibraryDB } from './db';
import type { BookMetadata, Annotation, BookLocations } from '../types/db';
import { DatabaseError, StorageFullError } from '../types/errors';
import { processEpub } from '../lib/ingestion';

/**
 * Service for handling all database operations with robust error handling.
 */
export class DBService {
  private progressDebounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly DEBOUNCE_DELAY = 1000; // 1 second debounce for progress saving

  /**
   * Helper to execute a database operation with error handling.
   */
  private async execute<T>(operation: () => Promise<T>, errorMessage: string): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'QuotaExceededError') {
        throw new StorageFullError();
      }
      if (error instanceof DatabaseError) {
        throw error;
      }
      throw new DatabaseError(errorMessage, error);
    }
  }

  /**
   * Retrieves all books from the library.
   */
  async getLibrary(): Promise<BookMetadata[]> {
    return this.execute(async () => {
      const db = await getDB();
      return await db.getAll('books');
    }, 'Failed to fetch library.');
  }

  /**
   * Retrieves metadata for a specific book.
   */
  async getBookMetadata(id: string): Promise<BookMetadata | undefined> {
    return this.execute(async () => {
      const db = await getDB();
      return await db.get('books', id);
    }, `Failed to fetch metadata for book ${id}.`);
  }

  /**
   * Retrieves the binary file for a specific book.
   */
  async getBookFile(id: string): Promise<ArrayBuffer | undefined> {
    return this.execute(async () => {
      const db = await getDB();
      return await db.get('files', id);
    }, `Failed to fetch file for book ${id}.`);
  }

  /**
   * Adds a new book to the library using the ingestion logic.
   * Note: logic duplicated/wrapped from processEpub to ensure centralization eventually.
   * For now, we reuse processEpub but wrap it to catch errors.
   */
  async addBook(file: File): Promise<string> {
    return this.execute(async () => {
      // processEpub currently handles its own DB transaction.
      // In the future, we should move the transaction logic here.
      return await processEpub(file);
    }, 'Failed to add book.');
  }

  /**
   * Deletes a book and all associated data (files, annotations, locations, lexicon).
   */
  async deleteBook(id: string): Promise<void> {
    return this.execute(async () => {
      const db = await getDB();
      const tx = db.transaction(['books', 'files', 'annotations', 'locations', 'lexicon'], 'readwrite');

      await Promise.all([
        tx.objectStore('books').delete(id),
        tx.objectStore('files').delete(id),
        tx.objectStore('locations').delete(id)
      ]);

      // Delete annotations
      const annotationsIndex = tx.objectStore('annotations').index('by_bookId');
      let annCursor = await annotationsIndex.openCursor(IDBKeyRange.only(id));
      while (annCursor) {
        await annCursor.delete();
        annCursor = await annCursor.continue();
      }

      // Delete lexicon rules
      const lexiconIndex = tx.objectStore('lexicon').index('by_bookId');
      let lexCursor = await lexiconIndex.openCursor(IDBKeyRange.only(id));
      while (lexCursor) {
        await lexCursor.delete();
        lexCursor = await lexCursor.continue();
      }

      await tx.done;
    }, `Failed to delete book ${id}.`);
  }

  /**
   * Updates the reading progress for a book.
   * Debounced to prevent frequent DB writes during rapid navigation/scrolling.
   */
  async saveProgress(id: string, cfi: string, progress: number): Promise<void> {
    // Clear any existing pending save for this book
    if (this.progressDebounceTimers.has(id)) {
      clearTimeout(this.progressDebounceTimers.get(id));
    }

    // Return a promise that resolves when the save actually happens (or is superseded? No, void return is fine for now)
    // Ideally, we want to know if it failed. But with debounce, we are "firing and forgetting" the previous one.
    // We will just return void immediately to the caller, and handle the save asynchronously.

    // However, to make it testable and robust, we might want to return a Promise that resolves when the debounced action completes.
    // For now, consistent with the fire-and-forget nature of progress saving, we'll just queue it.

    const timer = setTimeout(async () => {
      this.progressDebounceTimers.delete(id);
      try {
        await this.execute(async () => {
          const db = await getDB();
          const tx = db.transaction('books', 'readwrite');
          const store = tx.objectStore('books');
          const book = await store.get(id);

          if (book) {
            book.currentCfi = cfi;
            book.progress = progress;
            book.lastRead = Date.now();
            await store.put(book);
          }
          await tx.done;
        }, `Failed to save progress for book ${id}.`);
      } catch (error) {
        console.error('Debounced saveProgress failed:', error);
      }
    }, this.DEBOUNCE_DELAY);

    this.progressDebounceTimers.set(id, timer);
  }

  /**
   * Adds a new annotation.
   */
  async addAnnotation(annotation: Annotation): Promise<void> {
    return this.execute(async () => {
      const db = await getDB();
      await db.put('annotations', annotation);
    }, 'Failed to add annotation.');
  }

  /**
   * Retrieves all annotations for a specific book.
   */
  async getAnnotations(bookId: string): Promise<Annotation[]> {
    return this.execute(async () => {
      const db = await getDB();
      return await db.getAllFromIndex('annotations', 'by_bookId', bookId);
    }, `Failed to fetch annotations for book ${bookId}.`);
  }

  /**
   * Saves generated locations for a book.
   */
  async saveLocations(bookId: string, locations: string): Promise<void> {
    return this.execute(async () => {
      const db = await getDB();
      await db.put('locations', { bookId, locations });
    }, `Failed to save locations for book ${bookId}.`);
  }

    /**
   * Retrieves generated locations for a book.
   */
  async getLocations(bookId: string): Promise<BookLocations | undefined> {
    return this.execute(async () => {
      const db = await getDB();
      return await db.get('locations', bookId);
    }, `Failed to get locations for book ${bookId}.`);
  }

  /**
   * Cleans up the TTS cache by removing the least recently used entries
   * if the cache size exceeds a certain limit (optional) or just exposes the capability.
   */
  async cleanupCache(maxEntries = 100): Promise<void> {
    return this.execute(async () => {
      const db = await getDB();
      const count = await db.count('tts_cache');

      if (count > maxEntries) {
        const tx = db.transaction('tts_cache', 'readwrite');
        const index = tx.objectStore('tts_cache').index('by_lastAccessed');
        let cursor = await index.openCursor(); // Ascending order (oldest first)
        let deleted = 0;

        while (cursor && (count - deleted) > maxEntries) {
          await cursor.delete();
          deleted++;
          cursor = await cursor.continue();
        }
        await tx.done;
      }
    }, 'Failed to clean up TTS cache.');
  }
}

export const dbService = new DBService();
