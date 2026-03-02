import { describe, it, expect, beforeEach } from 'vitest';
import { useHistoryStore, initHistory } from './useHistoryStore';
import { sessionRewindManager } from '../lib/sync/SessionRewindManager';
import { yDoc } from './yjs-provider';

describe('useHistoryStore', () => {
    beforeEach(() => {
        // Reset rewind manager
        sessionRewindManager.reset();
        useHistoryStore.setState({ history: [], future: [] });

        initHistory();
    });

    it('should track changes in history', async () => {
        // Simulate a change in a tracked type
        const map = yDoc.getMap('library');
        yDoc.transact(() => {
            map.set('test', 1);
        }, { getState: () => {} });

        // wait for auto capture
        await new Promise(r => setTimeout(r, 10));

        const state = useHistoryStore.getState();
        expect(state.history.length).toBe(1);
        expect(state.history[0].description).toBe('Update');
    });

    it('should handle undo correctly', async () => {
        const map = yDoc.getMap('library');

        yDoc.transact(() => {
            map.set('test', 1);
        }, { getState: () => {} });

        await new Promise(r => setTimeout(r, 10));

        yDoc.transact(() => {
            map.set('test2', 2);
        }, { getState: () => {} });

        await new Promise(r => setTimeout(r, 10));

        expect(useHistoryStore.getState().history.length).toBe(2);

        useHistoryStore.getState().undo();

        await new Promise(r => setTimeout(r, 10));

        // After undo, the most recent snapshot is removed
        expect(useHistoryStore.getState().history.length).toBe(1);
    });

    it('should handle undoTo correctly', async () => {
        const map = yDoc.getMap('library');

        for (let i = 0; i < 3; i++) {
            yDoc.transact(() => {
                map.set(`test${i}`, i);
            }, { getState: () => {} });
            await new Promise(r => setTimeout(r, 10));
        }

        expect(useHistoryStore.getState().history.length).toBe(3);

        // Undo to index 1 means undoing the 2 most recent changes
        useHistoryStore.getState().undoTo(1);

        await new Promise(r => setTimeout(r, 10));

        expect(useHistoryStore.getState().history.length).toBe(1);
    });
});
