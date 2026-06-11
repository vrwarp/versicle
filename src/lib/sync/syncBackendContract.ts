/**
 * SyncBackend contract suite — C3 of the contract registry
 * (plan/overhaul/proposals/contract-first.md): connect / workspace CRUD /
 * tombstone semantics, executed against every backend implementation.
 *
 * Phase 0 SKELETON (just-in-time authoring rule): the `SyncBackend`
 * interface itself does not exist yet — P4 carves it out of
 * FirestoreSyncManager's inline `__VERSICLE_MOCK_FIRESTORE__` branches.
 * This suite pins the behavior the seam must preserve, running today
 * against a MockFireProvider-backed harness
 * (syncBackendContract.mock.test.ts) and, when the Firebase emulator is up,
 * against a Firestore-backed harness (syncBackendContract.emulator.test.ts).
 * When P4 lands, the harnesses shrink to thin adapters over the real
 * `SyncBackend` implementations and this file becomes the C3 pinning suite.
 *
 * Pattern follows src/lib/tts/engine/engineParityScenarios.ts: one
 * behavioral spec, N transports.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import type { WorkspaceMetadata } from '~types/workspace';

export interface SyncBackendConnection {
  /** Detach and flush; the workspace doc must be durable afterwards. */
  disconnect(): Promise<void> | void;
}

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
  listWorkspaces(): Promise<WorkspaceMetadata[]>;
  /** Tombstone deletion — the workspace must never be resurrectable. */
  deleteWorkspace(workspaceId: string): Promise<void>;
  /** The pre-flight gate every connect runs (tombstone check). */
  isWorkspaceAlive(workspaceId: string): Promise<boolean>;
  /**
   * Attempt a residual data write into a tombstoned workspace; resolves
   * true when the BACKEND rejected it. Only rules-enforcing backends (the
   * emulator) can implement this.
   */
  attemptWriteToTombstoned?(workspaceId: string): Promise<boolean>;
  dispose?(): Promise<void> | void;
}

export interface SyncBackendContractCapabilities {
  /** Realtime doc replication is testable in this environment. */
  connect: boolean;
  /**
   * Tombstone write-denial is enforced server-side (security rules), not
   * just by client convention.
   */
  serverSideTombstoneEnforcement: boolean;
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
    });

    describe('tombstone semantics', () => {
      it('deleteWorkspace removes the workspace from listWorkspaces', async () => {
        const ws = await harness.createWorkspace('Doomed');
        await harness.deleteWorkspace(ws.workspaceId);
        const listed = await harness.listWorkspaces();
        expect(listed.find((w) => w.workspaceId === ws.workspaceId)).toBeUndefined();
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

      // sync.md debt #2: the real deleteWorkspace purges only the `updates`
      // subcollection; `history`, `maintenance` and Cloud Storage snapshot
      // blobs survive. P4's honest deleteWorkspace turns this into a real
      // case run through the production code path.
      it.todo(
        'deleteWorkspace purges residual updates/history/maintenance docs and Storage snapshots (P4)'
      );
    });
  });
}
