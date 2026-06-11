/**
 * S.1 — the end-to-end backup generate→restore round-trip characterization
 * (plan/overhaul/prep/phase3-storage-gateway.md §Test plan "S", PR P3-1).
 *
 * This is the missing acceptance gate named by the prep doc (▲21): it runs
 * the REAL BackupService against the real shared Y.Doc and fake-indexeddb
 * (no connection or y-idb mocks, unlike BackupService.test.ts) and pins:
 *
 *   1. generate→JSON-file→restore content equality for Yjs data
 *      (library books + annotations) and binary ArrayBuffer covers;
 *   2. the RAW `versicle-yjs` write shape BackupService re-implements today
 *      (BackupService.ts processManifest Phase 3): after a restore the
 *      `updates` store holds EXACTLY ONE row, byte-identical to the
 *      manifest snapshot, and that row alone hydrates a fresh Y.Doc to the
 *      backed-up state (reload-simulated rehydration — what y-idb does on
 *      the next boot).
 *
 * P3-11 replaces the raw `indexedDB.open('versicle-yjs')` block with
 * YjsSnapshotService.applySnapshot (backed by the vendored y-idb fork's
 * writeSnapshot). This suite MUST stay green UNCHANGED across that swap —
 * it is the acceptance gate for the rewrite.
 *
 * Only CheckpointService is mocked (its create-checkpoint ordering is
 * pinned separately in BackupService.test.ts and CheckpointService.test.ts;
 * importing it here would drag the Firestore SDK into the suite).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import { backupService, type BackupManifestV3 } from './BackupService';
import { getYDoc } from '@store/yjs-provider';
import { getConnection as getDB } from '@data/connection';
import type { StaticBookManifest } from '~types/db';

vi.mock('./sync/CheckpointService', () => ({
  CheckpointService: {
    createCheckpoint: vi.fn(async () => 1),
  },
}));

/** Binary cover bytes incl. >0x7F values to catch base64/charCode bugs. */
const COVER_BYTES = [137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128, 7];

const BOOK_ID = 'roundtrip-book-1';

async function clearAppDatabase(): Promise<void> {
  const db = await getDB();
  // Per-store one-shot clears (no raw readwrite transaction — banned
  // outside src/data at Phase 3 exit).
  for (const store of Array.from(db.objectStoreNames)) {
    await db.clear(store);
  }
}

function deleteYjsDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('versicle-yjs');
    request.onsuccess = () => resolve();
    // No connection to versicle-yjs is held between tests in this suite.
    request.onblocked = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function openRawYjsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('versicle-yjs');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllRows(db: IDBDatabase, storeName: string): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction([storeName], 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Reload-simulated rehydration: build a fresh Y.Doc from the raw rows of
 * the `updates` store in key order — exactly what y-idb's constructor does
 * on the next app boot.
 */
async function hydrateFreshDocFromRawIdb(): Promise<Y.Doc> {
  const db = await openRawYjsDb();
  try {
    const rows = (await getAllRows(db, 'updates')) as Uint8Array[];
    const doc = new Y.Doc();
    doc.transact(() => {
      for (const row of rows) {
        Y.applyUpdate(doc, row);
      }
    });
    return doc;
  } finally {
    db.close();
  }
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Seed the shared doc with user data (library inventory + an annotation). */
function seedSharedDoc(): void {
  const doc = getYDoc();
  doc.transact(() => {
    const library = doc.getMap('library');
    let books = library.get('books');
    if (!(books instanceof Y.Map)) {
      books = new Y.Map();
      library.set('books', books);
    }
    (books as Y.Map<unknown>).set(BOOK_ID, {
      bookId: BOOK_ID,
      title: 'Round-Trip Book',
      author: 'Ada Lovelace',
      addedAt: 1717000000000,
      lastInteraction: 1717000000000,
      tags: ['pinned'],
      status: 'reading',
    });
    doc.getMap('annotations').set(BOOK_ID, {
      'ann-1': {
        id: 'ann-1',
        bookId: BOOK_ID,
        cfi: 'epubcfi(/6/2!/4/2/1:0)',
        text: 'pinned highlight',
        color: '#ffcc00',
        createdAt: 1717000000001,
      },
    });
  });
}

/** Seed the IDB side (static manifest with a binary cover + locations). */
async function seedAppDatabase(): Promise<void> {
  const db = await getDB();
  const manifest = {
    bookId: BOOK_ID,
    title: 'Round-Trip Book',
    author: 'Ada Lovelace',
    schemaVersion: 1,
    fileHash: 'hash-roundtrip',
    fileSize: 12,
    totalChars: 100,
    // Covers are stored as ArrayBuffer (WebKit structured-clone policy).
    coverBlob: new Uint8Array(COVER_BYTES).buffer,
  } as unknown as StaticBookManifest;
  await db.put('static_manifests', manifest);
  await db.put('cache_render_metrics', { bookId: BOOK_ID, locations: 'loc-json-string' });
}

/** generate a manifest and push it through a simulated .json backup file. */
async function generateManifestThroughJsonFile(): Promise<BackupManifestV3> {
  const manifest = await backupService.generateManifest();
  return JSON.parse(JSON.stringify(manifest)) as BackupManifestV3;
}

describe('regression: backup generate→restore round-trip (S.1 entry gate)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await clearAppDatabase();
    await deleteYjsDatabase();
    seedSharedDoc();
    await seedAppDatabase();
  });

  it('round-trips Yjs content, binary covers, and locations through a JSON backup', async () => {
    const manifest = await generateManifestThroughJsonFile();

    expect(manifest.version).toBe(3);
    // v3 invariant: raw binary never enters the JSON file.
    expect((manifest.staticManifests[0] as Record<string, unknown>).coverBlob).toBeUndefined();
    expect(typeof manifest.staticManifests[0].coverBlobBase64).toBe('string');

    // Capture expected content AFTER generate (the store modules imported by
    // generateManifest's semantic-tree payload bind to the shared doc).
    const expectedLibrary = getYDoc().getMap('library').toJSON();
    const expectedAnnotations = getYDoc().getMap('annotations').toJSON();

    // Simulate restoring onto a fresh device: app DB emptied first.
    await clearAppDatabase();

    await backupService.processManifest(manifest);

    // Static manifest restored with the cover bytes intact.
    const db = await getDB();
    const restoredManifest = await db.get('static_manifests', BOOK_ID);
    expect(restoredManifest).toBeDefined();
    expect(restoredManifest!.title).toBe('Round-Trip Book');
    const restoredCover = restoredManifest!.coverBlob as unknown;
    expect(restoredCover).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(restoredCover as ArrayBuffer))).toEqual(COVER_BYTES);
    expect((restoredManifest as unknown as Record<string, unknown>).coverBlobBase64).toBeUndefined();

    // Locations restored into cache_render_metrics.
    const metrics = await db.get('cache_render_metrics', BOOK_ID);
    expect(metrics?.locations).toBe('loc-json-string');

    // Reload-simulated rehydration: a fresh doc built from the raw
    // versicle-yjs rows carries the exact backed-up user data.
    const rehydrated = await hydrateFreshDocFromRawIdb();
    expect(rehydrated.getMap('library').toJSON()).toEqual(expectedLibrary);
    expect(rehydrated.getMap('annotations').toJSON()).toEqual(expectedAnnotations);
    rehydrated.destroy();
  });

  it('pins the raw versicle-yjs write shape: exactly one updates row, byte-identical to the snapshot', async () => {
    const manifest = await generateManifestThroughJsonFile();
    const expectedLibrary = getYDoc().getMap('library').toJSON();

    await backupService.processManifest(manifest);

    const rawDb = await openRawYjsDb();
    try {
      // The store layout BackupService re-implements today (and y-idb owns
      // after P3-11): an auto-increment 'updates' store + a 'custom' store.
      expect(Array.from(rawDb.objectStoreNames).sort()).toEqual(['custom', 'updates']);

      const rows = (await getAllRows(rawDb, 'updates')) as Uint8Array[];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toBeInstanceOf(Uint8Array);

      // Byte-identical to the (JSON-round-tripped) manifest snapshot.
      expect(Array.from(rows[0])).toEqual(Array.from(base64ToBytes(manifest.yjsSnapshot)));

      // That single row alone hydrates a fresh doc to the backed-up state.
      const fresh = new Y.Doc();
      Y.applyUpdate(fresh, rows[0]);
      expect(fresh.getMap('library').toJSON()).toEqual(expectedLibrary);
      const books = fresh.getMap('library').toJSON().books as Record<string, { title: string }>;
      expect(books[BOOK_ID]?.title).toBe('Round-Trip Book');
      fresh.destroy();
    } finally {
      rawDb.close();
    }
  });
});
