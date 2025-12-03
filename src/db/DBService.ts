import { getDB } from './db';
import type { BookMetadata, Annotation, CachedSegment, BookLocations } from '../types/db';
import { DatabaseError, StorageFullError } from '../types/errors';
import { processEpub } from '../lib/ingestion';

class DBService {
  private async getDB() {
    return getDB();
  }

  private handleError(error: unknown): never {
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
      const books = await db.getAll('books');
      return books.sort((a, b) => b.addedAt - a.addedAt);
    } catch (error) {
      this.handleError(error);
    }
  }

  async getBook(id: string): Promise<{ metadata: BookMetadata | undefined; file: ArrayBuffer | undefined }> {
    try {
      const db = await this.getDB();
      const metadata = await db.get('books', id);
      const file = await db.get('files', id);
      return { metadata, file };
    } catch (error) {
      this.handleError(error);
    }
  }

  async getBookMetadata(id: string): Promise<BookMetadata | undefined> {
      try {
          const db = await this.getDB();
          return await db.get('books', id);
      } catch (error) {
          this.handleError(error);
      }
  }

  async getBookFile(id: string): Promise<ArrayBuffer | undefined> {
      try {
          const db = await this.getDB();
          return await db.get('files', id);
      } catch (error) {
          this.handleError(error);
      }
  }

  async addBook(file: File): Promise<void> {
    try {
      await processEpub(file);
    } catch (error) {
      this.handleError(error);
    }
  }

  async deleteBook(id: string): Promise<void> {
    try {
      const db = await this.getDB();
      const tx = db.transaction(['books', 'files', 'annotations', 'locations', 'lexicon'], 'readwrite');

      await Promise.all([
          tx.objectStore('books').delete(id),
          tx.objectStore('files').delete(id),
          tx.objectStore('locations').delete(id),
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
              const tx = db.transaction('books', 'readwrite');
              const store = tx.objectStore('books');

              for (const [id, data] of Object.entries(pending)) {
                  const book = await store.get(id);
                  if (book) {
                      book.currentCfi = data.cfi;
                      book.progress = data.progress;
                      book.lastRead = Date.now();
                      await store.put(book);
                  }
              }
              await tx.done;
          } catch (error) {
              console.error('Failed to save progress', error);
              // We don't throw here to avoid interrupting the user flow,
              // but we might want to surface this via a global error handler eventually.
          }
      }, 1000); // 1 second debounce
  }

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

  // --- Annotation Operations ---

  async addAnnotation(annotation: Annotation): Promise<void> {
    try {
      const db = await this.getDB();
      await db.put('annotations', annotation);
    } catch (error) {
      this.handleError(error);
    }
  }

  async getAnnotations(bookId: string): Promise<Annotation[]> {
    try {
      const db = await this.getDB();
      return await db.getAllFromIndex('annotations', 'by_bookId', bookId);
    } catch (error) {
      this.handleError(error);
    }
  }

  async deleteAnnotation(id: string): Promise<void> {
      try {
          const db = await this.getDB();
          await db.delete('annotations', id);
      } catch (error) {
          this.handleError(error);
      }
  }

  // --- TTS Cache Operations ---

  async getCachedSegment(key: string): Promise<CachedSegment | undefined> {
      try {
          const db = await this.getDB();
          const segment = await db.get('tts_cache', key);

          if (segment) {
              // Fire and forget update to lastAccessed
              // We don't await this to keep read fast
              db.put('tts_cache', { ...segment, lastAccessed: Date.now() }).catch(console.error);
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

  // --- Locations ---

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

  // --- Lexicon ---
  // Adding minimal support for lexicon to match removeBook requirements,
  // full service migration for LexiconManager can be done later or added here if needed.
}

export const dbService = new DBService();
