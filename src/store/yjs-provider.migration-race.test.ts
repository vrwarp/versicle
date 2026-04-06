import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runMigrations } from './yjs-provider';
import { useBookStore } from './useBookStore';

describe('Yjs Provider - runMigrations race condition', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        useBookStore.setState({ __schemaVersion: 1 } as any);
        vi.restoreAllMocks();
    });

    it('should queue migrations on the microtask queue, not macrotask queue', async () => {
        // Mock setTimeout to ensure it doesn't get called.
        const setTimeoutSpy = vi.spyOn(global, 'setTimeout');
        const queueMicrotaskSpy = vi.spyOn(global, 'queueMicrotask');

        runMigrations();

        // Should be queued twice to jump behind zustand-middleware-yjs's microtask
        expect(queueMicrotaskSpy).toHaveBeenCalled();
        expect(setTimeoutSpy).not.toHaveBeenCalledWith(expect.any(Function), 0);
    });
});
