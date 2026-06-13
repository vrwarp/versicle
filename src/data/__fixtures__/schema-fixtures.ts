/**
 * IDB schema fixtures for the v25 migration suite (`src/data/migrations.test.ts`,
 * the M.* tests) — Phase 3 P3-13, design D7 in
 * plan/overhaul/prep/phase3-storage-gateway.md.
 *
 * PROVENANCE (master plan §3 fixture strategy — "v18 and v24 IDB fixtures"):
 * committed as BUILDER CODE, not binary dumps. fake-indexeddb is
 * deterministic, so building the old layout programmatically at the old
 * version is equivalent to restoring a dump — and reviewable. Layouts are
 * reconstructed from:
 *
 *  - **v24**: the v24 upgrade callback moved verbatim from `src/db/db.ts`
 *    into `src/data/schema.ts` (P3-4, commit fe54bb0a; verified against the
 *    prep doc's HEAD read at fb3dcd3f). Store set, keyPaths and indexes are
 *    copied literally from that callback.
 *  - **v18**: the deprecated-store list in that same callback (its
 *    "Legacy v17 stores" block + "v18 user stores (now in Yjs)" block) plus
 *    the v18 static architecture the SW read contract documents
 *    (`src/data/sw-contract.ts`: "V18 Architecture" reads covers from
 *    `static_manifests`). The exact historical keyPaths of the long-deleted
 *    user stores are immaterial to the migration under test: the v25
 *    straggler guard reads rows with a cursor and never interprets keys.
 *
 * These builders intentionally re-declare store names and layouts as
 * literals instead of importing `src/data/schema.ts`: a fixture that tracked
 * the live schema would silently stop pinning the OLD format.
 *
 * Lives INSIDE src/data (not src/test/fixtures) on purpose: raw `idb`
 * access and readwrite transactions are the data layer's exclusive lint
 * privilege (D8) -- old-layout knowledge is data-layer property, and the
 * "zero exceptions" posture of the Phase 3 exit bans stays intact.
 */
/* eslint-disable @typescript-eslint/no-explicit-any -- the old layouts are
 * deliberately outside the current EpubLibraryDB type map. */
import { openDB } from 'idb';

/** Literal on purpose (see header): must match the app DB it impersonates. */
const FIXTURE_DB_NAME = 'EpubLibraryDB';

function bytes(...values: number[]): ArrayBuffer {
  return Uint8Array.from(values).buffer;
}

/** Deterministic fixture timestamps (no Date.now in persisted fixture rows). */
const T0 = 1_700_000_000_000;

// ─────────────────────────────────────────────────────────────────────────────
// v24 fixture — the current production layout, every store populated.
// ─────────────────────────────────────────────────────────────────────────────

export const v24Rows = {
  manifest: {
    bookId: 'bk-1',
    title: 'Alice in Wonderland',
    author: 'Lewis Carroll',
    fileHash: 'hash-1',
    fileSize: 1234,
    totalChars: 5678,
    schemaVersion: 2,
    coverBlob: bytes(1, 2, 3, 4, 5, 6, 7, 8),
    coverPalette: [1, 2, 3],
  },
  resource: { bookId: 'bk-1', epubBlob: bytes(9, 10, 11, 12) },
  structure: {
    bookId: 'bk-1',
    toc: [{ id: 'toc-1', href: 'ch1.xhtml', label: 'Chapter 1' }],
    spineItems: [{ id: 'ch1', characterCount: 5678, index: 0 }],
  },
  tableImage: {
    id: 'bk-1-epubcfi(/6/2)',
    bookId: 'bk-1',
    sectionId: 'ch1',
    cfi: 'epubcfi(/6/2)',
    imageBlob: bytes(20, 21, 22),
  },
  renderMetrics: { bookId: 'bk-1', locations: '{"_locations":["epubcfi(/6/2!/4/2)"]}', pageCount: 320 },
  /** Pre-size-field row with the LEGACY `alignmentData` name (read-shim path). */
  legacyAudio: {
    key: 'seg-legacy',
    audio: bytes(30, 31, 32, 33, 34),
    alignmentData: [{ timeSeconds: 0, charIndex: 0 }],
    createdAt: T0,
    lastAccessed: T0 + 1_000,
  },
  /** Modern row: canonical `alignment` + the additive `size` stamp (P3-6). */
  modernAudio: {
    key: 'seg-modern',
    audio: bytes(40, 41, 42),
    alignment: [{ timeSeconds: 0.5, charIndex: 3 }],
    createdAt: T0,
    lastAccessed: T0 + 2_000,
    size: 3,
  },
  session: {
    bookId: 'bk-1',
    playbackQueue: [{ text: 'Hello world.', cfi: 'epubcfi(/6/2!/4/2/1:0)' }],
    lastPauseTime: 12.5,
    updatedAt: T0 + 3_000,
  },
  ttsPrep: {
    id: 'bk-1-ch1',
    bookId: 'bk-1',
    sectionId: 'ch1',
    sentences: [{ text: 'Hello world.', cfi: 'epubcfi(/6/2!/4/2/1:0)' }],
  },
  /** `protected` pins the supersede/prune semantics (prep ▲9). */
  checkpoint: {
    timestamp: T0 + 4_000,
    blob: Uint8Array.from([50, 51, 52]),
    size: 3,
    trigger: 'pre-migration',
    protected: true,
  },
  /** sync_log is a dead store frozen as-is (prep ▲16) — but rows must survive. */
  syncLog: { timestamp: T0 + 5_000, level: 'info', message: 'frozen dead-store row' },
  flightSnapshot: {
    id: 'snap-1',
    createdAt: T0 + 6_000,
    trigger: 'manual',
    note: '',
    context: {
      bookId: 'bk-1',
      sectionIndex: 0,
      currentIndex: 0,
      queueLength: 1,
      status: 'paused',
      skippedCount: 0,
    },
    eventCount: 0,
    timeRange: { first: T0, last: T0 },
    eventsJSON: '[]',
    sizeBytes: 2,
  },
} as const;

