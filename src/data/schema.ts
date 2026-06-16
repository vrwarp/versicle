/**
 * The EpubLibraryDB schema: store map + the versioned migration registry
 * (Phase 3, D2/D7 in plan/overhaul/prep/phase3-storage-gateway.md; the
 * baseline store set was absorbed verbatim from src/db/db.ts).
 *
 * FORMAT SURFACE (C1): everything in this module is persisted-format
 * surface. v25 is Phase 3's ONE format change (master plan §4 rule 4 —
 * sequence: backup manifest v3 → CRDT v6 → **IDB v25**). What v25 does:
 *
 *  1. **Straggler guard (snapshot-before-delete, the P9 fix):** before the
 *     legacy-store deletion loop runs, any surviving v17/v18 USER-DATA
 *     store has its rows serialized into
 *     `app_metadata['legacy-recovery-v25']` (size-capped, binaries elided).
 *     The pre-v25 upgrade silently destroyed a returning pre-Yjs user's
 *     data; it is now recoverable via support/diagnostics.
 *  2. **`app_metadata` repurposed** (dead since v18) as the typed
 *     schema-evolution envelope: `schemaHistory` appended on every upgrade,
 *     plus the recovery record (envelope schemas in rows/app.ts).
 *  3. **`cache_audio_blobs.by_lastAccessed` index** for the LRU eviction
 *     job; the post-open idle `size` backfill lives in repos/audioCache.
 *  4. `sync_log` untouched (frozen for P4 to adopt or P9 to delete, ▲16).
 *
 * Reversibility note: v25 is additive (a snapshot, an index, metadata) —
 * but IDB versions are monotonic, so a v24 build cannot open a v25 DB.
 * That is why this lands only after the CRDT v6 stability window, and why
 * the straggler path is recoverable rather than destructive.
 *
 * Post-Yjs migration, IDB only stores:
 * - STATIC: immutable book content (manifests, blobs, structure)
 * - CACHE: ephemeral/regenerable data (render metrics, audio, TTS prep)
 * - APP: sync checkpoints, logs, and the schema-evolution envelope
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
  CacheEmbedJobsRow,
  CacheEmbeddingsRow,
  CacheRenderMetricsRow,
  CacheSearchTextRow,
  CacheSessionStateRow,
  CacheTtsPreparationRow,
  TableImageRow,
} from './rows/cache';
import type {
  AppMetadataValue,
  FlightSnapshotRow,
  LegacyRecoveryRecord,
  LegacyRecoveryStoreCapture,
  SchemaHistoryEntry,
  SyncCheckpointRow,
  SyncLogEntryRow,
} from './rows/app';
import { APP_METADATA_KEYS } from './rows/app';
import { createLogger } from '@lib/logger';

const logger = createLogger('DB');

/** The IndexedDB database name (shared with the SW read path, D3). */
export const DB_NAME = 'EpubLibraryDB';

/**
 * Current schema version. Bumping this is a user-data format change and is
 * governed by the one-in-flight rule (master plan §4 rule 4). v25 (P3-13)
 * was Phase 3's format change. v26 (Phase 7 §F) is the sanctioned additive
 * fallback the P7 prep doc names ("additive v26 through P3's versioned
 * migration registry"): it only CREATES the empty `cache_search_text` store
 * — cache-domain, rebuildable, no data is touched, absence on older builds
 * simply means search re-extracts (current behavior). v27 is the same shape of
 * additive bump for semantic (meaning-based) search: it only CREATES the empty
 * `cache_embeddings` + `cache_embed_jobs` stores — cache-domain, device-local,
 * rebuildable; on an older build their absence just means the book gets
 * re-embedded. This bump is DECOUPLED from the reserved sync_log/SW cleanup,
 * which was never done and would take v28. The next IDB bump must add a
 * MIGRATIONS step, never edit an existing one.
 */
export const DB_VERSION = 27;

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
    indexes: {
      /** v25: LRU eviction order (D5.1). Older rows lacking `size` are
       *  still indexed — `lastAccessed` has always been required. */
      by_lastAccessed: number;
    };
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
  /** v26 (Phase 7 §F): per-book plain-text search corpus, written at import
   *  and deleted with the book. Rebuildable — absence triggers re-extraction. */
  cache_search_text: {
    key: string;
    value: CacheSearchTextRow;
  };
  /** v27: per-book embedding vectors that power semantic search (one row per
   *  book, keyPath bookId). Device-local, never synced; deleted with the book.
   *  The key IS the bookId, so no secondary index (mirrors cache_search_text). */
  cache_embeddings: {
    key: string;
    value: CacheEmbeddingsRow;
  };
  /** v27: per-section progress for the embedding-build job (keyPath bookId), so
   *  it can resume mid-book after an interruption. Dies with the book and its
   *  vectors. */
  cache_embed_jobs: {
    key: string;
    value: CacheEmbedJobsRow;
  };

  // --- DOMAIN 3: APP (Sync Infrastructure + Schema Evolution) ---
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
    value: AppMetadataValue;
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
 * One step of the versioned migration registry (D7). Steps are append-only:
 * a released step's body is part of the persisted format and must never be
 * edited — a later bug gets a later step.
 */
