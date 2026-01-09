import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BookMetadata, Book, BookSource, BookState, Annotation, CachedSegment, LexiconRule, BookLocations, TTSState, SectionMetadata, ContentAnalysis, ReadingHistoryEntry, ReadingListEntry, TTSContent, TTSPosition, TableImage, SyncCheckpoint, SyncLogEntry } from '../types/db';

/**
 * Interface defining the schema for the IndexedDB database.
 *
 * Data is categorized into:
 * - Static (static_): Unchanging once loaded.
 * - User (user_): User generated content like progress and settings.
 * - Cache (cache_): Generated or cached data like queue, AI data, cloud TTS.
 */
export interface EpubLibraryDB extends DBSchema {
  // --- Static Stores ---

  /**
   * Static: Book Metadata (Identity & Display).
   * Unchanging after ingestion.
   */
  static_books: {
    key: string;
    value: Book; // Note: coverBlob is moved to cache_covers
    indexes: {
      by_title: string;
      by_author: string;
      by_addedAt: number;
    };
  };

  /**
   * Static: Source Metadata (Technical/File Info).
   */
  static_book_sources: {
    key: string; // bookId
    value: BookSource;
  };

  /**
   * Static: Binary File Data (EPUB files).
   */
  static_files: {
    key: string;
    value: Blob | ArrayBuffer;
  };

  /**
   * Static: Section Metadata (Structure).
   */
  static_sections: {
    key: string; // id
    value: SectionMetadata;
    indexes: {
      by_bookId: string;
    };
  };

  /**
   * Static: Extracted TTS Content (Text).
   */
  static_tts_content: {
    key: string;
    value: TTSContent;
    indexes: {
      by_bookId: string;
    };
  };

  // --- User Stores ---

  /**
   * User: Book State (Progress, CFI, Status).
   */
  user_book_states: {
    key: string; // bookId
    value: BookState;
  };

  /**
   * User: Annotations.
   */
  user_annotations: {
    key: string;
    value: Annotation;
    indexes: {
      by_bookId: string;
    };
  };

  /**
   * User: Reading History.
   */
  user_reading_history: {
    key: string; // bookId
    value: ReadingHistoryEntry;
  };

  /**
   * User: Reading List (Portable Sync).
   */
  user_reading_list: {
    key: string; // filename
    value: ReadingListEntry;
    indexes: {
      by_isbn: string;
    };
  };

  /**
   * User: Lexicon Rules.
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
   * User: Sync Checkpoints.
   */
  user_checkpoints: {
    key: number;
    value: SyncCheckpoint;
    indexes: {
      by_timestamp: number;
    };
  };

  /**
   * User: Sync Logs.
   */
  user_sync_log: {
    key: number;
    value: SyncLogEntry;
    indexes: {
      by_timestamp: number;
    };
  };

  /**
   * User: App Metadata.
   */
  user_app_metadata: {
    key: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
  };

  // --- Cache Stores ---

  /**
   * Cache: Cover Images (Blobs).
   * Extracted from EPUB, can be regenerated.
   */
  cache_covers: {
    key: string; // bookId
    value: Blob;
  };

  /**
   * Cache: Generated Locations.
   */
  cache_locations: {
    key: string; // bookId
    value: BookLocations;
  };

  /**
   * Cache: TTS Queue State.
   */
  cache_tts_queue: {
    key: string; // bookId
    value: TTSState;
  };

  /**
   * Cache: TTS Position (Lightweight).
   */
  cache_tts_position: {
    key: string; // bookId
    value: TTSPosition;
  };

  /**
   * Cache: TTS Audio Segments.
   */
  cache_tts_audio: { // Renamed from tts_cache
    key: string;
    value: CachedSegment;
    indexes: {
        by_lastAccessed: number;
    };
  };

  /**
   * Cache: Content Analysis (AI).
   */
  cache_content_analysis: {
    key: string; // id
    value: ContentAnalysis;
    indexes: {
      by_bookId: string;
    };
  };

