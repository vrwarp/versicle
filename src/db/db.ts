import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { BookMetadata, Book, BookSource, BookState, Annotation, CachedSegment, LexiconRule, BookLocations, TTSState, SectionMetadata, ContentAnalysis, ReadingHistoryEntry, ReadingListEntry, TTSContent, TTSPosition, TableImage, SyncCheckpoint, SyncLogEntry } from '../types/db';

/**
 * Interface defining the schema for the IndexedDB database.
 */
export interface EpubLibraryDB extends DBSchema {
  /**
   * Store for synchronization checkpoints.
   */
  checkpoints: {
    key: number;
    value: SyncCheckpoint;
    indexes: {
      by_timestamp: number;
    };
  };
  /**
   * Store for synchronization logs.
   */
  sync_log: {
    key: number;
    value: SyncLogEntry;
    indexes: {
      by_timestamp: number;
    };
  };
  /**
   * Store for application-level metadata and configuration.
   */
  app_metadata: {
    key: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
  };
  /**
   * Store for book metadata.
   * Stores the essential display information (Book interface).
   */
  books: {
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
  book_sources: {
    key: string; // bookId
    value: BookSource;
  };
  /**
   * Store for book user state (Progress/Status).
   */
  book_states: {
    key: string; // bookId
    value: BookState;
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
   * Store for TTS position persistence (lightweight).
   */
  tts_position: {
    key: string; // bookId
    value: TTSPosition;
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
  /**
   * Store for decoupled TTS content.
   */
  tts_content: {
    key: string;
    value: TTSContent;
    indexes: {
      by_bookId: string;
    };
  };
  /**
   * Store for table image snapshots.
   */
  table_images: {
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
 * It creates the 'books', 'files', 'annotations', 'tts_cache', and 'lexicon' object stores if they don't exist.
 *
 * @returns A Promise resolving to the database instance.
 */
export const initDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<EpubLibraryDB>('EpubLibraryDB', 17, { // Upgrading to v17
      async upgrade(db, oldVersion, _newVersion, transaction) {
        // v17: Refactor Book Model (Split books store into books, book_sources, book_states)
        // Ensure stores are created regardless of oldVersion if they don't exist.
        if (!db.objectStoreNames.contains('book_sources')) {
            db.createObjectStore('book_sources', { keyPath: 'bookId' });
        }
        if (!db.objectStoreNames.contains('book_states')) {
            db.createObjectStore('book_states', { keyPath: 'bookId' });
        }

        if (oldVersion < 17) {
            if (db.objectStoreNames.contains('books')) {
                // We need to migrate data.
                const booksStore = transaction.objectStore('books');
                const sourcesStore = transaction.objectStore('book_sources');
                const statesStore = transaction.objectStore('book_states');

                // Iterate and split
                let cursor = await booksStore.openCursor();
                while (cursor) {
                    const oldBook = cursor.value as BookMetadata;

                    const source: BookSource = {
                        bookId: oldBook.id,
                        filename: oldBook.filename,
                        fileHash: oldBook.fileHash,
                        fileSize: oldBook.fileSize,
                        totalChars: oldBook.totalChars,
                        syntheticToc: oldBook.syntheticToc,
                        version: oldBook.version
                    };
                    await sourcesStore.put(source);

                    const state: BookState = {
                        bookId: oldBook.id,
                        lastRead: oldBook.lastRead,
                        progress: oldBook.progress,
                        currentCfi: oldBook.currentCfi,
                        lastPlayedCfi: oldBook.lastPlayedCfi,
                        lastPauseTime: oldBook.lastPauseTime,
                        isOffloaded: oldBook.isOffloaded,
                        aiAnalysisStatus: oldBook.aiAnalysisStatus
                    };
                    await statesStore.put(state);

                    // Update Book Entry (Keep only essential metadata)
                    const book: Book = {
                        id: oldBook.id,
                        title: oldBook.title,
                        author: oldBook.author,
                        description: oldBook.description,
                        coverUrl: oldBook.coverUrl,
                        coverBlob: oldBook.coverBlob,
                        addedAt: oldBook.addedAt
                    };
                    await cursor.update(book);

                    cursor = await cursor.continue();
                }
            }
        }

        // Checkpoints store (New in v16)
        if (!db.objectStoreNames.contains('checkpoints')) {
          const checkpointsStore = db.createObjectStore('checkpoints', { keyPath: 'id', autoIncrement: true });
          checkpointsStore.createIndex('by_timestamp', 'timestamp', { unique: false });
        }

        // Sync Log store (New in v16)
        if (!db.objectStoreNames.contains('sync_log')) {
          const syncLogStore = db.createObjectStore('sync_log', { keyPath: 'id', autoIncrement: true });
          syncLogStore.createIndex('by_timestamp', 'timestamp', { unique: false });
        }

        // App Metadata store (New in v14)
        if (!db.objectStoreNames.contains('app_metadata')) {
          db.createObjectStore('app_metadata');
        }

        // Migration to v11: Clear old reading history to enforce semantic boundaries
        if (oldVersion < 11) {
             if (db.objectStoreNames.contains('reading_history')) {
                 transaction.objectStore('reading_history').clear();
             }
        }
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

        // Migration to v15: Remove covers store (unused)
        // We do not delete the store to avoid type errors in the upgrade callback
        // as 'covers' is no longer in the EpubLibraryDB interface.
        // It will remain as an orphaned store for existing users.

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

        // TTS Position store (New in v13)
        if (!db.objectStoreNames.contains('tts_position')) {
          db.createObjectStore('tts_position', { keyPath: 'bookId' });
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

        // TTS Content store (New in v10)
        if (!db.objectStoreNames.contains('tts_content')) {
          const ttsContentStore = db.createObjectStore('tts_content', { keyPath: 'id' });
          ttsContentStore.createIndex('by_bookId', 'bookId', { unique: false });
        }

        // Table Images store (New in v15)
        if (!db.objectStoreNames.contains('table_images')) {
          const tableStore = db.createObjectStore('table_images', { keyPath: 'id' });
          tableStore.createIndex('by_bookId', 'bookId', { unique: false });
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
