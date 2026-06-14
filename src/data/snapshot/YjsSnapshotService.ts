/**
 * Doc-agnostic Yjs snapshot primitives (Phase 3, D6 in
 * plan/overhaul/prep/phase3-storage-gateway.md).
 *
 * One tested implementation of the capture → validate → apply dance that
 * BackupService, CheckpointService, and the (since-deleted, ADR 0002)
 * android-backup module each hand-rolled:
 * BackupService re-implemented y-idb's store layout with a raw
 * `indexedDB.open('versicle-yjs')` plus a 1000 ms "wait for flush" sleep;
 * CheckpointService span up a temp Y.Doc + temp IndexeddbPersistence and
 * relied on `IDBDatabase.close()` semantics for durability. Both now call
 * these three primitives; the layout knowledge lives in the vendored y-idb
 * fork (`writeSnapshot`), and durability is the fork's commit-awaited
 * contract (packages/y-idb/PROVENANCE.md surgeries 2–3).
 *
 * Layering: the LIVE doc is always PASSED IN, never imported — this module
 * must not know about `@store/yjs-provider` (data/ stays below state/, so
 * every primitive here remains importable from the TTS worker and from
 * future non-store contexts). The orchestration (which doc, when to
 * disconnect, when to reload) stays with the callers.
 */
import * as Y from 'yjs';
import { writeSnapshot, readSnapshot as readSnapshotRows, clearDocument } from 'y-idb';
import { AppError } from '~types/errors';
import { runExclusiveIdbWrite } from '../write-gate';

/** The IndexedDB database name the app's y-idb persistence binds to. */
export const YJS_DB_NAME = 'versicle-yjs';

/**
 * The durable local staging database for the Phase 4 crash-resumable
 * workspace switch (phase4-sync-strangler.md §D4): the verified remote blob
 * is staged here BEFORE the state machine commits, and the boot
 * interceptor's STAGED arm applies main ← staging idempotently. Named here
 * (next to YJS_DB_NAME) so `wipeAllData` can include it without importing
 * upwards into domains/.
 */
export const YJS_STAGING_DB_NAME = 'versicle-yjs-staging';

/**
 * Capture the full state of `doc` as a single binary update (the snapshot
 * format used by backups v2/v3, checkpoints, and workspace switches).
 */
export function captureDoc(doc: Y.Doc): Uint8Array {
  return Y.encodeStateAsUpdate(doc);
}

/**
 * Prove `update` is an applicable Yjs update WITHOUT touching any live
 * state: dry-runs `Y.applyUpdate` on a scratch doc (the same check
 * BackupService's restore performs as its validate-before-destroy step).
 *
 * @throws AppError `BACKUP_SNAPSHOT_INVALID` for empty, truncated, or
 *   garbage updates. Callers on a destructive path MUST run this before
 *   their first destructive step.
 */
export function validateSnapshot(update: Uint8Array): void {
  if (!(update instanceof Uint8Array) || update.byteLength === 0) {
    throw new AppError('Snapshot is empty or not a byte array.', {
      code: 'BACKUP_SNAPSHOT_INVALID',
      context: { byteLength: update?.byteLength ?? null },
    });
  }
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, update);
  } catch (cause) {
    throw new AppError('Snapshot is not a decodable Yjs update.', {
      code: 'BACKUP_SNAPSHOT_INVALID',
      cause,
      context: { byteLength: update.byteLength },
    });
  } finally {
    scratch.destroy();
  }
}

/**
 * Replace the persisted Yjs state of `dbName` with `update`, durably: the
 * promise resolves only after the write transaction has COMMITTED, so the
 * caller may reload the page immediately afterwards.
 *
 * Implementation: the vendored fork's `writeSnapshot` (open/create with
 * y-idb's own store layout → clear `updates` → one snapshot row → commit),
 * run through the cross-context exclusive write gate so it can never
 * overlap another IndexedDB writer (the WebKit-hang discipline).
 *
 * PRECONDITION (documented; structurally unverifiable from data/ — the
 * provider handle lives above this layer): the live y-idb binding for
 * `dbName` is destroyed/disconnected. A live binding could interleave its
 * own debounced update rows with the snapshot. In DEV the update is
 * re-validated as a cheap last line of defense before anything is written.
 */
export async function applySnapshot(
  update: Uint8Array,
  opts?: { dbName?: string },
): Promise<void> {
  const dbName = opts?.dbName ?? YJS_DB_NAME;
  if (import.meta.env.DEV) {
    // Callers validate before their destructive step; this re-check makes
    // "applySnapshot wrote garbage" unrepresentable in DEV regardless.
    validateSnapshot(update);
  }
  await writeSnapshot(dbName, update, { transactionRunner: runExclusiveIdbWrite });
}

/**
 * Read the complete persisted Yjs state of `dbName` as one merged update,
 * without constructing a live persistence binding — `null` when the
 * database holds no updates (missing database included). The boot-time read
 * half of the staged workspace swap (the interceptor reads
 * `YJS_STAGING_DB_NAME` before any provider exists).
 *
 * Runs through the exclusive write gate purely for serialization: a read
 * can never interleave a concurrent `applySnapshot` on the same database.
 */
export async function readSnapshot(opts?: { dbName?: string }): Promise<Uint8Array | null> {
  const dbName = opts?.dbName ?? YJS_DB_NAME;
  return readSnapshotRows(dbName, { transactionRunner: runExclusiveIdbWrite });
}

/**
 * Delete the Yjs database `dbName` outright (the fork's `clearDocument`,
 * i.e. `indexedDB.deleteDatabase`). Used to clear staging junk before a new
 * stage write, to drop staging after a finalized switch, and as the
 * wipe-main step of the staged apply when no live persistence binding
 * exists (boot time — `persistence.clearData()` needs a binding).
 *
 * PRECONDITION: no live y-idb binding on `dbName` in THIS tab (the deletion
 * would otherwise block on our own open connection). Other tabs holding the
 * database open delay the deletion — the same exposure the legacy
 * `clearData()` path had.
 */
export async function deleteYjsDatabase(opts?: { dbName?: string }): Promise<void> {
  const dbName = opts?.dbName ?? YJS_DB_NAME;
  await runExclusiveIdbWrite(() => Promise.resolve(clearDocument(dbName)), `deleteYjsDatabase(${dbName})`);
}