  /**
   * Cache: Table Images.
   */
  cache_table_images: {
    key: string; // id: `${bookId}-${cfi}`
    value: TableImage;
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
    dbPromise = openDB<EpubLibraryDB>('EpubLibraryDB', 18, {
      async upgrade(db, oldVersion, _newVersion, transaction) {

        // --- V18: Aggressive Refactoring (Prefixing Stores) ---

        // 1. Create New Stores

        // Static
        if (!db.objectStoreNames.contains('static_books')) {
            const store = db.createObjectStore('static_books', { keyPath: 'id' });
            store.createIndex('by_title', 'title', { unique: false });
            store.createIndex('by_author', 'author', { unique: false });
            store.createIndex('by_addedAt', 'addedAt', { unique: false });
        }
        if (!db.objectStoreNames.contains('static_book_sources')) {
            db.createObjectStore('static_book_sources', { keyPath: 'bookId' });
        }
        if (!db.objectStoreNames.contains('static_files')) {
            db.createObjectStore('static_files');
        }
        if (!db.objectStoreNames.contains('static_sections')) {
            const store = db.createObjectStore('static_sections', { keyPath: 'id' });
            store.createIndex('by_bookId', 'bookId', { unique: false });
        }
        if (!db.objectStoreNames.contains('static_tts_content')) {
            const store = db.createObjectStore('static_tts_content', { keyPath: 'id' });
            store.createIndex('by_bookId', 'bookId', { unique: false });
        }

        // User
        if (!db.objectStoreNames.contains('user_book_states')) {
            db.createObjectStore('user_book_states', { keyPath: 'bookId' });
        }
        if (!db.objectStoreNames.contains('user_annotations')) {
            const store = db.createObjectStore('user_annotations', { keyPath: 'id' });
            store.createIndex('by_bookId', 'bookId', { unique: false });
        }
        if (!db.objectStoreNames.contains('user_reading_history')) {
            db.createObjectStore('user_reading_history', { keyPath: 'bookId' });
        }
        if (!db.objectStoreNames.contains('user_reading_list')) {
            const store = db.createObjectStore('user_reading_list', { keyPath: 'filename' });
            store.createIndex('by_isbn', 'isbn', { unique: false });
        }
        if (!db.objectStoreNames.contains('user_lexicon')) {
            const store = db.createObjectStore('user_lexicon', { keyPath: 'id' });
            store.createIndex('by_bookId', 'bookId', { unique: false });
            store.createIndex('by_original', 'original', { unique: false });
        }
        if (!db.objectStoreNames.contains('user_checkpoints')) {
            const store = db.createObjectStore('user_checkpoints', { keyPath: 'id', autoIncrement: true });
            store.createIndex('by_timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains('user_sync_log')) {
            const store = db.createObjectStore('user_sync_log', { keyPath: 'id', autoIncrement: true });
            store.createIndex('by_timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains('user_app_metadata')) {
            db.createObjectStore('user_app_metadata');
        }

        // Cache
        if (!db.objectStoreNames.contains('cache_covers')) {
            db.createObjectStore('cache_covers');
        }
        if (!db.objectStoreNames.contains('cache_locations')) {
            db.createObjectStore('cache_locations', { keyPath: 'bookId' });
        }
        if (!db.objectStoreNames.contains('cache_tts_queue')) {
            db.createObjectStore('cache_tts_queue', { keyPath: 'bookId' });
        }
        if (!db.objectStoreNames.contains('cache_tts_position')) {
            db.createObjectStore('cache_tts_position', { keyPath: 'bookId' });
        }
        if (!db.objectStoreNames.contains('cache_tts_audio')) {
            const store = db.createObjectStore('cache_tts_audio', { keyPath: 'key' });
            store.createIndex('by_lastAccessed', 'lastAccessed', { unique: false });
        }
        if (!db.objectStoreNames.contains('cache_content_analysis')) {
            const store = db.createObjectStore('cache_content_analysis', { keyPath: 'id' });
            store.createIndex('by_bookId', 'bookId', { unique: false });
        }
        if (!db.objectStoreNames.contains('cache_table_images')) {
            const store = db.createObjectStore('cache_table_images', { keyPath: 'id' });
            store.createIndex('by_bookId', 'bookId', { unique: false });
        }

        // 2. Data Migration from Old Stores (if they exist)

        if (oldVersion < 18) {
            const migrate = async (oldName: string, newName: string, transform?: (val: any) => any) => {
                if (db.objectStoreNames.contains(oldName)) {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const oldStore = transaction.objectStore(oldName as any);
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const newStore = transaction.objectStore(newName as any);

                    let cursor = await oldStore.openCursor();
                    while (cursor) {
                        const val = transform ? transform(cursor.value) : cursor.value;
                        // For stores without keyPath, we need to provide the key
                        if (newStore.keyPath) {
                            await newStore.put(val);
                        } else {
                            await newStore.put(val, cursor.key);
                        }
                        cursor = await cursor.continue();
                    }
                    // We don't delete old stores here to allow rollback if needed,
                    // or we delete them at the end.
                    // For aggressive refactoring, we should probably delete them to clean up.
                    db.deleteObjectStore(oldName);
                }
            };

            // Specialized migration for 'books' (Split into static_books and cache_covers)
            if (db.objectStoreNames.contains('books')) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const oldStore = transaction.objectStore('books' as any);
                const newBookStore = transaction.objectStore('static_books');
                const coverStore = transaction.objectStore('cache_covers');

                let cursor = await oldStore.openCursor();
                while (cursor) {
                    const oldBook = cursor.value as Book;

                    // Extract cover
                    if (oldBook.coverBlob) {
                        await coverStore.put(oldBook.coverBlob, oldBook.id);
                    }

                    // Create new book entry without coverBlob (optional, but cleaner)
                    const { coverBlob, ...bookData } = oldBook;
                    await newBookStore.put(bookData);

                    cursor = await cursor.continue();
                }
                db.deleteObjectStore('books');
            }

            // Simple Renames
            await migrate('book_sources', 'static_book_sources');
            await migrate('files', 'static_files');
            await migrate('sections', 'static_sections');
            await migrate('tts_content', 'static_tts_content');

            await migrate('book_states', 'user_book_states');
            await migrate('annotations', 'user_annotations');
            await migrate('reading_history', 'user_reading_history');
            await migrate('reading_list', 'user_reading_list');
            await migrate('lexicon', 'user_lexicon');
            await migrate('checkpoints', 'user_checkpoints');
            await migrate('sync_log', 'user_sync_log');
            await migrate('app_metadata', 'user_app_metadata');

            await migrate('locations', 'cache_locations');
            await migrate('tts_queue', 'cache_tts_queue');
            await migrate('tts_position', 'cache_tts_position');
            await migrate('tts_cache', 'cache_tts_audio');
            await migrate('content_analysis', 'cache_content_analysis');
            await migrate('table_images', 'cache_table_images');
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