/**
 * Build the EpubLibraryDB exactly as the v24 upgrade callback creates it,
 * with one row in every store. Closes its connection before returning.
 */
export async function buildV24Fixture(): Promise<void> {
  const db = await openDB(FIXTURE_DB_NAME, 24, {
    upgrade(database) {
      database.createObjectStore('static_manifests' as any, { keyPath: 'bookId' });
      database.createObjectStore('static_resources' as any, { keyPath: 'bookId' });
      database.createObjectStore('static_structure' as any, { keyPath: 'bookId' });

      const tableImages = database.createObjectStore('cache_table_images' as any, { keyPath: 'id' });
      tableImages.createIndex('by_bookId', 'bookId');
      database.createObjectStore('cache_render_metrics' as any, { keyPath: 'bookId' });
      database.createObjectStore('cache_audio_blobs' as any, { keyPath: 'key' });
      database.createObjectStore('cache_session_state' as any, { keyPath: 'bookId' });
      const ttsPrep = database.createObjectStore('cache_tts_preparation' as any, { keyPath: 'id' });
      ttsPrep.createIndex('by_bookId', 'bookId');

      const cp = database.createObjectStore('checkpoints' as any, { keyPath: 'id', autoIncrement: true });
      cp.createIndex('by_timestamp', 'timestamp');
      const sl = database.createObjectStore('sync_log' as any, { keyPath: 'id', autoIncrement: true });
      sl.createIndex('by_timestamp', 'timestamp');
      database.createObjectStore('app_metadata' as any);
      database.createObjectStore('flight_snapshots' as any, { keyPath: 'id' });
    },
  });

  try {
    const tx = db.transaction(Array.from(db.objectStoreNames) as any, 'readwrite');
    tx.objectStore('static_manifests' as any).put(v24Rows.manifest);
    tx.objectStore('static_resources' as any).put(v24Rows.resource);
    tx.objectStore('static_structure' as any).put(v24Rows.structure);
    tx.objectStore('cache_table_images' as any).put(v24Rows.tableImage);
    tx.objectStore('cache_render_metrics' as any).put(v24Rows.renderMetrics);
    tx.objectStore('cache_audio_blobs' as any).put(v24Rows.legacyAudio);
    tx.objectStore('cache_audio_blobs' as any).put(v24Rows.modernAudio);
    tx.objectStore('cache_session_state' as any).put(v24Rows.session);
    tx.objectStore('cache_tts_preparation' as any).put(v24Rows.ttsPrep);
    tx.objectStore('checkpoints' as any).put(v24Rows.checkpoint);
    tx.objectStore('sync_log' as any).put(v24Rows.syncLog);
    tx.objectStore('flight_snapshots' as any).put(v24Rows.flightSnapshot);
    await tx.done;
  } finally {
    db.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// v18 fixture — pre-Yjs straggler: static architecture + populated legacy
// user-data stores (the rows today's upgrade silently destroys, P9).
// ─────────────────────────────────────────────────────────────────────────────

export const v18UserRows = {
  /** v17 leftover with a binary field — exercises the guard's JSON elision. */
  books: [{ id: 'bk-0', title: 'Legacy Book', author: 'Anon', coverBlob: bytes(60, 61, 62, 63) }],
  book_states: [{ id: 'bk-0', cfi: 'epubcfi(/6/4!/4/2)', percent: 0.42 }],
  annotations: [{ id: 'old-ann', bookId: 'bk-0', cfi: 'epubcfi(/6/4!/4/2/1:0)', text: 'v17 highlight' }],
  user_inventory: [
    { id: 'bk-1', title: 'Alice in Wonderland', addedAt: T0 },
    { id: 'bk-2', title: 'Through the Looking-Glass', addedAt: T0 + 1 },
  ],
  user_progress: [{ id: 'bk-1#dev-a', bookId: 'bk-1', cfi: 'epubcfi(/6/6!/4/2)', percent: 0.13 }],
  user_annotations: [{ id: 'ann-1', bookId: 'bk-1', cfi: 'epubcfi(/6/6!/4/2/1:0)', text: 'v18 note', color: 'yellow' }],
  user_reading_list: [{ id: 'rl-1', bookId: 'bk-2', addedAt: T0 + 2 }],
  user_overrides: [{ id: 'ov-1', word: 'Alice', pronunciation: 'AL-iss' }],
  user_journey: [{ id: 'j-1', event: 'finished', bookId: 'bk-0', at: T0 + 3 }],
  user_ai_inference: [{ id: 'ai-1', bookId: 'bk-1', kind: 'summary', value: 'A girl follows a rabbit.' }],
} as const;

/** Every store above must appear in the v25 recovery record. */
export const V18_USER_DATA_STORE_NAMES = Object.keys(v18UserRows);

/** Regenerable v17 store — must be deleted WITHOUT being captured. */
export const V18_REGENERABLE_STORE = 'tts_cache';

export const v18StaticRows = {
  manifest: v24Rows.manifest,
  resource: v24Rows.resource,
  structure: v24Rows.structure,
} as const;

export interface V18FixtureOptions {
  /**
   * Extra synthetic `user_annotations` rows: `count` rows each carrying a
   * payload string of `payloadChars` characters — used to overrun the
   * straggler guard's size cap.
   */
  oversizedAnnotations?: { count: number; payloadChars: number };
}

/**
 * Build a v18-layout database: static stores (populated for one book),
 * every legacy user-data store populated, plus one regenerable v17 store
 * (`tts_cache`) that the guard must NOT capture.
 */
export async function buildV18Fixture(options: V18FixtureOptions = {}): Promise<void> {
  const db = await openDB(FIXTURE_DB_NAME, 18, {
    upgrade(database) {
      database.createObjectStore('static_manifests' as any, { keyPath: 'bookId' });
      database.createObjectStore('static_resources' as any, { keyPath: 'bookId' });
      database.createObjectStore('static_structure' as any, { keyPath: 'bookId' });
      for (const name of V18_USER_DATA_STORE_NAMES) {
        database.createObjectStore(name as any, { keyPath: 'id' });
      }
      database.createObjectStore(V18_REGENERABLE_STORE as any, { keyPath: 'key' });
    },
  });

  try {
    const tx = db.transaction(Array.from(db.objectStoreNames) as any, 'readwrite');
    tx.objectStore('static_manifests' as any).put(v18StaticRows.manifest);
    tx.objectStore('static_resources' as any).put(v18StaticRows.resource);
    tx.objectStore('static_structure' as any).put(v18StaticRows.structure);
    for (const [name, rows] of Object.entries(v18UserRows)) {
      for (const row of rows) tx.objectStore(name as any).put(row);
    }
    tx.objectStore(V18_REGENERABLE_STORE as any).put({ key: 'seg-old', audio: bytes(70, 71) });

    if (options.oversizedAnnotations) {
      const { count, payloadChars } = options.oversizedAnnotations;
      const payload = 'x'.repeat(payloadChars);
      for (let i = 0; i < count; i++) {
        tx.objectStore('user_annotations' as any).put({ id: `big-${i}`, bookId: 'bk-1', text: payload });
      }
    }
    await tx.done;
  } finally {
    db.close();
  }
}
