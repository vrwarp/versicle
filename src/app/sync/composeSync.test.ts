/**
 * `composeSyncOrchestrator` — the heavy half of the composition root.
 *
 * Its whole job is wiring: which backend the orchestrator gets, and what
 * each injected port adapter actually reads or writes. A mis-wired adapter
 * type-checks perfectly and fails silently at runtime, so this suite
 * captures the dependency object and exercises every closure in it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { SyncOrchestratorDeps } from '@domains/sync/core/SyncOrchestrator';
import { useSyncStore } from '@store/useSyncStore';
import { useBookStore } from '@store/useBookStore';
import { composeSyncOrchestrator } from './composeSync';

const createSyncOrchestrator = vi.fn(() => ({ orchestrator: true }));
const FirestoreBackendCtor = vi.fn();
const checkpointCalls: unknown[][] = [];
const migrationCalls: unknown[][] = [];
const yjsCalls: string[] = [];

vi.mock('@domains/sync/core/SyncOrchestrator', () => ({
  createSyncOrchestrator: (deps: unknown) => createSyncOrchestrator(deps as never),
}));

vi.mock('@domains/sync/backend/FirestoreBackend', () => ({
  FirestoreBackend: class {
    constructor(uid: string) {
      FirestoreBackendCtor(uid);
    }
  },
}));

vi.mock('@domains/sync/checkpoints/CheckpointService', () => ({
  CheckpointService: {
    createCheckpoint: (...args: unknown[]) => {
      checkpointCalls.push(['createCheckpoint', ...args]);
      return Promise.resolve(11);
    },
    createAutomaticCheckpoint: (...args: unknown[]) => {
      checkpointCalls.push(['createAutomaticCheckpoint', ...args]);
      return Promise.resolve(22);
    },
  },
}));

vi.mock('@domains/sync/workspaces/MigrationStateService', () => ({
  MigrationStateService: {
    setStaged: (...args: unknown[]) => migrationCalls.push(['setStaged', ...args]),
    setAwaitingConfirmation: (...args: unknown[]) =>
      migrationCalls.push(['setAwaitingConfirmation', ...args]),
    setRestoringBackup: (...args: unknown[]) => migrationCalls.push(['setRestoringBackup', ...args]),
    clear: (...args: unknown[]) => migrationCalls.push(['clear', ...args]),
  },
}));

const theDoc = { doc: true };
// Partial: the real module also exports `defineSyncedStore`, which every
// store in the graph is built on.
vi.mock('@store/yjs-provider', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getYDoc: () => {
    yjsCalls.push('getYDoc');
    return theDoc;
  },
  waitForYjsSync: () => {
    yjsCalls.push('waitForYjsSync');
    return Promise.resolve();
  },
  handleObsoleteClient: (v: number) => yjsCalls.push(`handleObsoleteClient:${v}`),
  CURRENT_SCHEMA_VERSION: 6,
}));

const debounceOverride = vi.fn<() => number | undefined>(() => undefined);
vi.mock('../../test-flags', () => ({
  getFirestoreDebounceOverrideMs: () => debounceOverride(),
}));

const compose = (
  args: Parameters<typeof composeSyncOrchestrator>[0] = { selection: null, isEnabled: () => true }
): SyncOrchestratorDeps => {
  composeSyncOrchestrator(args);
  return createSyncOrchestrator.mock.calls.at(-1)![0] as unknown as SyncOrchestratorDeps;
};

beforeEach(() => {
  createSyncOrchestrator.mockClear().mockReturnValue({ orchestrator: true } as never);
  FirestoreBackendCtor.mockClear();
  debounceOverride.mockReset().mockReturnValue(undefined);
  checkpointCalls.length = 0;
  migrationCalls.length = 0;
  yjsCalls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('composeSyncOrchestrator — backend selection', () => {
  it('defaults to a Firestore backend built per uid', () => {
    const composed = composeSyncOrchestrator({ selection: null, isEnabled: () => true });

    expect(composed.selection.factory).toEqual(expect.any(Function));
    composed.selection.factory('uid-9');
    expect(FirestoreBackendCtor).toHaveBeenCalledWith('uid-9');
    expect(composed.selection.mockSession).toBeUndefined();
  });

  it('keeps a pre-selected (mock) backend rather than overriding it', () => {
    const selection = {
      factory: vi.fn(),
      mockSession: { uid: 'mock-user', email: 'mock@example.com' },
    };

    const composed = composeSyncOrchestrator({ selection, isEnabled: () => true });

    expect(composed.selection).toBe(selection);
    expect(FirestoreBackendCtor).not.toHaveBeenCalled();
    expect((compose({ selection, isEnabled: () => true }) as { backendSelection: unknown }).backendSelection).toBe(
      selection
    );
  });

  it('returns the orchestrator it constructed', () => {
    const orchestrator = { id: 'the-one' };
    createSyncOrchestrator.mockReturnValue(orchestrator as never);

    expect(composeSyncOrchestrator({ selection: null, isEnabled: () => true }).orchestrator).toBe(
      orchestrator
    );
  });
});

describe('composeSyncOrchestrator — the injected adapters', () => {
  it('wires the yjs provider seams', () => {
    const deps = compose();

    expect(deps.doc()).toBe(theDoc);
    expect(deps.currentSchemaVersion).toBe(6);
    void deps.whenLocalSynced();
    deps.onObsolete(9);

    expect(yjsCalls).toEqual(['getYDoc', 'waitForYjsSync', 'handleObsoleteClient:9']);
  });

  it('passes the enablement gate through by REFERENCE, not by value', () => {
    let enabled = false;
    const deps = compose({ selection: null, isEnabled: () => enabled });

    expect(deps.isEnabled()).toBe(false);
    enabled = true;
    expect(deps.isEnabled()).toBe(true);
  });

  it('reports a clean client only when the book store is empty', () => {
    const deps = compose();
    useBookStore.setState({ books: {} });
    expect(deps.isCleanClient()).toBe(true);

    useBookStore.setState({ books: { 'book-1': { id: 'book-1' } } as never });
    expect(deps.isCleanClient()).toBe(false);
    useBookStore.setState({ books: {} });
  });

  it('normalizes an ABSENT debounce override to zero', () => {
    const deps = compose();

    debounceOverride.mockReturnValue(undefined);
    expect(deps.debounceOverrideMs()).toBe(0);
    debounceOverride.mockReturnValue(0);
    expect(deps.debounceOverrideMs()).toBe(0);
  });

  it('passes a real debounce override through', () => {
    const deps = compose();
    debounceOverride.mockReturnValue(25);

    expect(deps.debounceOverrideMs()).toBe(25);
  });

  it('reads and writes the active workspace through the sync store', () => {
    const deps = compose();

    deps.syncState.setActiveWorkspaceId('ws_42');
    expect(deps.syncState.getActiveWorkspaceId()).toBe('ws_42');
    expect(useSyncStore.getState().activeWorkspaceId).toBe('ws_42');

    deps.syncState.setActiveWorkspaceId(null);
    expect(deps.syncState.getActiveWorkspaceId()).toBeNull();
  });

  it('stamps the persisted enablement flag through the sync store', () => {
    const deps = compose();

    deps.syncState.setFirebaseEnabled(true);
    expect(useSyncStore.getState().firebaseEnabled).toBe(true);

    deps.syncState.setFirebaseEnabled(false);
    expect(useSyncStore.getState().firebaseEnabled).toBe(false);
  });

  it('forwards both checkpoint calls with their arguments', async () => {
    const deps = compose();

    await expect(deps.checkpoints.createCheckpoint('pre-migration', { protected: true })).resolves.toBe(
      11
    );
    await expect(deps.checkpoints.createAutomaticCheckpoint('idle', 5000)).resolves.toBe(22);

    expect(checkpointCalls).toEqual([
      ['createCheckpoint', 'pre-migration', { protected: true }],
      ['createAutomaticCheckpoint', 'idle', 5000],
    ]);
  });

  it('forwards every migration-state transition, arguments intact', () => {
    const deps = compose();

    deps.migrationState.setStaged('ws_target', 7, 'ws_before');
    deps.migrationState.setStaged('ws_target', 7);
    deps.migrationState.setAwaitingConfirmation('ws_target', 7);
    deps.migrationState.setRestoringBackup();
    deps.migrationState.clear();

    expect(migrationCalls).toEqual([
      ['setStaged', 'ws_target', 7, 'ws_before'],
      ['setStaged', 'ws_target', 7, undefined],
      ['setAwaitingConfirmation', 'ws_target', 7],
      ['setRestoringBackup'],
      ['clear'],
    ]);
  });

  it('hands the orchestrator the process-wide event bus', () => {
    const deps = compose();

    expect(deps.events.emit).toEqual(expect.any(Function));
    expect(deps.events.on).toEqual(expect.any(Function));
  });
});
