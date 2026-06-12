/**
 * Injected ports for the sync domain (phase4-sync-strangler.md §D2; master
 * plan §2 boundary rule 3 — the EngineContext pattern): `domains/sync/core`
 * holds NO store imports. The composition root (src/app/sync/createSync.ts)
 * constructs the orchestrator once and injects store-backed adapters for
 * everything the legacy FirestoreSyncManager used to reach into directly
 * (`useSyncStore`, `useBookStore`, `@store/yjs-provider`, test-flags).
 */
import type * as Y from 'yjs';
import type { SyncBackendFactory } from '../backend/SyncBackend';
import type { SyncEventBus } from '../events';

/**
 * Read/write access to the sync store slice the orchestrator owns. The
 * status/auth/lastSyncTime mirrors are NOT here on purpose: those are
 * written in exactly one place — the `wireSyncEvents` subscriber — off the
 * typed SyncEvent bus (§D3 single-writer rule).
 */
export interface SyncStatePort {
  getActiveWorkspaceId(): string | null;
  setActiveWorkspaceId(id: string | null): void;
  /** Persisted enablement flag; stamped true on successful sign-in. */
  setFirebaseEnabled(enabled: boolean): void;
}

/**
 * Checkpoint operations the sync flows depend on. Wired to the (static)
 * CheckpointService by the composition root — which also injects the
 * `pauseSync` shutdown handle into the destructive `applyRemoteState`
 * (the §D7 circular-import inversion: CheckpointService no longer imports
 * the sync manager to destroy it).
 */
export interface CheckpointsPort {
  createCheckpoint(trigger: string, options?: { protected?: boolean }): Promise<number>;
  createAutomaticCheckpoint(trigger: string, intervalMs: number): Promise<number | null>;
  /** Destructive: wipes local persistence and writes the blob. Reloads. */
  applyRemoteState(remoteBlob: Uint8Array): Promise<void>;
}

/** The localStorage migration state machine (workspace switch). */
export interface MigrationStatePort {
  setAwaitingConfirmation(targetWorkspaceId: string, backupCheckpointId: number): void;
  setRestoringBackup(): void;
  clear(): void;
}

/**
 * What the composition root (src/app/sync/createSync.ts) installs: the
 * backend factory and, for the mock backend, the synthesized auth session
 * that replaces Firebase auth in E2E/dev. The domain never reads the
 * `__VERSICLE_MOCK_*` flags — backend selection is exclusively the
 * composition root's job (boundary rule 9).
 */
export interface SyncBackendSelection {
  factory: SyncBackendFactory;
  mockSession?: { uid: string; email: string };
}

/** Provider flush tuning (the legacy FirestoreSyncConfig). */
export interface SyncOrchestratorConfig {
  /**
   * Maximum time to wait before flushing updates to the backend (ms).
   * Higher values reduce writes (cost saving) but increase sync delay.
   */
  maxWaitFirestoreTime?: number;
  /** Maximum number of updates to batch before forcing a flush. */
  maxUpdatesThreshold?: number;
}

export interface SyncOrchestratorDeps {
  /** Initial backend selection; replaceable via setBackendSelection. */
  backendSelection: SyncBackendSelection;
  events: SyncEventBus;
  /** The live shared Y.Doc (replaces the direct getYDoc import). */
  doc: () => Y.Doc;
  /** Resolves when local persistence has hydrated (was waitForYjsSync). */
  whenLocalSynced: () => Promise<void>;
  /** Quarantine UI-lock + announce handle (was handleObsoleteClient). */
  onObsolete: (incomingVersion: number) => void;
  /** CURRENT_SCHEMA_VERSION, injected so core stays store-free. */
  currentSchemaVersion: number;
  /** Clean-client check (was a direct useBookStore read). */
  isCleanClient: () => boolean;
  /**
   * The single init gate (§D2): `(firebaseEnabled && isConfigured) ||
   * mockEnabled`. Evaluated at start(); fixes the legacy boot path that
   * ignored the `firebaseEnabled` flag (prep doc reality item 20).
   */
  isEnabled: () => boolean;
  /** Test-flag debounce override in ms; 0 when unset (src/test-flags). */
  debounceOverrideMs: () => number;
  syncState: SyncStatePort;
  checkpoints: CheckpointsPort;
  migrationState: MigrationStatePort;
  config?: SyncOrchestratorConfig;
}
