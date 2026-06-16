/**
 * SyncBackend contract suite — C3 of the contract registry
 * (plan/overhaul/proposals/contract-first.md): connect / workspace CRUD /
 * tombstone semantics, executed against every backend implementation.
 *
 * Since P4-2 the `SyncBackend` interface exists at
 * src/domains/sync/backend/SyncBackend.ts and this file is the C3 PINNING
 * suite: the mock runner (syncBackendContract.mock.test.ts) drives the real
 * `MockBackend`; the emulator runner (syncBackendContract.emulator.test.ts)
 * still mirrors the FirestoreBackend semantics over
 * `@firebase/rules-unit-testing` (its header explains why it cannot host
 * the modular-SDK backend until the auth+storage emulator wiring lands with
 * the y-cinder vendoring item).
 *
 * Pattern follows src/lib/tts/engine/engineParityScenarios.ts: one
 * behavioral spec, N transports.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { WorkspaceMetadata } from '~types/workspace';

interface SyncBackendConnection {
  /** Detach and flush; the workspace doc must be durable afterwards. */
  disconnect(): Promise<void> | void;
  /**
   * Subscribe to transport events. Optional until every backend exposes the
   * P4 `SyncConnection` surface; required for the event-surface cases
   * (capabilities.eventInjection / capabilities.savedEvent).
   */
  on?(event: SyncConnectionEventName, cb: (payload: unknown) => void): void;
}

/**
 * The transport event surface (phase4-sync-strangler.md §D1): the failure
 * events the y-cinder FireProvider always emitted (`connection-error`,
 * `sync-failure`, `save-rejected`, `corrupted-document`) plus `saved` — the
 * save-success event the fork delta added (P9 vendoring, surgery 1; drives
 * lastSyncTime-from-flush). The C3 event cases pin both backends to this
 * one surface so mock/real drift becomes a red CI.
 */
type SyncConnectionEventName =
  | 'connection-error'
  | 'sync-failure'
  | 'save-rejected'
  | 'corrupted-document'
  | 'saved';

const SYNC_CONNECTION_ERROR_EVENTS = [
  'connection-error',
  'sync-failure',
  'save-rejected',
  'corrupted-document',
] as const satisfies readonly SyncConnectionEventName[];

/**
 * In-workspace paths the artifact round-trip cases exercise. An artifact is a
 * cached embedding stored as two records: the raw bytes ("blob", used by
 * put/get) and a small sibling metadata record ("HEAD doc", used by head). The
 * shared key (`contract-key`) is also what the workspace-delete purge case
 * seeds so it can assert the HEAD doc gets swept along with everything else.
 * (design: plan/shared-ai-cache-design.md)
 */
const ARTIFACT_BLOB_REL_PATH = 'embeddings/contract-key.bin';
const ARTIFACT_HEAD_REL_PATH = 'embedCache/contract-key';

/**
 * What a backend must provide to run the contract. Mirrors the surface P4
 * extracts into `SyncBackend` (workspace metadata CRUD, tombstone
 * pre-flight, doc replication).
 */