export interface IdbMigration {
  readonly toVersion: number;
  /**
   * Runs inside the versionchange transaction; may await `tx` operations
   * only (anything else lets the transaction auto-commit underneath you).
   */
  migrate(
    db: IDBPDatabase<EpubLibraryDB>,
    tx: UpgradeTransaction,
    oldVersion: number,
  ): Promise<void> | void;
}

/**
 * Stores deleted by the post-Yjs migration. Two generations: the v17
 * monolith layout, and the v18 `user_*` stores whose contents moved into
 * the Yjs CRDT. Frozen — entries are never removed (a straggler may carry
 * any of them).
 */
const DEPRECATED_STORES = [
  // Legacy v17 stores
  'books', 'book_sources', 'book_states', 'files',
  'annotations', 'lexicon', 'sections', 'content_analysis',
  'reading_history', 'reading_list', 'tts_queue', 'tts_position',
  'tts_cache', 'locations', 'tts_content', 'table_images',
  // v18 user stores (now in Yjs)
  'user_inventory', 'user_reading_list', 'user_progress',
  'user_annotations', 'user_overrides', 'user_journey', 'user_ai_inference',
] as const;

/**
 * The USER-DATA subset of {@link DEPRECATED_STORES} the v25 straggler guard
 * snapshots before deletion: stores holding data the user created (library
 * inventory, positions, annotations, vocabulary, history) rather than
 * regenerable derived content (files/sections/tts_* caches are rebuilt from
 * the EPUB; capturing multi-MB binaries would blow the size cap for zero
 * recovery value — binary fields are elided even in captured stores).
 */
const LEGACY_USER_DATA_STORES = [
  'books', 'book_states', 'annotations', 'lexicon',
  'reading_history', 'reading_list',
  'user_inventory', 'user_reading_list', 'user_progress',
  'user_annotations', 'user_overrides', 'user_journey', 'user_ai_inference',
] as const;

/**
 * Soft budget for the recovery snapshot, measured in serialized UTF-16 code
 * units (≈ bytes for the ASCII-dominant JSON involved). Keeps the upgrade
 * transaction's memory bounded; what does not fit marks `truncated`.
 */
export const LEGACY_RECOVERY_SIZE_CAP_BYTES = 8 * 1024 * 1024;

/**
 * JSON-serialize one legacy row with binary fields elided to descriptors —
 * structured-clone values JSON.stringify would corrupt (ArrayBuffer → `{}`)
 * or that would bloat the snapshot are replaced by
 * `{ __binary, byteLength }` markers.
 */
function serializeLegacyRow(row: unknown): string {
  return JSON.stringify(row, (_key, value: unknown) => {
    if (value instanceof ArrayBuffer) {
      return { __binary: 'ArrayBuffer', byteLength: value.byteLength };
    }
    if (ArrayBuffer.isView(value)) {
      return { __binary: value.constructor.name, byteLength: value.byteLength };
    }
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      return { __binary: 'Blob', byteLength: value.size, type: value.type };
    }
    return value;
  });
}

/**
 * D7 step 1 — the straggler guard. Serializes every surviving legacy
 * user-data store into `app_metadata['legacy-recovery-v25']` BEFORE the
 * deletion loop runs (never reorder: validation/snapshot first, destruction
 * second). No surviving stores → no record.
 */
async function captureLegacyUserData(
  db: IDBPDatabase<EpubLibraryDB>,
  tx: UpgradeTransaction,
  oldVersion: number,
): Promise<void> {
  const surviving = LEGACY_USER_DATA_STORES.filter((name) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db.objectStoreNames.contains(name as any),
  );
  if (surviving.length === 0) return;

  logger.warn(
    `v25 straggler guard: capturing ${surviving.length} legacy user-data store(s) before deletion: ${surviving.join(', ')}`,
  );

  let budget = LEGACY_RECOVERY_SIZE_CAP_BYTES;
  let truncated = false;
  const stores: LegacyRecoveryStoreCapture[] = [];

  for (const name of surviving) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = tx.objectStore(name as any);
    const rowCount = await store.count();
    const serialized: string[] = [];

    let cursor = await store.openCursor();
    while (cursor) {
      if (budget <= 0) {
        truncated = true;
        break;
      }
      const json = serializeLegacyRow(cursor.value);
      if (json.length > budget) {
        truncated = true;
        break;
      }
      serialized.push(json);
      budget -= json.length;
      cursor = await cursor.continue();
    }

    stores.push({
      store: name,
      rowCount,
      capturedCount: serialized.length,
      rowsJSON: `[${serialized.join(',')}]`,
    });
  }

  const record: LegacyRecoveryRecord = {
    capturedAt: Date.now(),
    fromVersion: oldVersion,
    truncated,
    stores,
  };
  tx.objectStore('app_metadata').put(record, APP_METADATA_KEYS.legacyRecoveryV25);
}

