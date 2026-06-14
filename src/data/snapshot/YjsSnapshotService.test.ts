/**
 * S.3 + apply primitives — YjsSnapshotService contract
 * (plan/overhaul/prep/phase3-storage-gateway.md §Test plan "S", PR P3-11).
 *
 * The end-to-end backup round-trip (S.1) lives in
 * src/lib/BackupService.roundtrip.test.ts and the checkpoint ordering pins
 * (S.2) in src/lib/sync/CheckpointService.test.ts — this suite covers the
 * primitives in isolation: capture/apply round-trip through fake-indexeddb,
 * validateSnapshot's reject set, durability of applySnapshot's resolution,
 * and that the write goes through the exclusive IDB write gate.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-idb';
import {
  captureDoc,
  validateSnapshot,
  applySnapshot,
  readSnapshot,
  deleteYjsDatabase,
  YJS_DB_NAME,
  YJS_STAGING_DB_NAME,
} from './YjsSnapshotService';
import { runExclusiveIdbWrite, idbWriteLockIdle } from '../write-gate';
import { AppError } from '~types/errors';

let nameCounter = 0;
const uniqueName = (label: string) => `snapshot-service-${label}-${++nameCounter}`;

const live: IndexeddbPersistence[] = [];
afterEach(async () => {
  await Promise.all(live.splice(0).map((p) => p.destroy().catch(() => undefined)));
  await idbWriteLockIdle();
});

async function readUpdateRows(name: string): Promise<Uint8Array[]> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<Uint8Array[]>((resolve, reject) => {
      const tx = db.transaction(['updates'], 'readonly');
      const request = tx.objectStore('updates').getAll();
      request.onsuccess = () => resolve(request.result as Uint8Array[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

describe('YjsSnapshotService', () => {
  it('defaults to the versicle-yjs database name', () => {
    expect(YJS_DB_NAME).toBe('versicle-yjs');
  });

  it('captureDoc → applySnapshot → fresh provider hydration round-trips content', async () => {
    const name = uniqueName('roundtrip');

    const source = new Y.Doc();
    source.getMap('library').set('book-1', { title: 'Primitive Book', tags: ['a'] });
    source.getMap('annotations').set('ann-1', { text: 'note', color: '#fc0' });
    const snapshot = captureDoc(source);

    validateSnapshot(snapshot); // never throws for a real capture
    await applySnapshot(snapshot, { dbName: name });

    // Exactly one row, byte-identical (the S.1 write-shape invariant).
    const rows = await readUpdateRows(name);
    expect(rows).toHaveLength(1);
    expect(Array.from(rows[0])).toEqual(Array.from(snapshot));

    // A real y-idb session (what the next boot does) hydrates the content.
    const docB = new Y.Doc();
    const provider = new IndexeddbPersistence(name, docB);
    live.push(provider);
    await provider.whenSynced;
    expect(docB.getMap('library').toJSON()).toEqual(source.toJSON().library);
    expect(docB.getMap('annotations').toJSON()).toEqual(source.toJSON().annotations);
    source.destroy();
  });

  it('applySnapshot replaces prior persisted state (clear-then-write)', async () => {
    const name = uniqueName('replace');

    const first = new Y.Doc();
    first.getMap('m').set('old', 1);
    await applySnapshot(captureDoc(first), { dbName: name });
    first.destroy();

    const second = new Y.Doc();
    second.getMap('m').set('new', 2);
    const snapshot = captureDoc(second);
    await applySnapshot(snapshot, { dbName: name });
    second.destroy();

    const rows = await readUpdateRows(name);
    expect(rows).toHaveLength(1);
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, rows[0]);
    expect(fresh.getMap('m').toJSON()).toEqual({ new: 2 });
    fresh.destroy();
  });

  describe('S.3 validateSnapshot rejects garbage before anything destructive can run', () => {
    it('rejects an empty update', () => {
      expect(() => validateSnapshot(new Uint8Array(0))).toThrowError(AppError);
      try {
        validateSnapshot(new Uint8Array(0));
        expect.unreachable();
      } catch (e) {
        expect((e as AppError).code).toBe('BACKUP_SNAPSHOT_INVALID');
      }
    });

    it('rejects garbage bytes', () => {
      const garbage = new TextEncoder().encode('definitely not a yjs update');
      try {
        validateSnapshot(garbage);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe('BACKUP_SNAPSHOT_INVALID');
      }
    });

    it('rejects a truncated real update', () => {
      const doc = new Y.Doc();
      doc.getMap('m').set('content', 'long enough to truncate meaningfully');
      const full = captureDoc(doc);
      doc.destroy();
      const truncated = full.slice(0, Math.floor(full.byteLength / 2));
      try {
        validateSnapshot(truncated);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe('BACKUP_SNAPSHOT_INVALID');
      }
    });

    it('accepts the empty-doc update (an empty backup is legal, not garbage)', () => {
      const empty = new Y.Doc();
      const update = captureDoc(empty); // 2-byte "no content" update
      empty.destroy();
      expect(() => validateSnapshot(update)).not.toThrow();
    });
  });

  it('applySnapshot runs through the exclusive IDB write gate (cannot overlap a held writer)', async () => {
    const name = uniqueName('gated');
    const doc = new Y.Doc();
    doc.getMap('m').set('k', 'v');
    const snapshot = captureDoc(doc);
    doc.destroy();

    // Hold the gate; the snapshot write must not complete while it is held.
    let releaseGate!: () => void;
    const gateHeld = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    const holder = runExclusiveIdbWrite(() => gateHeld);

    let applied = false;
    const applying = applySnapshot(snapshot, { dbName: name }).then(() => {
      applied = true;
    });

    // Give the apply ample opportunity to (incorrectly) bypass the gate.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(applied).toBe(false);

    releaseGate();
    await holder;
    await applying;
    expect(applied).toBe(true);
    expect(await readUpdateRows(name)).toHaveLength(1);
  });

  describe('staged-swap primitives (Phase 4 §D4: readSnapshot / deleteYjsDatabase)', () => {
    it('exports the staging database name next to the main one', () => {
      expect(YJS_STAGING_DB_NAME).toBe('versicle-yjs-staging');
    });

    it('readSnapshot round-trips applySnapshot and is null on an empty database', async () => {
      const name = uniqueName('read');
      await expect(readSnapshot({ dbName: name })).resolves.toBeNull();

      const source = new Y.Doc();
      source.getMap('library').set('staged', 'blob');
      const update = captureDoc(source);
      source.destroy();
      await applySnapshot(update, { dbName: name });

      const read = await readSnapshot({ dbName: name });
      expect(read).not.toBeNull();
      expect(Array.from(read!)).toEqual(Array.from(update));
    });

    it('deleteYjsDatabase removes the database (readSnapshot turns null again)', async () => {
      const name = uniqueName('delete');
      const source = new Y.Doc();
      source.getMap('m').set('k', 'v');
      await applySnapshot(captureDoc(source), { dbName: name });
      source.destroy();
      await expect(readSnapshot({ dbName: name })).resolves.not.toBeNull();

      await deleteYjsDatabase({ dbName: name });
      await expect(readSnapshot({ dbName: name })).resolves.toBeNull();
    });
  });
});