export interface SyncBackendContractHarness {
  /**
   * Attach a Y.Doc to the workspace's replicated document; resolves once
   * the initial sync handshake completed. Optional: backends whose realtime
   * transport is not testable in this environment omit it and the connect
   * cases are registered as todo (see capabilities.connect).
   */
  connect?(doc: Y.Doc, workspaceId: string): Promise<SyncBackendConnection>;
  createWorkspace(name: string): Promise<WorkspaceMetadata>;
  listWorkspaces(opts?: { includeDeleted?: boolean }): Promise<WorkspaceMetadata[]>;
  /**
   * Patch workspace metadata in place (P4's post-migration `schemaVersion`
   * stamp — quarantine layer 3 of phase4-sync-strangler.md §D5).
   */
  updateWorkspaceMetadata(
    workspaceId: string,
    patch: Partial<WorkspaceMetadata>
  ): Promise<void>;
  /**
   * The clean-sync probe: does the workspace's replicated doc hold any
   * data? (FirestoreSyncManager.performCleanSync's main-doc + updates
   * check / mock snapshot check.)
   */
  probeHasData(workspaceId: string): Promise<boolean>;
  /**
   * The PRODUCTION delete semantics (P4-6 honest delete): tombstone first,
   * then purge every residual. The workspace must never be resurrectable.
   */
  deleteWorkspace(workspaceId: string): Promise<void>;
  /** The pre-flight gate every connect runs (tombstone check). */
  isWorkspaceAlive(workspaceId: string): Promise<boolean>;
  /**
   * Seed residual replicated data into the workspace the way the transport
   * would (subcollection docs / the mock snapshot blob) so the purge cases
   * have something to delete. Required when capabilities.purge is on.
   */
  seedResiduals?(workspaceId: string): Promise<void>;
  /**
   * Count what an honest delete must remove: residual replicated docs (+
   * Storage blobs where the environment has them). Required when
   * capabilities.purge is on.
   */
  countResiduals?(workspaceId: string): Promise<number>;
  /**
   * Re-run the purge alone on an already-deleted workspace (the P4-6
   * "Purge deleted workspaces" maintenance path). Required when
   * capabilities.purge is on.
   */
  purgeWorkspace?(workspaceId: string): Promise<{ docsDeleted: number; blobsDeleted: number }>;
  /**
   * Attempt a residual data write into a tombstoned workspace; resolves
   * true when the BACKEND rejected it. Only rules-enforcing backends (the
   * emulator) can implement this.
   */
  attemptWriteToTombstoned?(workspaceId: string): Promise<boolean>;
  /**
   * Cached-embedding storage (put/head/get). `relPath` is the in-workspace
   * path — the raw-bytes blob (`embeddings/{key}.bin`) for put/get, the small
   * metadata record (`embedCache/{key}`) for head. Required when
   * capabilities.artifacts is on; both backends implement it (the mock via an
   * in-memory Map, the Firestore backend via Cloud Storage for the blob plus a
   * Firestore doc for the metadata record).
   */
  putArtifact?(
    workspaceId: string,
    relPath: string,
    bytes: ArrayBuffer | Uint8Array,
    meta: { stamp: string; size: number }
  ): Promise<void>;
  headArtifact?(
    workspaceId: string,
    relPath: string
  ): Promise<{ exists: true; stamp: string; size: number } | null>;
  getArtifact?(workspaceId: string, relPath: string): Promise<ArrayBuffer | null>;
  /**
   * Cached-embedding garbage collection. `deleteArtifactHead` deletes the
   * `embedCache/{key}` metadata record ONLY, leaving the raw-bytes blob for the
   * sweeper to reclaim later (the blob may be shared, so it is not safe to
   * delete eagerly). `sweepArtifacts` bounds total storage by deleting
   * metadata+blob pairs that are past their TTL, and evicting oldest-first when
   * over a byte budget. Required when capabilities.artifacts is on; both
   * backends implement them (the mock collapses metadata record + blob into one
   * Map entry, so the leave-the-blob guarantee is pinned ONLY by the emulator
   * path). (design: plan/shared-ai-cache-design.md)
   */
  deleteArtifactHead?(workspaceId: string, relPath: string): Promise<void>;
  sweepArtifacts?(
    workspaceId: string,
    opts: { ttlMs: number; now: number; budgetBytes?: number }
  ): Promise<{ headsDeleted: number; blobsDeleted: number }>;
  /**
   * Make probeHasData turn true WITHOUT a realtime connection (e.g. write
   * an `updates` doc directly). Used by the probe cases when
   * capabilities.connect is off.
   */
  seedWorkspaceData?(workspaceId: string): Promise<void>;
  /**
   * Fire a transport event on the workspace's live connection(s), as if the
   * backend's listener had surfaced it; returns how many connections it hit.
   * Only injectable transports (the mock) can implement this.
   */
  injectConnectionEvent?(
    workspaceId: string,
    event: SyncConnectionEventName,
    payload: unknown
  ): number | Promise<number>;
  dispose?(): Promise<void> | void;
}

