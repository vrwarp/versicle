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

    // Epoch squash (y-cinder floor reset): both directions surface, with
    // distinct copy for the squashing device vs bystanders.
    bus.emit({ type: 'epoch-changed', epoch: 2, previousEpoch: 1, self: false });
    expectToastShown(
      'Sync storage was rebuilt on another device. Reload the app to pick up the optimized library.',
      'info',
      10000
    );
    bus.emit({ type: 'epoch-changed', epoch: 2, previousEpoch: 1, self: true });
    expectToastShown('Sync storage optimized. Reload the app to complete the switch.', 'info', 10000);
  });

  it('unsubscribing stops all presentation', () => {
    unwire();
    getSyncEventBus().emit({ type: 'clean-sync', phase: 'started' });
    expect(showToast).not.toHaveBeenCalled();
    // Re-wire so afterEach's unwire is a no-op double-call (idempotent).
    unwire = wireSyncEvents();
  });
  /*
   * Pluralization is hand-rolled (the catalog carries no ICU plural
   * support), so the singular/plural boundary is real logic and was
   * entirely unasserted — mutation testing reported both ternaries and
   * both comparison operators as surviving. A purge report that reads
   * "1 documents" is the visible symptom; the invisible one is the
   * comparison silently inverting.
   */
  describe('workspace-purged pluralization', () => {
    const emitPurge = (docsDeleted: number, blobsDeleted: number) => {
      getSyncEventBus().emit({
        type: 'workspace-purged',
        report: { docsDeleted, blobsDeleted },
      } as never);
    };

    const lastPurgeText = (): string => {
      const call = showToast.mock.calls.at(-1);
      return call ? resolveMessage(call[0]) : '';
    };

    it('uses the singular form for exactly one', () => {
      emitPurge(1, 1);
      const text = lastPurgeText();

      expect(text).toContain('1 document');
      expect(text).not.toContain('1 documents');
      expect(text).toContain('1 blob');
      expect(text).not.toContain('1 blobs');
    });

    it('uses the plural form for more than one', () => {
      emitPurge(2, 3);
      const text = lastPurgeText();

      expect(text).toContain('2 documents');
      expect(text).toContain('3 blobs');
    });

    it('uses the plural form for zero', () => {
      emitPurge(0, 0);
      const text = lastPurgeText();

      expect(text).toContain('0 documents');
      expect(text).toContain('0 blobs');
    });

    it('pluralizes documents and blobs independently', () => {
      emitPurge(1, 5);
      const text = lastPurgeText();

      expect(text).toContain('1 document');
      expect(text).not.toContain('1 documents');
      expect(text).toContain('5 blobs');
    });
  });

  /*
   * The epoch-changed copy forks on whether THIS device performed the
   * squash. Telling a user another device rebuilt the document when they
   * did it themselves (or the reverse) is the whole point of the flag.
   */
  describe('epoch-changed self vs remote copy', () => {
    it('uses the self copy when this device squashed', () => {
      getSyncEventBus().emit({ type: 'epoch-changed', self: true } as never);
      expect(resolveMessage(showToast.mock.calls.at(-1)?.[0])).toBe(
        formatMessage('sync.epochChanged.self'),
      );
    });

    it('uses the remote copy when another device squashed', () => {
      getSyncEventBus().emit({ type: 'epoch-changed', self: false } as never);
      expect(resolveMessage(showToast.mock.calls.at(-1)?.[0])).toBe(
        formatMessage('sync.epochChanged'),
      );
    });
  });

});
