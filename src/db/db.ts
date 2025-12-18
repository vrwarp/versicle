import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BookMetadata, Annotation, CachedSegment, LexiconRule, BookLocations, TTSState, SectionMetadata, ContentAnalysis, ReadingHistoryEntry, ReadingListEntry } from '../types/db';

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
    value: Blob | ArrayBuffer;
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
   * Store for TTS queue persistence.
   */
  tts_queue: {
    key: string; // bookId
    value: TTSState;
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
  /**
   * Store for section metadata (character counts).
   */
  sections: {
    key: string; // id
    value: SectionMetadata;
    indexes: {
      by_bookId: string;
    };
  };
  /**
   * Store for AI content analysis results.
   */
  content_analysis: {
    key: string; // id
    value: ContentAnalysis;
    indexes: {
      by_bookId: string;
    };
  };
  /**
   * Store for reading history.
   */
  reading_history: {
    key: string; // bookId
    value: ReadingHistoryEntry;
  };
  /**
   * Store for reading list (portable sync).
   */
  reading_list: {
    key: string; // filename
    value: ReadingListEntry;
    indexes: {
      by_isbn: string;
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
    dbPromise = openDB<EpubLibraryDB>('EpubLibraryDB', 9, { // Upgrading to v9
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

        // TTS Queue store (New in v5)
        if (!db.objectStoreNames.contains('tts_queue')) {
          db.createObjectStore('tts_queue', { keyPath: 'bookId' });
        }

        // Lexicon store (New in v3)
        if (!db.objectStoreNames.contains('lexicon')) {
          const lexiconStore = db.createObjectStore('lexicon', { keyPath: 'id' });
          lexiconStore.createIndex('by_bookId', 'bookId', { unique: false });
          lexiconStore.createIndex('by_original', 'original', { unique: false });
        }

        // Sections store (New in v6)
        if (!db.objectStoreNames.contains('sections')) {
          const sectionsStore = db.createObjectStore('sections', { keyPath: 'id' });
          sectionsStore.createIndex('by_bookId', 'bookId', { unique: false });
        }

        // Content Analysis store (New in v7)
        if (!db.objectStoreNames.contains('content_analysis')) {
          const caStore = db.createObjectStore('content_analysis', { keyPath: 'id' });
          caStore.createIndex('by_bookId', 'bookId', { unique: false });
        }

        // Reading History store (New in v8)
        if (!db.objectStoreNames.contains('reading_history')) {
          db.createObjectStore('reading_history', { keyPath: 'bookId' });
        }

        // Reading List store (New in v9)
        if (!db.objectStoreNames.contains('reading_list')) {
          const rlStore = db.createObjectStore('reading_list', { keyPath: 'filename' });
          rlStore.createIndex('by_isbn', 'isbn', { unique: false });
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