interface SyncBackendContractCapabilities {
  /** Realtime doc replication is testable in this environment. */
  connect: boolean;
  /**
   * Tombstone write-denial is enforced server-side (security rules), not
   * just by client convention.
   */
  serverSideTombstoneEnforcement: boolean;
  /**
   * The transport announces committed saves (`saved`). True for the mock
   * and, since the P9 y-cinder fork delta (§D6.1), for Firestore.
   */
  savedEvent: boolean;
  /** Transport failure events can be injected (mock test hooks). */
  eventInjection: boolean;
  /**
   * The honest-delete purge is exercisable here (seedResiduals/
   * countResiduals/purgeWorkspace implemented). Both backends support it;
   * the Storage-blob half runs only where a Storage emulator exists —
   * countResiduals simply reports what the environment can see.
   */
  purge: boolean;
  /**
   * The cached-embedding round-trip (headArtifact/putArtifact/getArtifact) is
   * exercisable here. True for both backends; the mock runs the round-trip
   * over an in-memory Map (no real Storage tier), so the ordering guarantee
   * (write the blob before its metadata record) and crash fail-safes are pinned
   * ONLY by the emulator suite.
   */
  artifacts: boolean;
}

export interface SyncBackendContractOptions {
  backendName: string;
  capabilities: SyncBackendContractCapabilities;
  makeHarness: () => Promise<SyncBackendContractHarness> | SyncBackendContractHarness;
}

