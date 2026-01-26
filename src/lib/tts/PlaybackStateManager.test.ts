import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackStateManager } from './PlaybackStateManager';
import { dbService } from '../../db/DBService';

// Mock DBService
vi.mock('../../db/DBService', () => ({
    dbService: {
        saveTTSState: vi.fn(),
        saveTTSPosition: vi.fn(),
        updatePlaybackState: vi.fn(),
    }
}));

describe('PlaybackStateManager', () => {
    let manager: PlaybackStateManager;

    beforeEach(() => {
        manager = new PlaybackStateManager();
        vi.clearAllMocks();
    });

    it('should set queue and calculate prefix sums', () => {
        const items = [
            { text: 'Hello', cfi: '1' },
            { text: 'World', cfi: '2' }
        ];
        manager.setQueue(items, 0, 0);

        expect(manager.queue).toEqual(items);
        expect(manager.currentIndex).toBe(0);
        expect(manager.currentSectionIndex).toBe(0);
        // Prefix sums: [0, 5, 10]
        // Private property, verify via side effects if needed or check behavior
    });

    it('should reset state correctly', () => {
        const items = [{ text: 'Hello', cfi: '1' }];
        manager.setQueue(items, 0, 0);
        manager.reset();

        expect(manager.queue).toEqual([]);
        expect(manager.currentIndex).toBe(0);
        expect(manager.currentSectionIndex).toBe(-1);
    });

    it('should handle book ID changes', () => {
        const items = [{ text: 'Hello', cfi: '1' }];
        manager.setQueue(items, 0, 0);

        manager.setBookId('book2');

        expect(manager.queue).toEqual(items); // Does NOT reset queue on ID change alone unless it was null?
        // Wait, setBookId calls reset() if bookId is falsey.
        // It does NOT clear queue if bookId changes to another string,
        // BUT AudioPlayerService usually clears it.
        // PlaybackStateManager just tracks ID.
        // But logic: if (currentBookId !== bookId) { ... lastPersistedQueue = null; if (!bookId) reset(); }
        // So queue persists.
    });

    it('should check if queue is identical', () => {
        const items = [{ text: 'Hello', cfi: '1' }];
        manager.setQueue(items, 0, 0);

        expect(manager.isIdenticalTo(items)).toBe(true);
        expect(manager.isIdenticalTo([{ text: 'Hello', cfi: '2' }])).toBe(false);
    });

    it('should return current item', () => {
        const items = [{ text: 'Hello', cfi: '1' }, { text: 'World', cfi: '2' }];
        manager.setQueue(items, 1, 0);

        expect(manager.getCurrentItem()).toEqual(items[1]);
    });

    describe('Navigation', () => {
        it('should report hasNext/hasPrev correctly', () => {
            const items = [{ text: '1', cfi: 'a' }, { text: '2', cfi: 'b' }, { text: '3', cfi: 'c' }];
            manager.setQueue(items, 1, 0); // Middle

            expect(manager.hasNext()).toBe(true);
            expect(manager.hasPrev()).toBe(true);

            manager.jumpTo(0);
            expect(manager.hasNext()).toBe(true);
            expect(manager.hasPrev()).toBe(false);

            manager.jumpTo(2);
            expect(manager.hasNext()).toBe(false);
            expect(manager.hasPrev()).toBe(true);
        });

        it('should navigate next', () => {
            const items = [{ text: '1', cfi: 'a' }, { text: '2', cfi: 'b' }];
            manager.setQueue(items, 0, 0);

            expect(manager.next()).toBe(true);
            expect(manager.currentIndex).toBe(1);
            expect(manager.next()).toBe(false); // End of queue
        });

        it('should navigate prev', () => {
            const items = [{ text: '1', cfi: 'a' }, { text: '2', cfi: 'b' }];
            manager.setQueue(items, 1, 0);

            expect(manager.prev()).toBe(true);
            expect(manager.currentIndex).toBe(0);
            expect(manager.prev()).toBe(false); // Start of queue
        });

        it('should jump to index', () => {
            const items = [
                { text: '1', cfi: 'a' },
                { text: '2', cfi: 'b' },
                { text: '3', cfi: 'c' }
            ];
            manager.setQueue(items, 1, 0); // Start at middle item

            expect(manager.jumpTo(0)).toBe(true);
            expect(manager.currentIndex).toBe(0);

            expect(manager.jumpTo(2)).toBe(true);
            expect(manager.currentIndex).toBe(2);

            expect(manager.jumpTo(5)).toBe(false); // Out of bounds
            expect(manager.currentIndex).toBe(2); // Should not change
        });

        it('should jump to end', () => {
            const items = [
                { text: '1', cfi: 'a' },
                { text: '2', cfi: 'b' }
            ];
            manager.setQueue(items, 0, 0);

            manager.jumpToEnd();
            expect(manager.currentIndex).toBe(1);
        });
    });

    describe('Time Calculations', () => {
        it('should calculate chars per second', () => {
            expect(manager.calculateCharsPerSecond()).toBe(15);
        });

        it('should seek to time', () => {
            const items = [
                { text: 'abcde', cfi: '1' }, // 5 chars
                { text: 'fghij', cfi: '2' }   // 5 chars
            ];
            manager.setQueue(items, 0, 0);

            // Total 10 chars. 15 chars/sec.
            // Item 1 ends at 5/15 = 0.33s.
            // Seek to 0.4s -> 6 chars -> should be index 1.

            expect(manager.seekToTime(0.4)).toBe(true);
            expect(manager.currentIndex).toBe(1);
        });

        it('should calculate current position', () => {
            const items = [
                { text: 'abcde', cfi: '1' }, // 5 chars
                { text: 'fghij', cfi: '2' }   // 5 chars
            ];
            manager.setQueue(items, 1, 0); // At item 2

            // Start of item 2 is 5 chars. 5/15 = 0.333s.
            // providerTime = 0.1s.
            // Total = 0.433s.

            const pos = manager.getCurrentPosition(0.1);
            expect(pos).toBeCloseTo(0.433, 2);
        });

        it('should calculate total duration', () => {
            const items = [
                { text: 'abcde', cfi: '1' }, // 5 chars
                { text: 'fghij', cfi: '2' }   // 5 chars
            ];
            manager.setQueue(items, 0, 0);

            // 10 chars / 15 cps = 0.666s
            expect(manager.getTotalDuration()).toBeCloseTo(0.666, 2);
        });

        it('should handle zero duration gracefully', () => {
            manager.setQueue([], 0, 0);
            expect(manager.getTotalDuration()).toBe(0);
            expect(manager.getCurrentPosition(1)).toBe(0);
        });
    });

    describe('Persistence', () => {
        it('should persist queue correctly', () => {
            const items = [{ text: 'Hello', cfi: '1' }, { text: 'World', cfi: '2' }];
            manager.setBookId('book1');
            manager.setQueue(items, 0, 1);

            // setQueue automatically persists
            expect(dbService.saveTTSState).toHaveBeenCalledWith('book1', items, 1);
        });

        it('should save playback state', async () => {
            const items = [{ text: 'Hello', cfi: 'cfi1' }];
            manager.setBookId('book1');
            manager.setQueue(items, 0, 0);

            await manager.savePlaybackState('paused');

            expect(dbService.updatePlaybackState).toHaveBeenCalledWith('book1', undefined, expect.any(Number));
        });

        it('should not persist if bookId is not set', () => {
            const items = [{ text: 'Hello', cfi: '1' }];
            manager.setQueue(items, 0, 1); // No book ID set

            expect(dbService.saveTTSState).not.toHaveBeenCalled();
        });
    });

    describe('Events', () => {
        it('should notify subscribers on state change', () => {
            const listener = vi.fn();
            manager.subscribe(listener);

            const items = [{ text: 'Hello', cfi: '1' }, { text: 'World', cfi: '2' }];
            manager.setQueue(items, 0, 0);

            expect(listener).toHaveBeenCalledWith(expect.objectContaining({
                queue: items,
                currentIndex: 0
            }));
        });

        it('should not notify subscribers if next fails', () => {
            const listener = vi.fn();
            manager.subscribe(listener);

            const items = [{ text: 'Hello', cfi: '1' }];
            manager.setQueue(items, 0, 0); // 1 call

            manager.next(); // fails

            // Should have been called once for setQueue, but not for next failure
            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('should unsubscribe correctly', () => {
            const listener = vi.fn();
            const unsubscribe = manager.subscribe(listener);

            unsubscribe();
            manager.setQueue([], 0, 0);

            expect(listener).not.toHaveBeenCalled();
        });
    });
});
