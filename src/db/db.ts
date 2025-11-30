import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BookMetadata, Annotation, CachedSegment, LexiconRule, BookLocations } from '../types/db';

/**
 * Interface defining the schema for the IndexedDB database.
 */
export interface EpubLibraryDB extends DBSchema {
  /**
   * Store for book metadata.
   */
  books: {
    key: string;
    value: BookMetadata;
    indexes: {
      by_title: string;
      by_author: string;
      by_addedAt: number;
    };
  };
  /**
   * Store for binary file data (EPUB files).
   */
  files: {
    key: string;
    value: ArrayBuffer;
  };
  /**
   * Store for generated locations cache.
   */
  locations: {
    key: string; // bookId
    value: BookLocations;
  };
  /**
   * Store for user annotations.
   */
  annotations: {
    key: string;
    value: Annotation;
    indexes: {
      by_bookId: string;
    };
  };
  /**
   * Store for TTS audio cache.
   */
  tts_cache: {
    key: string;
    value: CachedSegment;
    indexes: {
        by_lastAccessed: number;
    };
  };
  /**
   * Store for user pronunciation rules.
   */
  lexicon: {
    key: string;
    value: LexiconRule;
    indexes: {
      by_bookId: string;
      by_original: string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<EpubLibraryDB>>;

/**
 * Initializes the IndexedDB database connection and handles schema upgrades.
 * It creates the 'books', 'files', 'annotations', 'tts_cache', and 'lexicon' object stores if they don't exist.
 *
 * @returns A Promise resolving to the database instance.
 */
export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<EpubLibraryDB>('EpubLibraryDB', 4, {
      upgrade(db) {
        // Books store
        if (!db.objectStoreNames.contains('books')) {
          const booksStore = db.createObjectStore('books', { keyPath: 'id' });
          booksStore.createIndex('by_title', 'title', { unique: false });
          booksStore.createIndex('by_author', 'author', { unique: false });
          booksStore.createIndex('by_addedAt', 'addedAt', { unique: false });
        }

        // Files store
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files');
        }

        // Locations store (New in v4)
        if (!db.objectStoreNames.contains('locations')) {
          db.createObjectStore('locations', { keyPath: 'bookId' });
        }

        // Annotations store
        if (!db.objectStoreNames.contains('annotations')) {
          const annotationsStore = db.createObjectStore('annotations', { keyPath: 'id' });
          annotationsStore.createIndex('by_bookId', 'bookId', { unique: false });
        }

        // TTS Cache store (New in v2)
        if (!db.objectStoreNames.contains('tts_cache')) {
          const cacheStore = db.createObjectStore('tts_cache', { keyPath: 'key' });
          cacheStore.createIndex('by_lastAccessed', 'lastAccessed', { unique: false });
        }

        // Lexicon store (New in v3)
        if (!db.objectStoreNames.contains('lexicon')) {
          const lexiconStore = db.createObjectStore('lexicon', { keyPath: 'id' });
          lexiconStore.createIndex('by_bookId', 'bookId', { unique: false });
          lexiconStore.createIndex('by_original', 'original', { unique: false });
        }
      },
    });
  }
  return dbPromise;
};

/**
 * Retrieves the existing database connection or initializes a new one.
 *
 * @returns A Promise resolving to the active database instance.
 */
export const getDB = () => {
  if (!dbPromise) {
    return initDB();
  }
  return dbPromise;
};