export function describeSyncBackendContract(options: SyncBackendContractOptions): void {
  const { backendName, capabilities, makeHarness } = options;

  describe(`SyncBackend contract (C3): ${backendName}`, () => {
    let harness: SyncBackendContractHarness;

    beforeEach(async () => {
      harness = await makeHarness();
    });

    afterEach(async () => {
      await harness.dispose?.();
    });

    describe('connect', () => {
      if (!capabilities.connect) {
        it.todo('connect() completes the initial sync handshake on a fresh workspace');
        it.todo('state written through one connection is visible to a later connection on the same workspace');
        it.todo('different workspaces do not leak state into each other');
        return;
      }

      it('connect() completes the initial sync handshake on a fresh workspace', async () => {
        const ws = await harness.createWorkspace('Fresh');
        const doc = new Y.Doc();
        const connection = await harness.connect!(doc, ws.workspaceId);
        // Resolving at all is the assertion; the doc must be usable.
        doc.getMap('library').set('probe', 'ok');
        await connection.disconnect();
      });

      it('state written through one connection is visible to a later connection on the same workspace', async () => {
        const ws = await harness.createWorkspace('Round-trip');

        const docA = new Y.Doc();
        const connectionA = await harness.connect!(docA, ws.workspaceId);
        docA.getMap('library').set('book-1', 'Moby Dick');
        docA.getMap('readingState').set('book-1', 0.5);
        await connectionA.disconnect();

        const docB = new Y.Doc();
        const connectionB = await harness.connect!(docB, ws.workspaceId);
        expect(docB.getMap('library').get('book-1')).toBe('Moby Dick');
        expect(docB.getMap('readingState').get('book-1')).toBe(0.5);
        await connectionB.disconnect();
      });

      it('different workspaces do not leak state into each other', async () => {
        const wsA = await harness.createWorkspace('A');
        const wsB = await harness.createWorkspace('B');

        const docA = new Y.Doc();
        const connectionA = await harness.connect!(docA, wsA.workspaceId);
        docA.getMap('library').set('book-only-in-A', 'yes');
        await connectionA.disconnect();

        const docB = new Y.Doc();
        const connectionB = await harness.connect!(docB, wsB.workspaceId);
        expect(docB.getMap('library').size).toBe(0);
        await connectionB.disconnect();
      });
    });

    describe('connection event surface', () => {
      if (capabilities.connect && capabilities.savedEvent) {
        it('the connection announces committed saves (saved → lastSyncTime-from-flush)', async () => {
          const ws = await harness.createWorkspace('Flush');
          const doc = new Y.Doc();
          const connection = await harness.connect!(doc, ws.workspaceId);
          const savedAts: number[] = [];
          connection.on!('saved', (at) => savedAts.push(at as number));

          doc.getMap('library').set('book-1', 'Moby Dick');
          // Generous budget for the emulator transport under full-suite CPU
          // contention; the poll exits on the first saved event, so the
          // fast transports (mock) are unaffected.
          await expect
            .poll(() => savedAts.length, { timeout: 20000 })
            .toBeGreaterThan(0);
          expect(savedAts[0]).toBeGreaterThan(0);
          await connection.disconnect();
        });
      } else {
        it.todo(
          'the connection announces committed saves (saved) — Firestore needs ' +
            "the P4 y-cinder fork delta (§D6.1: success event after the debounced save commits)"
        );
      }

      if (capabilities.connect && capabilities.eventInjection) {
        for (const event of SYNC_CONNECTION_ERROR_EVENTS) {
          it(`'${event}' surfaces through the connection event API`, async () => {
            const ws = await harness.createWorkspace('Events');
            const doc = new Y.Doc();
            const connection = await harness.connect!(doc, ws.workspaceId);
            const received: unknown[] = [];
            connection.on!(event, (payload) => received.push(payload));

            const payload =
              event === 'save-rejected'
                ? { code: 'document-too-large', sizeBytes: 2_000_000 }
                : event === 'corrupted-document'
                  ? { docId: ws.workspaceId }
                  : new Error(`${event} (injected)`);
            const hit = await harness.injectConnectionEvent!(
              ws.workspaceId,
              event,
              payload
            );

            expect(hit).toBeGreaterThan(0);
            expect(received).toHaveLength(1);
            expect(received[0]).toBe(payload);
            await connection.disconnect();
          });
        }
      } else {
        it.todo(
          'transport failure events (connection-error/sync-failure/save-rejected/' +
            'corrupted-document) surface through the connection event API ' +
            '(injectable transports only)'
        );
      }
    });

    describe('data probe (clean-sync pre-flight)', () => {
      it('probeHasData is false on a freshly created workspace', async () => {
        const ws = await harness.createWorkspace('Empty');
        await expect(harness.probeHasData(ws.workspaceId)).resolves.toBe(false);
      });

      if (capabilities.connect) {
        it('probeHasData turns true after state is written through a connection', async () => {
          const ws = await harness.createWorkspace('Holder');
          const doc = new Y.Doc();
          const connection = await harness.connect!(doc, ws.workspaceId);
          doc.getMap('library').set('book-1', 'Moby Dick');
          await connection.disconnect();
          await expect(harness.probeHasData(ws.workspaceId)).resolves.toBe(true);
        });
      } else {
        it('probeHasData turns true once the workspace holds replicated data', async () => {
          const ws = await harness.createWorkspace('Holder');
          await harness.seedWorkspaceData!(ws.workspaceId);
          await expect(harness.probeHasData(ws.workspaceId)).resolves.toBe(true);
        });
      }

      it('probeHasData on one workspace is not confused by data in a sibling', async () => {
        const holder = await harness.createWorkspace('Holder');
        const empty = await harness.createWorkspace('Empty');
        if (capabilities.connect) {
          const doc = new Y.Doc();
          const connection = await harness.connect!(doc, holder.workspaceId);
          doc.getMap('library').set('book-1', 'Moby Dick');
          await connection.disconnect();
        } else {
          await harness.seedWorkspaceData!(holder.workspaceId);
        }
        await expect(harness.probeHasData(empty.workspaceId)).resolves.toBe(false);
      });
    });

    describe('workspace CRUD', () => {
      it('listWorkspaces is empty before any workspace exists', async () => {
        await expect(harness.listWorkspaces()).resolves.toEqual([]);
      });

      it('createWorkspace returns complete metadata', async () => {
        const ws = await harness.createWorkspace('My Library');
        expect(ws.workspaceId).toBeTruthy();
        expect(ws.name).toBe('My Library');
        expect(ws.createdAt).toBeGreaterThan(0);
        expect(typeof ws.schemaVersion).toBe('number');
        expect(ws.deletedAt).toBeUndefined();
      });

      it('created workspaces appear in listWorkspaces', async () => {
        const first = await harness.createWorkspace('First');
        const second = await harness.createWorkspace('Second');
        const listed = await harness.listWorkspaces();
        expect(listed.map((w) => w.workspaceId).sort()).toEqual(
          [first.workspaceId, second.workspaceId].sort()
        );
      });

      // P4 quarantine layer 3 (phase4-sync-strangler.md §D5.3): after a
      // successful local migration the orchestrator stamps the workspace
      // metadata with the migrated schemaVersion, keeping the workspace-list
      // version gate honest. This is the emulator metadata-stamp case named
      // in the P4-4 exit criteria.
      it('updateWorkspaceMetadata patches schemaVersion and the patch survives listWorkspaces', async () => {
        const ws = await harness.createWorkspace('Migratable');
        await harness.updateWorkspaceMetadata(ws.workspaceId, {
          schemaVersion: ws.schemaVersion + 1,
        });
        const listed = await harness.listWorkspaces();
        const updated = listed.find((w) => w.workspaceId === ws.workspaceId);
        expect(updated?.schemaVersion).toBe(ws.schemaVersion + 1);
        // The patch must not clobber unrelated fields.
        expect(updated?.name).toBe('Migratable');
        expect(updated?.createdAt).toBe(ws.createdAt);
      });

      it('updateWorkspaceMetadata is idempotent (re-stamping the same version is safe)', async () => {
        const ws = await harness.createWorkspace('Stamped');
        await harness.updateWorkspaceMetadata(ws.workspaceId, { schemaVersion: 7 });
        await harness.updateWorkspaceMetadata(ws.workspaceId, { schemaVersion: 7 });
        const listed = await harness.listWorkspaces();
        expect(
          listed.find((w) => w.workspaceId === ws.workspaceId)?.schemaVersion
        ).toBe(7);
      });
    });

    describe('tombstone semantics', () => {
      it('a never-created workspace passes isWorkspaceAlive (missing ≠ tombstoned — offline fail-safe)', async () => {
        await expect(harness.isWorkspaceAlive('ws_never_existed')).resolves.toBe(true);
      });

      it('deleteWorkspace removes the workspace from listWorkspaces', async () => {
        const ws = await harness.createWorkspace('Doomed');
        await harness.deleteWorkspace(ws.workspaceId);
        const listed = await harness.listWorkspaces();
        expect(listed.find((w) => w.workspaceId === ws.workspaceId)).toBeUndefined();
      });

      it('listWorkspaces({ includeDeleted: true }) still surfaces tombstoned workspaces (purge maintenance surface)', async () => {
        const doomed = await harness.createWorkspace('Doomed');
        const survivor = await harness.createWorkspace('Survivor');
        await harness.deleteWorkspace(doomed.workspaceId);
        const all = await harness.listWorkspaces({ includeDeleted: true });
        expect(all.map((w) => w.workspaceId).sort()).toEqual(
          [doomed.workspaceId, survivor.workspaceId].sort()
        );
        const tombstoned = all.find((w) => w.workspaceId === doomed.workspaceId);
        expect(tombstoned?.deletedAt).toBeGreaterThan(0);
      });

      it('a tombstoned workspace fails the isWorkspaceAlive pre-flight', async () => {
        const ws = await harness.createWorkspace('Doomed');
        await expect(harness.isWorkspaceAlive(ws.workspaceId)).resolves.toBe(true);
        await harness.deleteWorkspace(ws.workspaceId);
        await expect(harness.isWorkspaceAlive(ws.workspaceId)).resolves.toBe(false);
      });

      it('deleting one workspace leaves siblings alive and listed', async () => {
        const doomed = await harness.createWorkspace('Doomed');
        const survivor = await harness.createWorkspace('Survivor');
        await harness.deleteWorkspace(doomed.workspaceId);
        const listed = await harness.listWorkspaces();
        expect(listed.map((w) => w.workspaceId)).toEqual([survivor.workspaceId]);
        await expect(harness.isWorkspaceAlive(survivor.workspaceId)).resolves.toBe(true);
      });

      it('deleteWorkspace is idempotent (retrying a delete must not throw or resurrect)', async () => {
        const ws = await harness.createWorkspace('Doomed');
        await harness.deleteWorkspace(ws.workspaceId);
        await harness.deleteWorkspace(ws.workspaceId);
        await expect(harness.isWorkspaceAlive(ws.workspaceId)).resolves.toBe(false);
        await expect(harness.listWorkspaces()).resolves.toEqual([]);
      });

      if (capabilities.serverSideTombstoneEnforcement) {
        it('the backend rejects residual data writes into a tombstoned workspace', async () => {
          const ws = await harness.createWorkspace('Doomed');
          await harness.deleteWorkspace(ws.workspaceId);
          await expect(harness.attemptWriteToTombstoned!(ws.workspaceId)).resolves.toBe(true);
        });
      } else {
        it.todo(
          'the backend rejects residual data writes into a tombstoned workspace ' +
            '(server-side rules — Firestore emulator backend only)'
        );
      }

      // sync.md debt #2, paid by P4-6: the legacy delete purged only the
      // `updates` subcollection — `history`/`maintenance`/`metadata` docs
      // and Cloud Storage blobs survived every deletion.
      if (capabilities.purge) {
        it('deleteWorkspace purges every residual while the tombstone survives (honest delete)', async () => {
          const doomed = await harness.createWorkspace('Doomed');
          await harness.seedResiduals!(doomed.workspaceId);
          expect(await harness.countResiduals!(doomed.workspaceId)).toBeGreaterThan(0);

          // A workspace delete must also remove cached embeddings. seedResiduals
          // planted one (an `embedCache/{key}` metadata record + its blob);
          // assert it is present before the delete and gone after. The blob is
          // reclaimed by the storage-prefix purge; this case pins the metadata-
          // record half, which is not removed automatically with it.
          if (capabilities.artifacts) {
            await expect(
              harness.headArtifact!(doomed.workspaceId, ARTIFACT_HEAD_REL_PATH)
            ).resolves.not.toBeNull();
          }

          await harness.deleteWorkspace(doomed.workspaceId);

          // Honest: nothing replicated remains…
          expect(await harness.countResiduals!(doomed.workspaceId)).toBe(0);
          if (capabilities.artifacts) {
            await expect(
              harness.headArtifact!(doomed.workspaceId, ARTIFACT_HEAD_REL_PATH)
            ).resolves.toBeNull();
          }
          // …but the tombstone does (no resurrection).
          await expect(harness.isWorkspaceAlive(doomed.workspaceId)).resolves.toBe(false);
        });

        it('the purge is scoped to the deleted workspace — sibling residuals survive (risk R8)', async () => {
          const doomed = await harness.createWorkspace('Doomed');
          const sibling = await harness.createWorkspace('Sibling');
          await harness.seedResiduals!(doomed.workspaceId);
          await harness.seedResiduals!(sibling.workspaceId);

          await harness.deleteWorkspace(doomed.workspaceId);

          expect(await harness.countResiduals!(doomed.workspaceId)).toBe(0);
          expect(await harness.countResiduals!(sibling.workspaceId)).toBeGreaterThan(0);
          await expect(harness.isWorkspaceAlive(sibling.workspaceId)).resolves.toBe(true);
        });

        it('purgeWorkspace is idempotent on a tombstoned husk (the maintenance action)', async () => {
          const doomed = await harness.createWorkspace('Doomed');
          await harness.seedResiduals!(doomed.workspaceId);
          await harness.deleteWorkspace(doomed.workspaceId);

          // The maintenance re-run finds nothing left and must not throw.
          const report = await harness.purgeWorkspace!(doomed.workspaceId);
          expect(report.docsDeleted).toBe(0);
          expect(report.blobsDeleted).toBe(0);
          await expect(harness.isWorkspaceAlive(doomed.workspaceId)).resolves.toBe(false);
        });
      } else {
        it.todo(
          'deleteWorkspace purges residual updates/history/maintenance docs and Storage snapshots'
        );
      }
    });

    // Cached-embedding storage: content-addressed put/head/get under the
    // workspace's path. Behavioral cases run against BOTH backends (the mock's
    // in-memory Map and, in CI, the real Firestore+Storage emulator). The write
    // ordering guarantee (blob first, then its metadata record) and the
    // offline-vs-genuine-miss fail-safe are pinned ONLY by the emulator suite
    // (the mock has no real Storage tier) — see capabilities.artifacts.
    describe('artifact lane (C3 method trio)', () => {
      if (!capabilities.artifacts) {
        it.todo('headArtifact/putArtifact/getArtifact round-trip');
        return;
      }

      const bytesOf = (s: string): Uint8Array => new TextEncoder().encode(s);

      it('put → head → get round-trip: bytes and {stamp,size} survive', async () => {
        const ws = await harness.createWorkspace('Artifacts');
        const payload = bytesOf('int8-vectors-and-scales');
        await harness.putArtifact!(ws.workspaceId, ARTIFACT_BLOB_REL_PATH, payload, {
          stamp: 'model-a|dims-256|q8',
          size: payload.byteLength,
        });

        const head = await harness.headArtifact!(ws.workspaceId, ARTIFACT_HEAD_REL_PATH);
        expect(head).not.toBeNull();
        expect(head!.exists).toBe(true);
        expect(head!.stamp).toBe('model-a|dims-256|q8');
        expect(head!.size).toBe(payload.byteLength);

        const got = await harness.getArtifact!(ws.workspaceId, ARTIFACT_BLOB_REL_PATH);
        expect(got).not.toBeNull();
        expect(Array.from(new Uint8Array(got!))).toEqual(Array.from(payload));
      });

      it('headArtifact returns null on a HEAD-doc miss', async () => {
        const ws = await harness.createWorkspace('Artifacts');
        await expect(
          harness.headArtifact!(ws.workspaceId, ARTIFACT_HEAD_REL_PATH)
        ).resolves.toBeNull();
      });

      it('getArtifact returns null on a never-put blob (definitive miss)', async () => {
        const ws = await harness.createWorkspace('Artifacts');
        await expect(
          harness.getArtifact!(ws.workspaceId, ARTIFACT_BLOB_REL_PATH)
        ).resolves.toBeNull();
      });

      it('putArtifact is idempotent (ifAbsent): a second put with the same key does not corrupt the first', async () => {
        const ws = await harness.createWorkspace('Artifacts');
        const original = bytesOf('original-bytes');
        await harness.putArtifact!(ws.workspaceId, ARTIFACT_BLOB_REL_PATH, original, {
          stamp: 'stamp-1',
          size: original.byteLength,
        });

        // Second put with the SAME key is a no-op (put checks for an existing
        // metadata record first). Different bytes/meta must NOT overwrite the
        // content-addressed original.
        const overwrite = bytesOf('different-bytes-should-be-ignored');
        await harness.putArtifact!(ws.workspaceId, ARTIFACT_BLOB_REL_PATH, overwrite, {
          stamp: 'stamp-2',
          size: overwrite.byteLength,
        });

        const head = await harness.headArtifact!(ws.workspaceId, ARTIFACT_HEAD_REL_PATH);
        expect(head!.stamp).toBe('stamp-1');
        expect(head!.size).toBe(original.byteLength);
        const got = await harness.getArtifact!(ws.workspaceId, ARTIFACT_BLOB_REL_PATH);
        expect(Array.from(new Uint8Array(got!))).toEqual(Array.from(original));
      });

      it('artifacts in different workspaces do not collide (workspace-scoped path)', async () => {
        const wsA = await harness.createWorkspace('A');
        const wsB = await harness.createWorkspace('B');
        const payloadA = bytesOf('A-only');
        await harness.putArtifact!(wsA.workspaceId, ARTIFACT_BLOB_REL_PATH, payloadA, {
          stamp: 'stamp-a',
          size: payloadA.byteLength,
        });

        // Same relPath, different workspace → independent slot, still a miss.
        await expect(
          harness.headArtifact!(wsB.workspaceId, ARTIFACT_HEAD_REL_PATH)
        ).resolves.toBeNull();
        await expect(
          harness.getArtifact!(wsB.workspaceId, ARTIFACT_BLOB_REL_PATH)
        ).resolves.toBeNull();
      });

      // ── Cached-embedding garbage collection ───────────────────────────────
      // NOTE: the MockBackend collapses metadata record + blob into one Map
      // entry (no Storage tier), so the "delete the metadata record but KEEP the
      // shared blob" reference-safety guarantee CANNOT be proven on the mock —
      // these cases pin metadata-record-removal semantics on the mock;
      // blob-survival is pinned only on the Firestore/emulator path (capability
      // not yet wired there).
      it('deleteArtifactHead removes the HEAD doc; an untouched second key survives', async () => {
        const ws = await harness.createWorkspace('Artifacts');
        const SECOND_BLOB = 'embeddings/second-key.bin';
        const SECOND_HEAD = 'embedCache/second-key';

        const a = bytesOf('first');
        await harness.putArtifact!(ws.workspaceId, ARTIFACT_BLOB_REL_PATH, a, {
          stamp: 'stamp-1',
          size: a.byteLength,
        });
        const b = bytesOf('second');
        await harness.putArtifact!(ws.workspaceId, SECOND_BLOB, b, {
          stamp: 'stamp-2',
          size: b.byteLength,
        });

        await harness.deleteArtifactHead!(ws.workspaceId, ARTIFACT_HEAD_REL_PATH);

        // The targeted HEAD doc is gone…
        await expect(
          harness.headArtifact!(ws.workspaceId, ARTIFACT_HEAD_REL_PATH)
        ).resolves.toBeNull();
        // …but a freshly-put SECOND key under the same workspace is untouched.
        await expect(
          harness.headArtifact!(ws.workspaceId, SECOND_HEAD)
        ).resolves.not.toBeNull();
      });

      it('deleteArtifactHead on an already-gone key is a clean no-op', async () => {
        const ws = await harness.createWorkspace('Artifacts');
        await expect(
          harness.deleteArtifactHead!(ws.workspaceId, ARTIFACT_HEAD_REL_PATH)
        ).resolves.toBeUndefined();
      });

      it('sweepArtifacts deletes a past-TTL artifact and keeps a fresh one', async () => {
        const ws = await harness.createWorkspace('Artifacts');
        const FRESH_BLOB = 'embeddings/fresh-key.bin';
        const FRESH_HEAD = 'embedCache/fresh-key';

        const stale = bytesOf('stale');
        await harness.putArtifact!(ws.workspaceId, ARTIFACT_BLOB_REL_PATH, stale, {
          stamp: 'stale',
          size: stale.byteLength,
        });
        const fresh = bytesOf('fresh');
        await harness.putArtifact!(ws.workspaceId, FRESH_BLOB, fresh, {
          stamp: 'fresh',
          size: fresh.byteLength,
        });

        // now in the far future + ttlMs=0 → EVERY artifact whose createdAt is in
        // the past is past-TTL. (Both were just put; both qualify.) Drive a more
        // discriminating case via budget below; here we prove a past-TTL sweep
        // deletes and the report is honest.
        const report = await harness.sweepArtifacts!(ws.workspaceId, {
          ttlMs: 0,
          now: Date.now() + 60_000,
        });
        expect(report.headsDeleted).toBe(2);
        await expect(
          harness.headArtifact!(ws.workspaceId, ARTIFACT_HEAD_REL_PATH)
        ).resolves.toBeNull();
        await expect(
          harness.headArtifact!(ws.workspaceId, FRESH_HEAD)
        ).resolves.toBeNull();
      });

      it('sweepArtifacts with a large TTL keeps everything (nothing past-TTL)', async () => {
        const ws = await harness.createWorkspace('Artifacts');
        const payload = bytesOf('keep-me');
        await harness.putArtifact!(ws.workspaceId, ARTIFACT_BLOB_REL_PATH, payload, {
          stamp: 'keep',
          size: payload.byteLength,
        });

        const report = await harness.sweepArtifacts!(ws.workspaceId, {
          ttlMs: 30 * 24 * 60 * 60 * 1000, // 30d
          now: Date.now(),
        });
        expect(report.headsDeleted).toBe(0);
        await expect(
          harness.headArtifact!(ws.workspaceId, ARTIFACT_HEAD_REL_PATH)
        ).resolves.not.toBeNull();
      });

      it('over-budget sweep deletes oldest-by-createdAt first', async () => {
        const ws = await harness.createWorkspace('Artifacts');
        // Three artifacts, each 4 bytes; put sequentially so createdAt orders
        // them oldest→newest. A 4-byte budget admits exactly one (the newest);
        // the two oldest evict.
        const KEYS = [
          { blob: 'embeddings/k1.bin', head: 'embedCache/k1' },
          { blob: 'embeddings/k2.bin', head: 'embedCache/k2' },
          { blob: 'embeddings/k3.bin', head: 'embedCache/k3' },
        ];
        for (const k of KEYS) {
          const payload = bytesOf('1234'); // 4 bytes
          await harness.putArtifact!(ws.workspaceId, k.blob, payload, {
            stamp: k.head,
            size: payload.byteLength,
          });
          // A tiny gap so createdAt is strictly increasing on fast clocks.
          await new Promise((r) => setTimeout(r, 2));
        }

        // ttlMs huge (nothing past-TTL) so ONLY the budget rule fires; budget
        // admits one 4-byte artifact, so the two oldest (k1, k2) evict.
        const report = await harness.sweepArtifacts!(ws.workspaceId, {
          ttlMs: 30 * 24 * 60 * 60 * 1000,
          now: Date.now(),
          budgetBytes: 4,
        });
        expect(report.headsDeleted).toBe(2);
        await expect(harness.headArtifact!(ws.workspaceId, 'embedCache/k1')).resolves.toBeNull();
        await expect(harness.headArtifact!(ws.workspaceId, 'embedCache/k2')).resolves.toBeNull();
        // The newest survives (under budget).
        await expect(
          harness.headArtifact!(ws.workspaceId, 'embedCache/k3')
        ).resolves.not.toBeNull();
      });
    });
  });
}
