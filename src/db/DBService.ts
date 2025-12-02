import ePub from 'epubjs';
import { v4 as uuidv4 } from 'uuid';
import { getDB, type EpubLibraryDB } from './db';
import type { BookMetadata, Annotation, CachedSegment, BookLocations } from '../types/db';
import { DatabaseError, StorageFullError, NotFoundError } from '../types/errors';

export class DBService {
  private static instance: DBService;
  private pendingProgressUpdates: Map<string, NodeJS.Timeout> = new Map();

  private constructor() {}

  public static getInstance(): DBService {
    if (!DBService.instance) {
      DBService.instance = new DBService();
    }
    return DBService.instance;
  }

  private async handleError(error: unknown, context: string): Promise<never> {
    if (error instanceof DatabaseError) {
      throw error;
    }
    const err = error as Error;
    if (err.name === 'QuotaExceededError' || err.message?.includes('QuotaExceededError')) {
      throw new StorageFullError(`Storage full during: ${context}`);
    }
    throw new DatabaseError(`Failed to ${context}`, error);
  }

  // Library Management
  async getLibrary(): Promise<BookMetadata[]> {
    try {
      const db = await getDB();
      return await db.getAll('books');
    } catch (error) {
      return this.handleError(error, 'fetch library');
    }
  }

  async getBook(id: string): Promise<{ metadata: BookMetadata; arrayBuffer: ArrayBuffer } | null> {
    try {
      const db = await getDB();
      const metadata = await db.get('books', id);
      if (!metadata) return null;

      const arrayBuffer = await db.get('files', id);
      if (!arrayBuffer) {
        throw new NotFoundError(`Book file not found for id: ${id}`);
      }

      return { metadata, arrayBuffer };
    } catch (error) {
      return this.handleError(error, `fetch book ${id}`);
    }
  }

  async getBookMetadata(id: string): Promise<BookMetadata | null> {
    try {
      const db = await getDB();
      const metadata = await db.get('books', id);
      return metadata || null;
    } catch (error) {
      return this.handleError(error, `fetch book metadata ${id}`);
    }
  }

  async addBook(file: File): Promise<string> {
    try {
      const arrayBuffer = await file.arrayBuffer();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const book = (ePub as any)(arrayBuffer);

      await book.ready;

      const metadata = await book.loaded.metadata;

      let coverBlob: Blob | undefined;
      const coverUrl = await book.coverUrl();

      if (coverUrl) {
        try {
          const response = await fetch(coverUrl);
          coverBlob = await response.blob();
        } catch (error) {
          console.warn('Failed to retrieve cover blob:', error);
        }
      }

      const bookId = uuidv4();

      const newBook: BookMetadata = {
        id: bookId,
        title: metadata.title || 'Untitled',
        author: metadata.creator || 'Unknown Author',
        description: metadata.description || '',
        addedAt: Date.now(),
        coverBlob: coverBlob,
        progress: 0,
      };

      const db = await getDB();
      const tx = db.transaction(['books', 'files'], 'readwrite');

      await Promise.all([
        tx.objectStore('books').add(newBook),
        tx.objectStore('files').add(arrayBuffer, bookId)
      ]);

      await tx.done;

      return bookId;
    } catch (error) {
      return this.handleError(error, 'add book');
    }
  }

  async deleteBook(id: string): Promise<void> {
    try {
      const db = await getDB();
      // Cascading delete
      // We need to delete from: books, files, locations, annotations, lexicon
      const tx = db.transaction(
        ['books', 'files', 'locations', 'annotations', 'lexicon'],
        'readwrite'
      );

      const annotations = await tx.objectStore('annotations').index('by_bookId').getAllKeys(id);
      const lexiconRules = await tx.objectStore('lexicon').index('by_bookId').getAllKeys(id);

      await Promise.all([
        tx.objectStore('books').delete(id),
        tx.objectStore('files').delete(id),
        tx.objectStore('locations').delete(id),
        ...annotations.map(key => tx.objectStore('annotations').delete(key)),
        ...lexiconRules.map(key => tx.objectStore('lexicon').delete(key))
      ]);

      await tx.done;
    } catch (error) {
      return this.handleError(error, `delete book ${id}`);
    }
  }

  // Progress Management
  async saveProgress(id: string, cfi: string, progress: number): Promise<void> {
    if (this.pendingProgressUpdates.has(id)) {
      clearTimeout(this.pendingProgressUpdates.get(id));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(async () => {
        this.pendingProgressUpdates.delete(id);
        try {
          const db = await getDB();
          const book = await db.get('books', id);
          if (book) {
            book.lastPlayedCfi = cfi;
            book.progress = progress;
            await db.put('books', book);
          }
          resolve();
        } catch (error) {
          try {
             await this.handleError(error, `save progress for ${id}`);
          } catch (e) {
             reject(e);
          }
        }
      }, 500); // Debounce 500ms

      this.pendingProgressUpdates.set(id, timeout);
    });
  }

  // Direct progress update without debounce (useful for precise updates like pause)
  async saveProgressImmediate(id: string, updates: Partial<BookMetadata>): Promise<void> {
      try {
          const db = await getDB();
          const book = await db.get('books', id);
          if (book) {
              const updatedBook = { ...book, ...updates };
              await db.put('books', updatedBook);
          }
      } catch (error) {
          return this.handleError(error, `save progress immediate for ${id}`);
      }
  }

  // Annotations
  async addAnnotation(annotation: Annotation): Promise<void> {
    try {
      const db = await getDB();
      await db.put('annotations', annotation);
    } catch (error) {
      return this.handleError(error, 'add annotation');
    }
  }

  async deleteAnnotation(id: string): Promise<void> {
      try {
          const db = await getDB();
          await db.delete('annotations', id);
      } catch (error) {
          return this.handleError(error, `delete annotation ${id}`);
      }
  }

  async getAnnotations(bookId: string): Promise<Annotation[]> {
    try {
      const db = await getDB();
      return await db.getAllFromIndex('annotations', 'by_bookId', bookId);
    } catch (error) {
      return this.handleError(error, `fetch annotations for ${bookId}`);
    }
  }

  // Locations
  async saveLocations(bookId: string, locations: BookLocations): Promise<void> {
      try {
          const db = await getDB();
          await db.put('locations', locations);
      } catch (error) {
          return this.handleError(error, `save locations for ${bookId}`);
      }
  }

  async getLocations(bookId: string): Promise<BookLocations | undefined> {
      try {
          const db = await getDB();
          return await db.get('locations', bookId);
      } catch (error) {
          return this.handleError(error, `get locations for ${bookId}`);
      }
  }

  // TTS Cache
  async cleanupCache(): Promise<void> {
    // Implement cache cleanup based on LRU or size limits
    // For Phase 1, we can implement a simple "keep max 500 entries" strategy
    try {
      const db = await getDB();
      const count = await db.count('tts_cache');
      const MAX_CACHE_ENTRIES = 500;

      if (count > MAX_CACHE_ENTRIES) {
          const keys = await db.getAllKeysFromIndex('tts_cache', 'by_lastAccessed');
          // keys are sorted ascending by lastAccessed (oldest first)
          const keysToDelete = keys.slice(0, count - MAX_CACHE_ENTRIES);

          const tx = db.transaction('tts_cache', 'readwrite');
          await Promise.all(keysToDelete.map(key => tx.store.delete(key)));
          await tx.done;
      }
    } catch (error) {
       console.warn('Cache cleanup failed:', error);
       // We don't throw here as it's a maintenance task
    }
  }
}

export const dbService = DBService.getInstance();
