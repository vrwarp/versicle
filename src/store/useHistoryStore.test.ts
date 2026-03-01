import { describe, it, expect, beforeEach } from 'vitest';
import { useHistoryStore, undoManager, initHistory } from './useHistoryStore';

// Mock Yjs dependencies if needed, but Yjs works in node
// We need to mock yDoc from yjs-provider if it's used directly
// But useHistoryStore imports yDoc.

describe('useHistoryStore', () => {
    beforeEach(() => {
        // Reset undoManager stack
        undoManager.clear();
        useHistoryStore.setState({ history: [], future: [] });
        // Re-init listeners (idempotent-ish)
        initHistory();
    });

    it('should track changes in history', () => {
        // Simulate a change in a tracked type
        const doc = undoManager.doc;
        const map = doc.getMap('library');

        doc.transact(() => {
            map.set('test-book', { title: 'Test' });
        });

        // UndoManager captures async usually, but we can force it or wait
        // Default captureTimeout is 500ms.
        // We can manually add to stack or wait.
        // Or we can stopCapturing() to force immediate push
        undoManager.stopCapturing();

        const { history } = useHistoryStore.getState();
        expect(history.length).toBe(1);
        expect(history[0].description).toBe('Update'); // Default description
    });

    it('should limit history to 100 items', () => {
        const doc = undoManager.doc;
        const map = doc.getMap('library');

        for (let i = 0; i < 110; i++) {
            doc.transact(() => {
                map.set(`book-${i}`, { title: `Title ${i}` });
            });
            undoManager.stopCapturing();
        }

        const { history } = useHistoryStore.getState();
        expect(history.length).toBe(100);
        // The oldest should be removed.
        // History is Newest -> Oldest.
        // So history[99] (oldest) should correspond to the 11th edit (index 10)
        // because 0-9 were removed.
    });

    it('should undo changes', () => {
        const doc = undoManager.doc;
        const map = doc.getMap('library');

        doc.transact(() => {
            map.set('undo-test', 'val1');
        });
        undoManager.stopCapturing();

        expect(map.get('undo-test')).toBe('val1');

        useHistoryStore.getState().undo();

        expect(map.get('undo-test')).toBeUndefined();
    });
});
