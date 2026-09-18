import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useLocalHistoryStore } from './useLocalHistoryStore';

describe('useLocalHistoryStore', () => {
    beforeEach(() => {
        useLocalHistoryStore.setState({ lastReadBookId: null });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('records the last read book id', () => {
        useLocalHistoryStore.getState().setLastReadBookId('book-1');
        expect(useLocalHistoryStore.getState().lastReadBookId).toBe('book-1');
    });

    it('moves to a different book id', () => {
        useLocalHistoryStore.getState().setLastReadBookId('book-1');
        useLocalHistoryStore.getState().setLastReadBookId('book-2');
        expect(useLocalHistoryStore.getState().lastReadBookId).toBe('book-2');
    });

    /**
     * perf: setLastReadBookId is called from every hot reading write
     * (updateLocation / addCompletedRange / updateReadingSession /
     * updatePlaybackPosition / updateTTSProgress) — i.e. on every page turn
     * AND every TTS sentence, always with the SAME book id. The store is
     * persist-wrapped, and zustand's persist middleware wraps the config
     * `set` as `set(...); setItem()` — setItem (JSON.stringify + a
     * synchronous localStorage.setItem) runs even when the inner set
     * short-circuits, so the guard has to run BEFORE set().
     */
    describe('regression: repeated setLastReadBookId does not re-persist', () => {
        it('writes localStorage once when the id is unchanged', () => {
            const setItem = vi.spyOn(window.localStorage, 'setItem');

            useLocalHistoryStore.getState().setLastReadBookId('book-1');
            const afterFirst = setItem.mock.calls.length;
            expect(afterFirst).toBeGreaterThan(0);

            useLocalHistoryStore.getState().setLastReadBookId('book-1');
            useLocalHistoryStore.getState().setLastReadBookId('book-1');

            expect(setItem.mock.calls.length).toBe(afterFirst);
            expect(useLocalHistoryStore.getState().lastReadBookId).toBe('book-1');
        });

        it('still persists when the id actually changes', () => {
            useLocalHistoryStore.getState().setLastReadBookId('book-1');
            const setItem = vi.spyOn(window.localStorage, 'setItem');

            useLocalHistoryStore.getState().setLastReadBookId('book-2');

            expect(setItem).toHaveBeenCalled();
            expect(useLocalHistoryStore.getState().lastReadBookId).toBe('book-2');
        });
    });
});
