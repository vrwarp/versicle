/**
 * Pins the §D3 presentation contract: wireSyncEvents is the single
 * subscriber mapping typed SyncEvents → useSyncStore writes + toast keys
 * (resolved copy asserted verbatim — Phase 8 §D keyed the choke point).
 * In particular it pins the FLUSH-DRIVEN `lastSyncTime` semantics (P4-3
 * exit criterion): a `flushed` event stamps the store with the save
 * timestamp — the pulse tooltip reports actual sync activity, not
 * connection time. The transitional connected-transition floor died with
 * the y-cinder `saved` fork delta (P9; packages/y-cinder/PROVENANCE.md
 * surgery 1) — `flushed` is now the ONLY writer, pinned below.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSyncEventBus } from '@domains/sync/events';
import { formatMessage, resolveMessage } from '@kernel/locale/messages';
import { wireSyncEvents } from './wireSyncEvents';
import { useSyncStore } from '@store/useSyncStore';

// The rules-lockout copy now lives in the catalog (Phase 8 §D); resolving
// it here keeps this suite pinning the USER-VISIBLE string, not the key.
const RULES_OUT_OF_DATE_MESSAGE = formatMessage('sync.rulesOutOfDate');

// Module-mock the toast store: spying the live zustand state object is
// unreliable here because showToast's own set() copies the spy into every
// successor state object, so call history would leak across tests.
const showToast = vi.fn();
vi.mock('@store/useToastStore', () => ({
  useToastStore: {
    getState: () => ({ showToast }),
  },
}));

/**
 * Assert a toast whose RESOLVED display text matches — wireSyncEvents
 * passes catalog keys/`{key, params}` since Phase 8 §D, and this suite
 * keeps pinning the rendered copy verbatim (the §D3 presentation
 * contract is about what the user reads).
 */
function expectToastShown(message: string, type: string, duration?: number) {
  const matched = showToast.mock.calls.some(
    ([content, t, d]) => resolveMessage(content) === message && t === type && d === duration,
  );
  expect(
    matched,
    `expected toast "${message}" (${type}${duration !== undefined ? `, ${duration}ms` : ''}); ` +
      `got: ${showToast.mock.calls.map(([c, t]) => `"${resolveMessage(c)}" (${String(t)})`).join(' | ')}`,
  ).toBe(true);
}

describe('wireSyncEvents (single SyncEvent subscriber)', () => {
  let unwire: () => void;

  beforeEach(() => {
    useSyncStore.setState({
      firestoreStatus: 'disconnected',
      firebaseAuthStatus: 'loading',
      firebaseUserEmail: null,
      lastSyncTime: null,
    });
    showToast.mockClear();
    unwire = wireSyncEvents();
  });

  afterEach(() => {
    unwire();
  });

  describe('lastSyncTime', () => {
    it('is driven by flushed events (a committed save stamps its timestamp)', () => {
      const bus = getSyncEventBus();
      bus.emit({ type: 'flushed', at: 1234567890 });
      expect(useSyncStore.getState().lastSyncTime).toBe(1234567890);

      bus.emit({ type: 'flushed', at: 1234567999 });
      expect(useSyncStore.getState().lastSyncTime).toBe(1234567999);
    });

    it("regression: status events never stamp lastSyncTime — 'flushed' is the only writer (the transitional connected-transition floor is dead)", () => {
      const bus = getSyncEventBus();
      bus.emit({ type: 'status', status: 'connected' });
      expect(useSyncStore.getState().lastSyncTime).toBeNull();

      bus.emit({ type: 'status', status: 'disconnected' });
      bus.emit({ type: 'status', status: 'connected' });
      expect(useSyncStore.getState().lastSyncTime).toBeNull();

      // Only a committed save moves it.
      bus.emit({ type: 'flushed', at: 42 });
      expect(useSyncStore.getState().lastSyncTime).toBe(42);
    });
  });

  it('mirrors status and auth events into useSyncStore', () => {
    const bus = getSyncEventBus();
    bus.emit({ type: 'status', status: 'connecting' });
    expect(useSyncStore.getState().firestoreStatus).toBe('connecting');

    bus.emit({ type: 'auth', status: 'signed-in', email: 'reader@example.com' });
    expect(useSyncStore.getState().firebaseAuthStatus).toBe('signed-in');
    expect(useSyncStore.getState().firebaseUserEmail).toBe('reader@example.com');

    bus.emit({ type: 'auth', status: 'signed-out', email: null });
    expect(useSyncStore.getState().firebaseAuthStatus).toBe('signed-out');
    expect(useSyncStore.getState().firebaseUserEmail).toBeNull();
  });

  describe('regression: permission-denied surfaces the "rules out of date" hint (BYO-Firebase lockout)', () => {
    it.each(['connection-error', 'sync-failure'] as const)(
      '%s with permissionDenied shows the rules hint',
      (type) => {
        getSyncEventBus().emit({ type, permissionDenied: true });
        expectToastShown(RULES_OUT_OF_DATE_MESSAGE, 'error', 10000);
      }
    );

    it('save-rejected with permissionDenied shows the rules hint', () => {
      getSyncEventBus().emit({
        type: 'save-rejected',
        code: 'permission-denied',
        permissionDenied: true,
      });
      expectToastShown(RULES_OUT_OF_DATE_MESSAGE, 'error', 10000);
    });
  });

  it('maps the remaining transport events to the legacy copy verbatim', () => {
    const bus = getSyncEventBus();

    bus.emit({ type: 'sync-failure', permissionDenied: false });
    expectToastShown('Sync failed after multiple attempts. Please check your connection.', 'error', 5000);

    bus.emit({
      type: 'save-rejected',
      code: 'document-too-large',
      sizeBytes: 2000000,
      permissionDenied: false,
    });
    expectToastShown('Sync disabled: Document too large (2000000 bytes). Please export and clear data.', 'error', 8000);

    bus.emit({ type: 'clean-sync', phase: 'started' });
    expectToastShown('Syncing library from cloud...', 'info');
    bus.emit({ type: 'clean-sync', phase: 'applied' });
    expectToastShown('Sync complete!', 'success');
    bus.emit({ type: 'clean-sync', phase: 'failed' });
    expectToastShown('Failed to sync. Please try again.', 'error');

    bus.emit({ type: 'switch', phase: 'downloading' });
    expectToastShown('Downloading workspace data...', 'info');
    bus.emit({ type: 'switch', phase: 'failed-rolling-back' });
    expectToastShown('Workspace switch failed. Restoring your previous data...', 'error');
    bus.emit({ type: 'switch', phase: 'failed-aborted' });
    expectToastShown('Workspace switch failed. Please try again.', 'error');

    bus.emit({ type: 'workspace-tombstoned', workspaceId: 'ws_x', context: 'connect' });
    expectToastShown('Sync disconnected: Remote workspace was deleted. Operating offline.', 'error', 8000);
    bus.emit({ type: 'workspace-tombstoned', workspaceId: 'ws_x', context: 'switch' });
    expectToastShown('Cannot switch: This workspace has been deleted.', 'error');

    bus.emit({ type: 'local-persistence-unavailable' });
    expectToastShown('Offline sync unavailable (persistence failed)', 'error');
  });

  it('unsubscribing stops all presentation', () => {
    unwire();
    getSyncEventBus().emit({ type: 'clean-sync', phase: 'started' });
    expect(showToast).not.toHaveBeenCalled();
    // Re-wire so afterEach's unwire is a no-op double-call (idempotent).
    unwire = wireSyncEvents();
  });
});