/** The legacy-store deletion loop (moved from the v24 callback, ▲18). */
function deleteDeprecatedStores(db: IDBPDatabase<EpubLibraryDB>): void {
  for (const store of DEPRECATED_STORES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (db.objectStoreNames.contains(store as any)) {
      logger.info(`Deleting deprecated store: ${store}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      db.deleteObjectStore(store as any);
    }
  }
}

/** The v25 step (D7): straggler guard → deletion loop → LRU index. */
async function migrateToV25(
  db: IDBPDatabase<EpubLibraryDB>,
  tx: UpgradeTransaction,
  oldVersion: number,
): Promise<void> {
  // 1. Snapshot-before-delete: NEVER reorder these two.
  await captureLegacyUserData(db, tx, oldVersion);
  deleteDeprecatedStores(db);

  // 2. The LRU eviction index (D5.1's "later optimization"). The companion
  //    `size` backfill is a post-open idle job (repos/audioCache), not part
  //    of the upgrade transaction.
  const audioBlobs = tx.objectStore('cache_audio_blobs');
  if (!audioBlobs.indexNames.contains('by_lastAccessed')) {
    audioBlobs.createIndex('by_lastAccessed', 'lastAccessed');
  }
}

/**
 * The v26 step (Phase 7 §F): create the EMPTY `cache_search_text` store —
 * the persisted per-book search corpus written at import and lazily on
 * first search. Purely additive: no existing data is read or moved.
 * Cache-domain and rebuildable, so the rollback story is trivial (the store
 * is regenerated from the EPUB if ever lost).
 */
function migrateToV26(db: IDBPDatabase<EpubLibraryDB>): void {
  if (!db.objectStoreNames.contains('cache_search_text')) {
    db.createObjectStore('cache_search_text', { keyPath: 'bookId' });
  }
}

/**
 * The v27 step: create the EMPTY `cache_embeddings` + `cache_embed_jobs`
 * stores — the per-book semantic-search vectors and the embedding-build job
 * progress, both keyed by bookId. Purely additive: no existing data is read or
 * moved, and each create is guarded by `contains()`. Cache-domain,
 * device-local and rebuildable, so the rollback story is trivial (the stores
 * are re-embedded if ever lost). Decoupled from the reserved sync_log/SW
 * cleanup (never done; that would take v28).
 */
function migrateToV27(db: IDBPDatabase<EpubLibraryDB>): void {
  if (!db.objectStoreNames.contains('cache_embeddings')) {
    db.createObjectStore('cache_embeddings', { keyPath: 'bookId' });
  }
  if (!db.objectStoreNames.contains('cache_embed_jobs')) {
    db.createObjectStore('cache_embed_jobs', { keyPath: 'bookId' });
  }
}

/**
 * The versioned migration registry (D7). APPEND-ONLY: released steps are
 * persisted-format surface (migrations.test.ts runs them against committed
 * v18/v24 fixtures); a later fix is a later step, never an edit. Ordered
 * ascending; the final entry's `toVersion` must equal {@link DB_VERSION}
 * (pinned by the M suite).
 */
export const MIGRATIONS: readonly IdbMigration[] = [
  { toVersion: 25, migrate: migrateToV25 },
  { toVersion: 26, migrate: migrateToV26 },
  { toVersion: 27, migrate: migrateToV27 },
];

/**
 * Step 0 — the unversioned baseline, kept verbatim from the v24 callback so
 * any pre-24 straggler still converges: create-if-missing for every current
 * store. Runs on EVERY upgrade before the versioned steps.
 */
function ensureBaselineStores(
  db: IDBPDatabase<EpubLibraryDB>,
  transaction: UpgradeTransaction,
): void {
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

  // v27: the semantic-search embedding stores. KeyPath IS bookId, so no
  // secondary index (mirrors cache_search_text/cache_render_metrics).
  createStore('cache_embeddings', { keyPath: 'bookId' });
  createStore('cache_embed_jobs', { keyPath: 'bookId' });

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
}

/** D7 step 2: append `{ from, to, at }` to `schemaHistory` on every upgrade. */
async function appendSchemaHistory(
  tx: UpgradeTransaction,
  from: number,
  to: number,
): Promise<void> {
  const store = tx.objectStore('app_metadata');
  const existing = await store.get(APP_METADATA_KEYS.schemaHistory);
  const history: SchemaHistoryEntry[] = Array.isArray(existing) ? existing : [];
  history.push({ from, to, at: Date.now() });
  store.put(history, APP_METADATA_KEYS.schemaHistory);
}

/**
 * The upgrade callback: baseline (step 0) → versioned registry steps →
 * schemaHistory append. Passed to `openDB` by src/data/connection.ts.
 */
export async function upgradeSchema(
  db: IDBPDatabase<EpubLibraryDB>,
  oldVersion: number,
  newVersion: number | null,
  transaction: UpgradeTransaction,
): Promise<void> {
  const targetVersion = newVersion ?? DB_VERSION;
  logger.info(`Upgrading DB from v${oldVersion} to v${targetVersion}`);

  ensureBaselineStores(db, transaction);

  for (const step of MIGRATIONS) {
    if (oldVersion < step.toVersion) {
      await step.migrate(db, transaction, oldVersion);
    }
  }

  await appendSchemaHistory(transaction, oldVersion, targetVersion);
}
