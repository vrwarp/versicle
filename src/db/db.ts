import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BookMetadata, Book, BookSource, BookState, Annotation, CachedSegment, LexiconRule, BookLocations, TTSState, SectionMetadata, ContentAnalysis, ReadingHistoryEntry, ReadingListEntry, TTSContent, TTSPosition, TableImage, SyncCheckpoint, SyncLogEntry } from '../types/db';

/**
 * Interface defining the schema for the IndexedDB database.
 */
export interface EpubLibraryDB extends DBSchema {
  // --- User Generated Content (user_) ---
  /**
   * Store for synchronization checkpoints.
   */
  user_checkpoints: {
    key: number;
    value: SyncCheckpoint;
    indexes: {
      by_timestamp: number;
    };
  };
  /**
   * Store for synchronization logs.
   */
  user_sync_log: {
    key: number;
    value: SyncLogEntry;
    indexes: {
      by_timestamp: number;
    };
  };
  /**
   * Store for application-level metadata and configuration.
   */
  user_app_metadata: {
    key: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
  };
  /**
   * Store for book user state (Progress/Status).
   */
  user_book_states: {
    key: string; // bookId
    value: BookState;
  };
  /**
   * Store for user annotations.
   */
  user_annotations: {
    key: string;
    value: Annotation;
    indexes: {
      by_bookId: string;
    };
  };
  /**
   * Store for TTS position persistence (lightweight).
   */
  user_tts_position: {
    key: string; // bookId
    value: TTSPosition;
  };
  /**
   * Store for user pronunciation rules.
   */
  user_lexicon: {
    key: string;
    value: LexiconRule;
    indexes: {
      by_bookId: string;
      by_original: string;
    };
  };
  /**
   * Store for reading history.
   */
  user_reading_history: {
    key: string; // bookId
    value: ReadingHistoryEntry;
  };
  /**
   * Store for reading list (portable sync).
   */
  user_reading_list: {
    key: string; // filename
    value: ReadingListEntry;
    indexes: {
      by_isbn: string;
    };
  };

  // --- Static Data (static_) ---
  /**
   * Store for book metadata.
   * Stores the essential display information (Book interface).
   */
  static_books: {
    key: string;
    value: Book; // Refactored from BookMetadata
    indexes: {
      by_title: string;
      by_author: string;
      by_addedAt: number;
    };
  };
  /**
   * Store for book source metadata (Technical/File Info).
   */
  static_book_sources: {
    key: string; // bookId
    value: BookSource;
  };
  /**
   * Store for binary file data (EPUB files).
   */
  static_files: {
    key: string;
    value: Blob | ArrayBuffer;
  };
  /**
   * Store for section metadata (character counts).
   */
  static_sections: {
    key: string; // id
    value: SectionMetadata;
    indexes: {
      by_bookId: string;
    };
  };
  /**
   * Store for decoupled TTS content.
   */
  static_tts_content: {
    key: string;
    value: TTSContent;
    indexes: {
      by_bookId: string;
    };
  };
  /**
   * Store for table image snapshots.
   */
  static_table_images: {
    key: string; // id: `${bookId}-${cfi}`
    value: TableImage;
    indexes: {
      by_bookId: string;
    };
  };

  // --- Cached Data (cache_) ---
  /**
   * Store for generated locations cache.
   */
  cache_book_locations: {
    key: string; // bookId
    value: BookLocations;
  };
  /**
   * Store for TTS audio cache.
   */
  cache_tts: {
    key: string;
    value: CachedSegment;
    indexes: {
        by_lastAccessed: number;
    };
  };
  /**
   * Store for TTS queue persistence.
   */
  cache_tts_queue: {
    key: string; // bookId
    value: TTSState;
  };
  /**
   * Store for AI content analysis results.
   */
  cache_content_analysis: {
    key: string; // id
    value: ContentAnalysis;
    indexes: {
      by_bookId: string;
    };
  };
}

let dbPromise: Promise<IDBPDatabase<EpubLibraryDB>>;

/**
 * Initializes the IndexedDB database connection and handles schema upgrades.
 *
 * @returns A Promise resolving to the database instance.
 */
