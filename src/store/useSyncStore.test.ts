/**
 * useSyncStore — the persisted sync/Firebase settings slice.
 *
 * The suite exists for the write-amplification contract: this store is
 * `persist`-wrapped, and zustand persist re-runs `partialize` +
 * `JSON.stringify` and calls `localStorage.setItem` SYNCHRONOUSLY after EVERY
 * `set` (node_modules/zustand/esm/middleware.mjs — the `setItem()` tacked onto
 * the wrapped set), including a set that produces an identical state. Anything
 * on a hot path therefore has to avoid calling `set` at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSyncStore } from './useSyncStore';

describe('useSyncStore', () => {
    /** Counts the persist writes this store made since the spy was installed. */
    const countWrites = () => {
        const spy = vi.spyOn(window.localStorage, 'setItem');
        return () => spy.mock.calls.filter(([key]) => key === 'sync-storage').length;
    };

    let writes: () => number;

    beforeEach(() => {
        useSyncStore.setState({ lastSyncTime: null });
        writes = countWrites();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('setLastSyncTime stamps the timestamp of a committed save', () => {
        useSyncStore.getState().setLastSyncTime(1_700_000_000_000);
        expect(useSyncStore.getState().lastSyncTime).toBe(1_700_000_000_000);
    });

    /**
     * F6b: wireSyncEvents calls this on EVERY committed save, so an unfiltered
     * stamp meant a blocking JSON.stringify + localStorage.setItem per save.
     * The only reader (SyncPulseIndicator's tooltip) formats it as a short
     * time, so a one-second coalescing window is invisible.
     */
    describe('regression: setLastSyncTime does not re-persist within the coalescing window', () => {
        it('writes once for a burst of saves inside one second', () => {
            const base = 1_700_000_000_000;
            useSyncStore.getState().setLastSyncTime(base);
            expect(writes()).toBe(1);

            for (let i = 1; i <= 20; i++) {
                useSyncStore.getState().setLastSyncTime(base + i * 40);
            }

            expect(writes()).toBe(1);
            // The stamp keeps the first timestamp of the window — coarse, never
            // ahead of a real committed save.
            expect(useSyncStore.getState().lastSyncTime).toBe(base);
        });

        it('writes again once the window has elapsed', () => {
            const base = 1_700_000_000_000;
            useSyncStore.getState().setLastSyncTime(base);
            useSyncStore.getState().setLastSyncTime(base + 999);
            expect(writes()).toBe(1);

            useSyncStore.getState().setLastSyncTime(base + 1000);
            expect(writes()).toBe(2);
            expect(useSyncStore.getState().lastSyncTime).toBe(base + 1000);
        });

        it('leaves unrelated settings writes alone', () => {
            useSyncStore.getState().setFirebaseEnabled(true);
            useSyncStore.getState().setFirebaseEnabled(false);
            expect(writes()).toBe(2);
        });
    });
});
