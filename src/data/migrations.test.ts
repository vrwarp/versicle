/**
 * The M suite — IDB v25 upgrade tests (P3-13, design D7 in
 * plan/overhaul/prep/phase3-storage-gateway.md).
 *
 * Fixture strategy: src/data/__fixtures__/schema-fixtures.ts (programmatic
 * builders with provenance, committed — master plan §3).
 *
 * v25 is THE one persisted-format change of Phase 3 (one-in-flight rule).
 * What it must prove, from the doc's exit criteria:
 *
 *  - M.1 v24-fixture upgrade: zero data loss for every store's rows, the
 *    new `by_lastAccessed` index, `schemaHistory` appended, and NO recovery
 *    record (a clean v24 DB has no stragglers).
 *  - M.2 v18-fixture upgrade: the straggler guard (snapshot-BEFORE-delete,
 *    the P9 fix) captures every legacy user-data store into
 *    `app_metadata['legacy-recovery-v25']` — with binary fields elided, not
 *    crashing — then the deletion loop converges the store set. Regenerable
 *    v17 stores are deleted WITHOUT capture.
 *  - M.3 the recovery snapshot is size-capped: oversized legacy data marks
 *    `truncated` and never blocks the upgrade.
 *  - M.4 fresh create appends `schemaHistory` from 0.
 *  - M.5 multi-tab upgrade: a v24 holder receives versionchange/blocking,
 *    closes, and the v25 open completes (the shipping two-tab scenario; the
 *    generic mechanism is pinned in connection.test.ts).
 *  - M.6 the post-open idle `size` backfill stamps pre-v25 audio rows once,
 *    preserving every other field (incl. the legacy `alignmentData` name).
 *
 * NOTE: like connection.test.ts, this suite mutates module-level connection
 * state — every test leaves the database deleted and the cache reset.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { openDB, type IDBPDatabase } from 'idb';
import { getConnection, closeConnection } from './connection';
import {
  DB_NAME,
  DB_VERSION,
  MIGRATIONS,
  LEGACY_RECOVERY_SIZE_CAP_BYTES,
} from './schema';
import {
  APP_METADATA_KEYS,
  type LegacyRecoveryRecord,
  type SchemaHistoryEntry,
} from './rows/app';
import { audioCache } from './repos/audioCache';
import {
  buildV18Fixture,
  buildV24Fixture,
  v24Rows,
  v18UserRows,
  v18StaticRows,
  V18_USER_DATA_STORE_NAMES,
  V18_REGENERABLE_STORE,
} from './__fixtures__/schema-fixtures';

const CURRENT_STORE_SET = [
  'app_metadata',
  'cache_audio_blobs',
  'cache_embed_jobs',
  'cache_embeddings',
  'cache_render_metrics',
  'cache_search_text',
  'cache_session_state',
  'cache_table_images',
  'cache_tts_preparation',
  'checkpoints',
  'flight_snapshots',
  'static_manifests',
  'static_resources',
  'static_structure',
  'sync_log',
];

function deleteAppDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onblocked = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function toBytes(buffer: ArrayBuffer): number[] {
  return Array.from(new Uint8Array(buffer));
}

async function getSchemaHistory(db: IDBPDatabase<never>): Promise<SchemaHistoryEntry[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (await (db as any).get('app_metadata', APP_METADATA_KEYS.schemaHistory)) as SchemaHistoryEntry[];
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  await closeConnection();
  await deleteAppDatabase();
  vi.restoreAllMocks();
});

describe('migration registry shape', () => {
  it('is ordered, versioned, and ends at DB_VERSION', () => {
    expect(MIGRATIONS.length).toBeGreaterThan(0);
    const versions = MIGRATIONS.map((m) => m.toVersion);
    expect([...versions].sort((a, b) => a - b)).toEqual(versions);
    expect(new Set(versions).size).toBe(versions.length);
    expect(versions.at(-1)).toBe(DB_VERSION);
    expect(versions.every((v) => v > 24)).toBe(true);
  });
});

describe('M.1 v24 fixture → v25 (zero data loss)', () => {
  it('preserves every row in every store, byte-identical binaries included', async () => {
    await buildV24Fixture();
    const db = await getConnection();

    expect(db.version).toBe(DB_VERSION);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(CURRENT_STORE_SET);

    const manifest = await db.get('static_manifests', 'bk-1');
    expect(manifest).toEqual(v24Rows.manifest);
    expect(toBytes(manifest!.coverBlob as ArrayBuffer)).toEqual(toBytes(v24Rows.manifest.coverBlob));

    expect(await db.get('static_resources', 'bk-1')).toEqual(v24Rows.resource);
    expect(await db.get('static_structure', 'bk-1')).toEqual(v24Rows.structure);
    expect(await db.get('cache_table_images', v24Rows.tableImage.id)).toEqual(v24Rows.tableImage);
    expect(await db.get('cache_render_metrics', 'bk-1')).toEqual(v24Rows.renderMetrics);
    expect(await db.get('cache_audio_blobs', 'seg-legacy')).toEqual(v24Rows.legacyAudio);
    expect(await db.get('cache_audio_blobs', 'seg-modern')).toEqual(v24Rows.modernAudio);
    expect(await db.get('cache_session_state', 'bk-1')).toEqual(v24Rows.session);
    expect(await db.get('cache_tts_preparation', v24Rows.ttsPrep.id)).toEqual(v24Rows.ttsPrep);
    expect(await db.get('checkpoints', 1)).toEqual({ id: 1, ...v24Rows.checkpoint });
    expect(await db.get('sync_log', 1)).toEqual({ id: 1, ...v24Rows.syncLog });
    expect(await db.get('flight_snapshots', 'snap-1')).toEqual(v24Rows.flightSnapshot);
  });

  it('adds the by_lastAccessed index (LRU eviction, D5.1/D7)', async () => {
    await buildV24Fixture();
    const db = await getConnection();

    const store = db.transaction('cache_audio_blobs').store;
    expect(Array.from(store.indexNames)).toContain('by_lastAccessed');

    const ordered = await db.getAllFromIndex('cache_audio_blobs', 'by_lastAccessed');
    expect(ordered.map((row) => row.key)).toEqual(['seg-legacy', 'seg-modern']);
  });

  it('appends schemaHistory and writes NO recovery record for a clean v24 DB', async () => {
    await buildV24Fixture();
    const before = Date.now();
    const db = await getConnection();

    const history = await getSchemaHistory(db as never);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: 24, to: DB_VERSION });
    expect(history[0].at).toBeGreaterThanOrEqual(before);

    expect(await db.get('app_metadata', APP_METADATA_KEYS.legacyRecoveryV25)).toBeUndefined();
  });
});

describe('M.2 v18 fixture → v25 (the straggler snapshot-before-delete guard)', () => {
  it('captures every legacy user-data store before deleting, then converges', async () => {
    await buildV18Fixture();
    const db = await getConnection();

    expect(db.version).toBe(DB_VERSION);
    // The deletion loop ran: legacy stores are gone, the set converged.
    expect(Array.from(db.objectStoreNames).sort()).toEqual(CURRENT_STORE_SET);

    const record = (await db.get(
      'app_metadata',
      APP_METADATA_KEYS.legacyRecoveryV25,
    )) as LegacyRecoveryRecord;
    expect(record).toBeDefined();
    expect(record.fromVersion).toBe(18);
    expect(record.truncated).toBe(false);
    expect(record.capturedAt).toBeGreaterThan(0);

    const byStore = new Map(record.stores.map((s) => [s.store, s]));
    for (const name of V18_USER_DATA_STORE_NAMES) {
      const capture = byStore.get(name);
      const fixtureRows = v18UserRows[name as keyof typeof v18UserRows];
      expect(capture, `capture for ${name}`).toBeDefined();
      expect(capture!.rowCount).toBe(fixtureRows.length);
      expect(capture!.capturedCount).toBe(fixtureRows.length);
      expect(() => JSON.parse(capture!.rowsJSON)).not.toThrow();
    }

    // Regenerable v17 stores are deleted WITHOUT capture.
    expect(byStore.has(V18_REGENERABLE_STORE)).toBe(false);

    // JSON-recoverable content: the v18 annotation row survives verbatim …
    const annotations = JSON.parse(byStore.get('user_annotations')!.rowsJSON);
    expect(annotations).toEqual([...v18UserRows.user_annotations]);

    // … and binary fields are ELIDED to a descriptor (never crash, never
    // bloat): the v17 books row's ArrayBuffer cover becomes a marker.
    const books = JSON.parse(byStore.get('books')!.rowsJSON);
    expect(books).toHaveLength(1);
    expect(books[0].title).toBe('Legacy Book');
    expect(books[0].coverBlob).toEqual({ __binary: 'ArrayBuffer', byteLength: 4 });
  });

  it('preserves the static rows and appends schemaHistory {from:18,to:25}', async () => {
    await buildV18Fixture();
    const db = await getConnection();

    const manifest = await db.get('static_manifests', 'bk-1');
    expect(manifest).toEqual(v18StaticRows.manifest);
    expect(await db.get('static_resources', 'bk-1')).toEqual(v18StaticRows.resource);
    expect(await db.get('static_structure', 'bk-1')).toEqual(v18StaticRows.structure);

    const history = await getSchemaHistory(db as never);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: 18, to: DB_VERSION });
  });
});

describe('M.3 the recovery snapshot is size-capped', () => {
  it('marks truncated, captures what fits, and never blocks the upgrade', async () => {
    // 3 synthetic annotation rows of ~cap/2 characters each (~1.5× the cap
    // total) on top of the regular fixture rows.
    await buildV18Fixture({
      oversizedAnnotations: { count: 3, payloadChars: LEGACY_RECOVERY_SIZE_CAP_BYTES / 2 },
    });
    const db = await getConnection();

    // The upgrade completed and the deletion loop still ran.
    expect(db.version).toBe(DB_VERSION);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(CURRENT_STORE_SET);

    const record = (await db.get(
      'app_metadata',
      APP_METADATA_KEYS.legacyRecoveryV25,
    )) as LegacyRecoveryRecord;
    expect(record.truncated).toBe(true);

    const annotations = record.stores.find((s) => s.store === 'user_annotations')!;
    expect(annotations.rowCount).toBe(v18UserRows.user_annotations.length + 3);
    expect(annotations.capturedCount).toBeLessThan(annotations.rowCount);
    // What WAS captured is still valid JSON.
    expect(() => JSON.parse(annotations.rowsJSON)).not.toThrow();
  });
});

describe('M.4 fresh create', () => {
  it('records schemaHistory from 0 on a brand-new profile', async () => {
    const db = await getConnection();
    expect(db.version).toBe(DB_VERSION);
    const history = await getSchemaHistory(db as never);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ from: 0, to: DB_VERSION });
  });
});

describe('M.5 multi-tab v24 → v25 upgrade (the shipping two-tab scenario)', () => {
  it('lets the v25 open complete once the v24 holder closes on versionchange', async () => {
    await buildV24Fixture();

    let holderSawBlocking = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let holder: IDBPDatabase<any> | null = null;
    holder = await openDB(DB_NAME, 24, {
      blocking() {
        // The well-behaved old tab: close so the new version can proceed
        // (in production, connection.ts does exactly this and the app
        // prompts a reload — connection.test.ts pins that wiring).
        holderSawBlocking = true;
        holder?.close();
      },
    });

    const db = await getConnection();
    expect(db.version).toBe(DB_VERSION);
    expect(holderSawBlocking).toBe(true);

    // The upgrade actually ran (not just an open): history was appended.
    const history = await getSchemaHistory(db as never);
    expect(history[0]).toMatchObject({ from: 24, to: DB_VERSION });
  });
});

describe('M.6 post-open idle size backfill (v25 step 3)', () => {
  it('stamps size on pre-v25 rows once, preserving every other field', async () => {
    await buildV24Fixture();
    const db = await getConnection();

    const stamped = await audioCache.backfillSizesOnce();
    expect(stamped).toBe(1); // only seg-legacy lacked `size`

    const legacy = await db.get('cache_audio_blobs', 'seg-legacy');
    expect(legacy).toEqual({ ...v24Rows.legacyAudio, size: v24Rows.legacyAudio.audio.byteLength });
    // The legacy alignmentData field name survives the backfill untouched —
    // the read-shim (not the backfill) owns its normalization.
    expect(legacy!.alignmentData).toEqual([...v24Rows.legacyAudio.alignmentData]);

    // Modern rows are untouched.
    expect(await db.get('cache_audio_blobs', 'seg-modern')).toEqual(v24Rows.modernAudio);

    // Completion flag set; a second run is a no-op.
    expect(await db.get('app_metadata', APP_METADATA_KEYS.audioSizeBackfillV25)).toBe(true);
    expect(await audioCache.backfillSizesOnce()).toBe(0);
  });
});

describe('M.7 v26 search-text store (Phase 7 §F — additive, cache-domain)', () => {
  it('creates an EMPTY cache_search_text store on upgrade from v24 without touching data', async () => {
    await buildV24Fixture();
    const db = await getConnection();

    expect(Array.from(db.objectStoreNames)).toContain('cache_search_text');
    expect(await db.count('cache_search_text')).toBe(0);
    // Adjacent cache data is untouched by the additive step.
    expect(await db.get('cache_tts_preparation', v24Rows.ttsPrep.id)).toEqual(v24Rows.ttsPrep);
  });

  it('creates the store on fresh installs and keys rows by bookId', async () => {
    const db = await getConnection();
    const tx = db.transaction('cache_search_text');
    expect(tx.store.keyPath).toBe('bookId');
    await tx.done;
  });
});

describe('M.8 v27 embedding stores (Increment B — additive, cache-domain)', () => {
  it('creates EMPTY cache_embeddings + cache_embed_jobs on upgrade from v24 without touching data', async () => {
    await buildV24Fixture();
    const db = await getConnection();

    expect(Array.from(db.objectStoreNames)).toContain('cache_embeddings');
    expect(Array.from(db.objectStoreNames)).toContain('cache_embed_jobs');
    expect(await db.count('cache_embeddings')).toBe(0);
    expect(await db.count('cache_embed_jobs')).toBe(0);

    // Both are keyed by bookId.
    const embTx = db.transaction('cache_embeddings');
    expect(embTx.store.keyPath).toBe('bookId');
    await embTx.done;
    const jobTx = db.transaction('cache_embed_jobs');
    expect(jobTx.store.keyPath).toBe('bookId');
    await jobTx.done;

    // Adjacent cache data is untouched by the additive step.
    expect(await db.get('cache_tts_preparation', v24Rows.ttsPrep.id)).toEqual(v24Rows.ttsPrep);
    expect(await db.get('cache_search_text', 'bk-1')).toBeUndefined();
    expect(await db.get('cache_render_metrics', 'bk-1')).toEqual(v24Rows.renderMetrics);
  });

  it('creates both stores on fresh installs and keys rows by bookId', async () => {
    const db = await getConnection();

    const embTx = db.transaction('cache_embeddings');
    expect(embTx.store.keyPath).toBe('bookId');
    await embTx.done;
    const jobTx = db.transaction('cache_embed_jobs');
    expect(jobTx.store.keyPath).toBe('bookId');
    await jobTx.done;
  });
});
