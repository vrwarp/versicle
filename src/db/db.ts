import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  // Static Domain
  StaticBookManifest,
  StaticResource,
  StaticStructure,
  // Cache Domain
  CacheRenderMetrics,
  CacheAudioBlob,
  CacheSessionState,
  CacheTtsPreparation,
  TableImage,
  // App Types
  SyncCheckpoint,
  SyncLogEntry
} from '../types/db';
import { createLogger } from '../lib/logger';

const logger = createLogger('DB');

/**
 * Interface defining the schema for the IndexedDB database.
 *
 * Post-Yjs Migration: User data has been migrated to Yjs stores.
 * IDB now only stores:
 * - STATIC: Immutable book content (manifests, blobs, structure)
 * - CACHE: Ephemeral/regenerable data (render metrics, audio, TTS prep)
 * - APP: Sync checkpoints and logs
 */
export interface EpubLibraryDB extends DBSchema {
  // --- DOMAIN 1: STATIC (Immutable Book Content) ---
  static_manifests: {
    key: string;
    value: StaticBookManifest;
  };
  static_resources: {
    key: string;
    value: StaticResource;
  };
  static_structure: {
    key: string;
    value: StaticStructure;
  };

  // --- DOMAIN 2: CACHE (Ephemeral, Regenerable) ---
  cache_table_images: {
    key: string;
    value: TableImage;
    indexes: {
      by_bookId: string;
    };
  };
  cache_render_metrics: {
    key: string;
    value: CacheRenderMetrics;
  };
  cache_audio_blobs: {
    key: string;
    value: CacheAudioBlob;
  };
  cache_session_state: {
    key: string;
    value: CacheSessionState;
  };
  cache_tts_preparation: {
    key: string;
    value: CacheTtsPreparation;
    indexes: {
      by_bookId: string;
    };
  };

  // --- DOMAIN 3: APP (Sync Infrastructure) ---
  checkpoints: {
    key: number;
    value: SyncCheckpoint;
    indexes: {
      by_timestamp: number;
    };
  };
  sync_log: {
    key: number;
    value: SyncLogEntry;
    indexes: {
      by_timestamp: number;
    };
  };
  app_metadata: {
    key: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
  };
}

let dbPromise: Promise<IDBPDatabase<EpubLibraryDB>>;

export const initDB = () => {
  if (!dbPromise) {
    // Bump version to 23 to trigger cleanup of deprecated stores
    dbPromise = openDB<EpubLibraryDB>('EpubLibraryDB', 23, {
      async upgrade(db, oldVersion, _newVersion, transaction) {
        logger.info(`Upgrading DB from v${oldVersion} to v23`);

        // Helper to create store if it doesn't exist
        const createStore = (name: string, options?: IDBObjectStoreParameters) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (!db.objectStoreNames.contains(name as any)) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return db.createObjectStore(name as any, options);
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return transaction.objectStore(name as any);
        };

        // --- Create Active Stores ---

        // Static Domain
        createStore('static_manifests', { keyPath: 'bookId' });
        createStore('static_resources', { keyPath: 'bookId' });
        createStore('static_structure', { keyPath: 'bookId' });

        // Cache Domain
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tableImages = createStore('cache_table_images', { keyPath: 'id' }) as any;
        if (!tableImages.indexNames.contains('by_bookId')) {
          tableImages.createIndex('by_bookId', 'bookId');
        }

        createStore('cache_render_metrics', { keyPath: 'bookId' });
        createStore('cache_audio_blobs', { keyPath: 'key' });
        createStore('cache_session_state', { keyPath: 'bookId' });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ttsPrep = createStore('cache_tts_preparation', { keyPath: 'id' }) as any;
        if (!ttsPrep.indexNames.contains('by_bookId')) {
          ttsPrep.createIndex('by_bookId', 'bookId');
        }

        // App Domain
        if (!db.objectStoreNames.contains('checkpoints')) {
          const cp = db.createObjectStore('checkpoints', { keyPath: 'id', autoIncrement: true });
          cp.createIndex('by_timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('sync_log')) {
          const sl = db.createObjectStore('sync_log', { keyPath: 'id', autoIncrement: true });
          sl.createIndex('by_timestamp', 'timestamp');
        }
        if (!db.objectStoreNames.contains('app_metadata')) {
          db.createObjectStore('app_metadata');
        }

        // --- Delete Deprecated Stores (migrated to Yjs) ---
        const deprecatedStores = [
          // Legacy v17 stores
          'books', 'book_sources', 'book_states', 'files',
          'annotations', 'lexicon', 'sections', 'content_analysis',
          'reading_history', 'reading_list', 'tts_queue', 'tts_position',
          'tts_cache', 'locations', 'tts_content', 'table_images',
          // v18 user stores (now in Yjs)
          'user_inventory', 'user_reading_list', 'user_progress',
          'user_annotations', 'user_overrides', 'user_journey', 'user_ai_inference'
        ];

        for (const store of deprecatedStores) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (db.objectStoreNames.contains(store as any)) {
            logger.info(`Deleting deprecated store: ${store}`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            db.deleteObjectStore(store as any);
          }
        }
      },
    });
  }
  return dbPromise;
};

export const getDB = () => {
  if (!dbPromise) {
    return initDB();
  }
  return dbPromise;
};
