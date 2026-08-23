/**
 * `createSync` — the LIGHT half of the composition root.
 *
 * Its contract is singleton discipline and the enablement gate. Both are
 * load-bearing for the Phase 8 chunk split: `isSyncEnabled` decides whether
 * the firebase chunk is fetched at all, and the supersede check inside the
 * dynamic import is what keeps a wipe racing a composition from installing
 * a stale orchestrator.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { useSyncStore as UseSyncStore } from '@store/useSyncStore';

const composeSyncOrchestrator = vi.fn();
const isFirebaseConfigured = vi.fn(() => true);
const isMockFirestoreEnabled = vi.fn(() => false);
const getMockFirestoreUserId = vi.fn(() => 'mock-user');
const MockBackendCtor = vi.fn();

vi.mock('./composeSync', () => ({
  composeSyncOrchestrator: (args: unknown) => composeSyncOrchestrator(args as never),
}));

vi.mock('@lib/sync/firebase-config-presence', () => ({
  isFirebaseConfigured: () => isFirebaseConfigured(),
}));

vi.mock('../../test-flags', () => ({
  isMockFirestoreEnabled: () => isMockFirestoreEnabled(),
  getMockFirestoreUserId: () => getMockFirestoreUserId(),
}));

vi.mock('@domains/sync/backend/MockBackend', () => ({
  MockBackend: class {
    constructor(uid: string) {
      MockBackendCtor(uid);
    }
  },
}));

const makeOrchestrator = () => ({
  stop: vi.fn(),
  setBackendSelection: vi.fn(),
});

let mod: typeof import('./createSync');
// resetModules gives the module under test a FRESH registry, so the store it
// reads must be imported from that same registry — not the file's top scope.
let useSyncStore: typeof UseSyncStore;

beforeEach(async () => {
  vi.resetModules();
  composeSyncOrchestrator.mockReset();
  isFirebaseConfigured.mockReset().mockReturnValue(true);
  isMockFirestoreEnabled.mockReset().mockReturnValue(false);
  getMockFirestoreUserId.mockReset().mockReturnValue('mock-user');
  MockBackendCtor.mockClear();
  mod = await import('./createSync');
  useSyncStore = (await import('@store/useSyncStore')).useSyncStore;
  useSyncStore.setState({ firebaseEnabled: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isSyncEnabled — the single gate', () => {
  it('is off when the user has not enabled sync', () => {
    useSyncStore.setState({ firebaseEnabled: false });

    expect(mod.isSyncEnabled()).toBe(false);
  });

  it('is off when enabled but the app is not configured for firebase', () => {
    useSyncStore.setState({ firebaseEnabled: true });
    isFirebaseConfigured.mockReturnValue(false);

    expect(mod.isSyncEnabled()).toBe(false);
  });

  it('is on when enabled AND configured', () => {
    useSyncStore.setState({ firebaseEnabled: true });
    isFirebaseConfigured.mockReturnValue(true);

    expect(mod.isSyncEnabled()).toBe(true);
  });

  it('is on for a mock session regardless of the firebase gate', async () => {
    isMockFirestoreEnabled.mockReturnValue(true);
    useSyncStore.setState({ firebaseEnabled: false });
    isFirebaseConfigured.mockReturnValue(false);

    await mod.configureSyncBackendSelection();

    expect(mod.isSyncEnabled()).toBe(true);
  });
});

describe('getSyncOrchestratorAsync — the singleton', () => {
  it('composes on first use and caches the instance', async () => {
    const orchestrator = makeOrchestrator();
    composeSyncOrchestrator.mockReturnValue({ orchestrator, selection: { factory: vi.fn() } });

    const first = await mod.getSyncOrchestratorAsync();
    const second = await mod.getSyncOrchestratorAsync();

    expect(first).toBe(orchestrator);
    expect(second).toBe(orchestrator);
    expect(composeSyncOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('composes ONCE for concurrent callers', async () => {
    composeSyncOrchestrator.mockReturnValue({
      orchestrator: makeOrchestrator(),
      selection: { factory: vi.fn() },
    });

    const [a, b] = await Promise.all([
      mod.getSyncOrchestratorAsync(),
      mod.getSyncOrchestratorAsync(),
    ]);

    expect(a).toBe(b);
    expect(composeSyncOrchestrator).toHaveBeenCalledTimes(1);
  });

  it('hands composeSync the current selection and the live gate', async () => {
    composeSyncOrchestrator.mockReturnValue({
      orchestrator: makeOrchestrator(),
      selection: { factory: vi.fn() },
    });

    await mod.getSyncOrchestratorAsync();

    const args = composeSyncOrchestrator.mock.calls[0][0] as {
      selection: unknown;
      isEnabled: () => boolean;
    };
    expect(args.selection).toBeNull();
    expect(args.isEnabled).toBe(mod.isSyncEnabled);
  });

  it('adopts the selection composeSync resolved', async () => {
    const selection = { factory: vi.fn(), mockSession: { uid: 'u', email: 'u@x' } };
    composeSyncOrchestrator.mockReturnValue({ orchestrator: makeOrchestrator(), selection });

    await mod.getSyncOrchestratorAsync();

    expect(mod.isSyncEnabled()).toBe(true); // the adopted mockSession opens the gate
  });

  it('does NOT install an orchestrator that a wipe superseded mid-import', async () => {
    const orchestrator = makeOrchestrator();
    composeSyncOrchestrator.mockImplementation(() => {
      // Model the wipe landing while the chunk was loading.
      mod.stopSyncForWipe();
      return { orchestrator, selection: { factory: vi.fn() } };
    });

    const returned = await mod.getSyncOrchestratorAsync();

    expect(returned).toBe(orchestrator); // the caller still gets a usable one…
    expect(mod.peekSyncOrchestrator()).toBeNull(); // …but it was not installed
  });
});

describe('peekSyncOrchestrator', () => {
  it('is null before anything composed', () => {
    expect(mod.peekSyncOrchestrator()).toBeNull();
  });

  it('reports the composed instance without creating one', async () => {
    const orchestrator = makeOrchestrator();
    composeSyncOrchestrator.mockReturnValue({ orchestrator, selection: { factory: vi.fn() } });
    await mod.getSyncOrchestratorAsync();

    expect(mod.peekSyncOrchestrator()).toBe(orchestrator);
    expect(composeSyncOrchestrator).toHaveBeenCalledTimes(1);
  });
});

describe('stopSyncConnections', () => {
  it('is a no-op when sync never started', () => {
    expect(() => mod.stopSyncConnections()).not.toThrow();
  });

  it('stops the live orchestrator but KEEPS the instance', async () => {
    const orchestrator = makeOrchestrator();
    composeSyncOrchestrator.mockReturnValue({ orchestrator, selection: { factory: vi.fn() } });
    await mod.getSyncOrchestratorAsync();

    mod.stopSyncConnections();

    expect(orchestrator.stop).toHaveBeenCalledTimes(1);
    expect(mod.peekSyncOrchestrator()).toBe(orchestrator);
  });
});

describe('stopSyncForWipe', () => {
  it('stops AND drops the instance, so the next access composes fresh', async () => {
    const first = makeOrchestrator();
    const second = makeOrchestrator();
    composeSyncOrchestrator.mockReturnValueOnce({ orchestrator: first, selection: { factory: vi.fn() } });
    composeSyncOrchestrator.mockReturnValueOnce({ orchestrator: second, selection: { factory: vi.fn() } });
    await mod.getSyncOrchestratorAsync();

    mod.stopSyncForWipe();

    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(mod.peekSyncOrchestrator()).toBeNull();
    await expect(mod.getSyncOrchestratorAsync()).resolves.toBe(second);
    expect(composeSyncOrchestrator).toHaveBeenCalledTimes(2);
  });

  it('is safe with nothing composed', () => {
    expect(() => mod.stopSyncForWipe()).not.toThrow();
  });
});

describe('configureSyncBackendSelection', () => {
  it('does nothing when the mock flag is off', async () => {
    isMockFirestoreEnabled.mockReturnValue(false);

    await mod.configureSyncBackendSelection();

    expect(MockBackendCtor).not.toHaveBeenCalled();
    expect(mod.isSyncEnabled()).toBe(false);
  });

  it('installs a MockBackend selection with a synthesized session', async () => {
    isMockFirestoreEnabled.mockReturnValue(true);
    getMockFirestoreUserId.mockReturnValue('e2e-user');
    composeSyncOrchestrator.mockReturnValue({
      orchestrator: makeOrchestrator(),
      selection: { factory: vi.fn() },
    });

    await mod.configureSyncBackendSelection();
    await mod.getSyncOrchestratorAsync();

    const args = composeSyncOrchestrator.mock.calls[0][0] as {
      selection: { factory: (uid: string) => unknown; mockSession: { uid: string; email: string } };
    };
    expect(args.selection.mockSession).toEqual({ uid: 'e2e-user', email: 'e2e-user@example.com' });
    args.selection.factory('for-uid');
    expect(MockBackendCtor).toHaveBeenCalledWith('for-uid');
  });

  it('pushes the selection into an ALREADY-composed orchestrator', async () => {
    const orchestrator = makeOrchestrator();
    composeSyncOrchestrator.mockReturnValue({ orchestrator, selection: { factory: vi.fn() } });
    await mod.getSyncOrchestratorAsync();
    isMockFirestoreEnabled.mockReturnValue(true);

    await mod.configureSyncBackendSelection();

    expect(orchestrator.setBackendSelection).toHaveBeenCalledWith(
      expect.objectContaining({ mockSession: { uid: 'mock-user', email: 'mock-user@example.com' } })
    );
  });

  it('is re-runnable — the uid flag is read at each call', async () => {
    isMockFirestoreEnabled.mockReturnValue(true);
    composeSyncOrchestrator.mockReturnValue({
      orchestrator: makeOrchestrator(),
      selection: { factory: vi.fn() },
    });

    getMockFirestoreUserId.mockReturnValue('first');
    await mod.configureSyncBackendSelection();
    getMockFirestoreUserId.mockReturnValue('second');
    await mod.configureSyncBackendSelection();
    await mod.getSyncOrchestratorAsync();

    const args = composeSyncOrchestrator.mock.calls[0][0] as {
      selection: { mockSession: { uid: string } };
    };
    expect(args.selection.mockSession.uid).toBe('second');
  });
});
