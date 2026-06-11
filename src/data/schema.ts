/**
 * The EpubLibraryDB schema: store map + the versioned upgrade callback
 * (Phase 3, D2 in plan/overhaul/prep/phase3-storage-gateway.md; absorbed
 * verbatim from src/db/db.ts).
 *
 * FORMAT SURFACE (C1): everything in this module is persisted-format
 * surface. The version stays 24 and the upgrade callback is byte-identical
 * to the src/db/db.ts original in this PR — schema changes are exclusively
 * the v25 PR (P3-13, the ONE in-flight format change of Phase 3; D7 adds
 * the migration registry here).
 *
 * Post-Yjs migration, IDB only stores:
 * - STATIC: immutable book content (manifests, blobs, structure)
 * - CACHE: ephemeral/regenerable data (render metrics, audio, TTS prep)
 * - APP: sync checkpoints and logs
 */
import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
// rows/ is the source of truth for persisted shapes (D4): every store's
// value type is its row type. The row types are supersets of the ~types
// domain interfaces that include persisted reality the interfaces elide —
// e.g. cache_audio_blobs' `size` + legacy `alignmentData` fields, and the
// ArrayBuffer state of binary fields the interfaces call Blob (WebKit's IDB
// cannot structured-clone Blob; ingest normalizes).
import type {
  StaticManifestRow,
  StaticResourceRow,
  StaticStructureRow,
} from './rows/static';
import type {
  CacheAudioBlobRow,
  CacheRenderMetricsRow,
  CacheSessionStateRow,
  CacheTtsPreparationRow,
  TableImageRow,
} from './rows/cache';
import type {
  FlightSnapshotRow,
  SyncCheckpointRow,
  SyncLogEntryRow,
} from './rows/app';
import { createLogger } from '@lib/logger';

const logger = createLogger('DB');

/** The IndexedDB database name (shared with the SW read path, D3). */
export const DB_NAME = 'EpubLibraryDB';

/**
 * Current schema version. Bumping this is a user-data format change and is
 * governed by the one-in-flight rule (master plan §4 rule 4) — v25 is the
 * Phase 3 format change and lands last (P3-13).
 */
export const DB_VERSION = 24;

/**
 * Interface defining the schema for the IndexedDB database.
 */
export interface EpubLibraryDB extends DBSchema {
  // --- DOMAIN 1: STATIC (Immutable Book Content) ---
  static_manifests: {
    key: string;
    value: StaticManifestRow;
  };
  static_resources: {
    key: string;
    value: StaticResourceRow;
  };
  static_structure: {
    key: string;
    value: StaticStructureRow;
  };

  // --- DOMAIN 2: CACHE (Ephemeral, Regenerable) ---
  cache_table_images: {
    key: string;
    value: TableImageRow;
    indexes: {
      by_bookId: string;
    };
  };
  cache_render_metrics: {
    key: string;
    value: CacheRenderMetricsRow;
  };
  cache_audio_blobs: {
    key: string;
    value: CacheAudioBlobRow;
  };
  cache_session_state: {
    key: string;
    value: CacheSessionStateRow;
  };
  cache_tts_preparation: {
    key: string;
    value: CacheTtsPreparationRow;
    indexes: {
      by_bookId: string;
    };
  };

  // --- DOMAIN 3: APP (Sync Infrastructure) ---
  checkpoints: {
    key: number;
    value: SyncCheckpointRow;
    indexes: {
      by_timestamp: number;
    };
  };
  sync_log: {
    key: number;
    value: SyncLogEntryRow;
    indexes: {
      by_timestamp: number;
    };
  };
  app_metadata: {
    key: string;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    value: any;
  };
  flight_snapshots: {
    key: string;
    value: FlightSnapshotRow;
  };
}

type UpgradeTransaction = IDBPTransaction<
  EpubLibraryDB,
  ArrayLike<StoreNames<EpubLibraryDB>>,
  'versionchange'
>;

/**
 * The v24 upgrade callback, moved VERBATIM from src/db/db.ts (idempotent
 * create-if-missing baseline + the legacy-store deletion loop). P3-13's
 * v25 work — the migration registry, the straggler snapshot-before-delete
 * guard, by_lastAccessed index — extends this module, not this function.
 */
export async function upgradeSchema(
  db: IDBPDatabase<EpubLibraryDB>,
  oldVersion: number,
  _newVersion: number | null,
  transaction: UpgradeTransaction,
): Promise<void> {
  logger.info(`Upgrading DB from v${oldVersion} to v${DB_VERSION}`);

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
  if (!db.objectStoreNames.contains('flight_snapshots')) {
    db.createObjectStore('flight_snapshots', { keyPath: 'id' });
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
}
