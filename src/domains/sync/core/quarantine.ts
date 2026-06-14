/**
 * Doc-level quarantine primitives (phase4-sync-strangler.md §D5) — the
 * version reads behind the three enforcement layers:
 *
 *  1. PRE-ATTACH/PRE-APPLY GATES — `readUpdateSchemaVersion` proves a
 *     downloaded state blob's version on a scratch doc BEFORE any byte
 *     touches the live doc (performCleanSync, switchWorkspace), and the
 *     workspace-metadata `schemaVersion` probe locks an offline-during-
 *     fleet-migration client before connect.
 *  2. LIVE OBSERVER — the connect path observes `meta.schemaVersion` on
 *     the live doc (synchronous on transaction commit) and severs the
 *     provider on a version from the future.
 *  3. METADATA MAINTENANCE — after migration the orchestrator stamps the
 *     workspace metadata with the doc's version so layer 1 stays honest.
 *
 * `readDocSchemaVersion` is the migration coordinator's exact read,
 * RELOCATED here (src/app/migrations.ts re-exports it): P4 is the designed
 * first reader of the v6 `meta` map (program rule 5 — its write shipped one
 * release earlier), and `max(meta, library) || 1` tolerates partial
 * dual-writes so a half-stamped doc can never false-positive a quarantine
 * (risk R4).
 */
import * as Y from 'yjs';

/**
 * Doc schema version: `max(meta.schemaVersion, library.__schemaVersion) || 1`.
 * The max tolerates partial dual-writes (N+1 staging, program rule 5); a doc
 * carrying neither key reads as v1 (the pre-versioning era).
 */
export function readDocSchemaVersion(doc: Y.Doc): number {
  const metaVersion = doc.getMap('meta').get('schemaVersion');
  const libraryVersion = doc.getMap('library').get('__schemaVersion');
  return (
    Math.max(
      typeof metaVersion === 'number' ? metaVersion : 0,
      typeof libraryVersion === 'number' ? libraryVersion : 0,
    ) || 1
  );
}

/**
 * Version of an encoded state update, proven on a throwaway scratch doc —
 * the synchronous pre-apply check. Never touches live state; a malformed
 * update throws (callers route that to their existing failure paths).
 */
export function readUpdateSchemaVersion(update: Uint8Array): number {
  const scratch = new Y.Doc();
  try {
    Y.applyUpdate(scratch, update);
    return readDocSchemaVersion(scratch);
  } finally {
    scratch.destroy();
  }
}