export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<EpubLibraryDB>('EpubLibraryDB', 18, { // Upgrading to v18
      async upgrade(db, oldVersion, _newVersion, transaction) {

        // --- v18 Migration: Rename stores to user_, static_, cache_ prefixes ---
        if (oldVersion < 18) {
          const migrate = async (
             oldName: string,
             newName: string,
             schemaFn: () => void,
             outOfLineKeys = false
          ) => {
             // 1. Create new store if it doesn't exist
             if (!db.objectStoreNames.contains(newName)) {
                schemaFn();
             }

             // 2. Migrate data if old store exists
             if (db.objectStoreNames.contains(oldName)) {
                const oldStore = transaction.objectStore(oldName as any);
                const newStore = transaction.objectStore(newName as any); // Should be available now

                let cursor = await oldStore.openCursor();
                while (cursor) {
                   if (outOfLineKeys) {
                       await newStore.put(cursor.value, cursor.key);
                   } else {
                       await newStore.put(cursor.value);
                   }
                   cursor = await cursor.continue();
                }

                // 3. Delete old store
                db.deleteObjectStore(oldName);
             }
          };

          // --- Static ---
          await migrate('books', 'static_books', () => {
              const s = db.createObjectStore('static_books', { keyPath: 'id' });
              s.createIndex('by_title', 'title', { unique: false });
              s.createIndex('by_author', 'author', { unique: false });
              s.createIndex('by_addedAt', 'addedAt', { unique: false });
          });

          await migrate('files', 'static_files', () => {
              db.createObjectStore('static_files'); // Out-of-line keys
          }, true);

          await migrate('book_sources', 'static_book_sources', () => {
              db.createObjectStore('static_book_sources', { keyPath: 'bookId' });
          });

          await migrate('sections', 'static_sections', () => {
              const s = db.createObjectStore('static_sections', { keyPath: 'id' });
              s.createIndex('by_bookId', 'bookId', { unique: false });
          });

          await migrate('tts_content', 'static_tts_content', () => {
              const s = db.createObjectStore('static_tts_content', { keyPath: 'id' });
              s.createIndex('by_bookId', 'bookId', { unique: false });
          });

          await migrate('table_images', 'static_table_images', () => {
              const s = db.createObjectStore('static_table_images', { keyPath: 'id' });
              s.createIndex('by_bookId', 'bookId', { unique: false });
          });

          // --- User ---
          await migrate('book_states', 'user_book_states', () => {
              db.createObjectStore('user_book_states', { keyPath: 'bookId' });
          });

          await migrate('annotations', 'user_annotations', () => {
              const s = db.createObjectStore('user_annotations', { keyPath: 'id' });
              s.createIndex('by_bookId', 'bookId', { unique: false });
          });

          await migrate('reading_history', 'user_reading_history', () => {
              db.createObjectStore('user_reading_history', { keyPath: 'bookId' });
          });

          await migrate('reading_list', 'user_reading_list', () => {
              const s = db.createObjectStore('user_reading_list', { keyPath: 'filename' });
              s.createIndex('by_isbn', 'isbn', { unique: false });
          });

          await migrate('lexicon', 'user_lexicon', () => {
              const s = db.createObjectStore('user_lexicon', { keyPath: 'id' });
              s.createIndex('by_bookId', 'bookId', { unique: false });
              s.createIndex('by_original', 'original', { unique: false });
          });

          await migrate('app_metadata', 'user_app_metadata', () => {
              db.createObjectStore('user_app_metadata'); // Out-of-line keys
          }, true);

          await migrate('checkpoints', 'user_checkpoints', () => {
              const s = db.createObjectStore('user_checkpoints', { keyPath: 'id', autoIncrement: true });
              s.createIndex('by_timestamp', 'timestamp', { unique: false });
          });

          await migrate('sync_log', 'user_sync_log', () => {
              const s = db.createObjectStore('user_sync_log', { keyPath: 'id', autoIncrement: true });
              s.createIndex('by_timestamp', 'timestamp', { unique: false });
          });

          await migrate('tts_position', 'user_tts_position', () => {
              db.createObjectStore('user_tts_position', { keyPath: 'bookId' });
          });

          // --- Cache ---
          await migrate('locations', 'cache_book_locations', () => {
              db.createObjectStore('cache_book_locations', { keyPath: 'bookId' });
          });

          await migrate('tts_cache', 'cache_tts', () => {
              const s = db.createObjectStore('cache_tts', { keyPath: 'key' });
              s.createIndex('by_lastAccessed', 'lastAccessed', { unique: false });
          });

          await migrate('tts_queue', 'cache_tts_queue', () => {
              db.createObjectStore('cache_tts_queue', { keyPath: 'bookId' });
          });

          await migrate('content_analysis', 'cache_content_analysis', () => {
              const s = db.createObjectStore('cache_content_analysis', { keyPath: 'id' });
              s.createIndex('by_bookId', 'bookId', { unique: false });
          });
        }

        // --- Legacy Migrations (kept for reference, but v18 covers creation) ---
        // We can simplify this. If v18 migration runs, it creates everything.
        // If it's a fresh install (oldVersion = 0), v18 migration logic handles creation
        // because we check !db.objectStoreNames.contains(newName).
        // So we don't need the old checks anymore, provided the list above is exhaustive.
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
