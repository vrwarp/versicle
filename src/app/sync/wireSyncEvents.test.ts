/**
 * Pins the §D3 presentation contract: wireSyncEvents is the single
 * subscriber mapping typed SyncEvents → useSyncStore writes + toast copy.
 * In particular it pins the FLUSH-DRIVEN `lastSyncTime` semantics (P4-3
 * exit criterion): a `flushed` event stamps the store with the save
 * timestamp — the pulse tooltip reports actual sync activity, not
 * connection time. The connected-transition stamp is asserted as the
 * TRANSITIONAL floor it is (see wireSyncEvents module docs; it dies with
 * the y-cinder `saved` fork delta).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getSyncEventBus } from '@domains/sync/events';
import { RULES_OUT_OF_DATE_MESSAGE } from '@domains/sync/backend/permissionDenied';
import { wireSyncEvents } from './wireSyncEvents';
import { useSyncStore } from '@store/useSyncStore';

// Module-mock the toast store: spying the live zustand state object is
// unreliable here because showToast's own set() copies the spy into every
// successor state object, so call history would leak across tests.
const showToast = vi.fn();
vi.mock('@store/useToastStore', () => ({
  useToastStore: {
    getState: () => ({ showToast }),
  },
}));

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

    it('transitional: the connected TRANSITION stamps a floor, repeated connected statuses do not', () => {
      const bus = getSyncEventBus();
      bus.emit({ type: 'status', status: 'connected' });
      const stamped = useSyncStore.getState().lastSyncTime;
      expect(stamped).not.toBeNull();

      // Same status again — no transition, no re-stamp.
      bus.emit({ type: 'status', status: 'connected' });
      expect(useSyncStore.getState().lastSyncTime).toBe(stamped);
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
        expect(showToast).toHaveBeenCalledWith(RULES_OUT_OF_DATE_MESSAGE, 'error', 10000);
      }
    );

    it('save-rejected with permissionDenied shows the rules hint', () => {
      getSyncEventBus().emit({
        type: 'save-rejected',
        code: 'permission-denied',
        permissionDenied: true,
      });
      expect(showToast).toHaveBeenCalledWith(RULES_OUT_OF_DATE_MESSAGE, 'error', 10000);
    });
  });

  it('maps the remaining transport events to the legacy copy verbatim', () => {
    const bus = getSyncEventBus();

    bus.emit({ type: 'sync-failure', permissionDenied: false });
    expect(showToast).toHaveBeenCalledWith(
      'Sync failed after multiple attempts. Please check your connection.',
      'error',
      5000
    );

    bus.emit({
      type: 'save-rejected',
      code: 'document-too-large',
      sizeBytes: 2000000,
      permissionDenied: false,
    });
    expect(showToast).toHaveBeenCalledWith(
      'Sync disabled: Document too large (2000000 bytes). Please export and clear data.',
      'error',
      8000
    );

    bus.emit({ type: 'clean-sync', phase: 'started' });
    expect(showToast).toHaveBeenCalledWith('Syncing library from cloud...', 'info');
    bus.emit({ type: 'clean-sync', phase: 'applied' });
    expect(showToast).toHaveBeenCalledWith('Sync complete!', 'success');
    bus.emit({ type: 'clean-sync', phase: 'failed' });
    expect(showToast).toHaveBeenCalledWith('Failed to sync. Please try again.', 'error');

    bus.emit({ type: 'switch', phase: 'downloading' });
    expect(showToast).toHaveBeenCalledWith('Downloading workspace data...', 'info');
    bus.emit({ type: 'switch', phase: 'failed-rolling-back' });
    expect(showToast).toHaveBeenCalledWith(
      'Workspace switch failed. Restoring your previous data...',
      'error'
    );
    bus.emit({ type: 'switch', phase: 'failed-aborted' });
    expect(showToast).toHaveBeenCalledWith('Workspace switch failed. Please try again.', 'error');

    bus.emit({ type: 'workspace-tombstoned', workspaceId: 'ws_x', context: 'connect' });
    expect(showToast).toHaveBeenCalledWith(
      'Sync disconnected: Remote workspace was deleted. Operating offline.',
      'error',
      8000
    );
    bus.emit({ type: 'workspace-tombstoned', workspaceId: 'ws_x', context: 'switch' });
    expect(showToast).toHaveBeenCalledWith(
      'Cannot switch: This workspace has been deleted.',
      'error'
    );

    bus.emit({ type: 'local-persistence-unavailable' });
    expect(showToast).toHaveBeenCalledWith('Offline sync unavailable (persistence failed)', 'error');
  });

  it('unsubscribing stops all presentation', () => {
    unwire();
    getSyncEventBus().emit({ type: 'clean-sync', phase: 'started' });
    expect(showToast).not.toHaveBeenCalled();
    // Re-wire so afterEach's unwire is a no-op double-call (idempotent).
    unwire = wireSyncEvents();
  });
});
