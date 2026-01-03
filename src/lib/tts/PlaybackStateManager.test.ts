import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackStateManager } from './PlaybackStateManager';
import { dbService } from '../../db/DBService';

vi.mock('../../db/DBService', () => ({
    dbService: {
        saveTTSPosition: vi.fn(),
        saveTTSState: vi.fn(),
        updatePlaybackState: vi.fn(),
    }
}));

describe('PlaybackStateManager', () => {
    let manager: PlaybackStateManager;

    beforeEach(() => {
        manager = new PlaybackStateManager();
        vi.clearAllMocks();
    });

    describe('State Management', () => {
        it('should set queue and calculate prefix sums', () => {
            const items = [
                { text: 'Hello', cfi: '1' },
                { text: 'World', cfi: '2' }
            ];
            manager.setQueue(items, 0, 1);
            expect(manager.queue).toEqual(items);
            expect(manager.currentIndex).toBe(0);
            expect(manager.currentSectionIndex).toBe(1);
            expect(manager.prefixSums).toEqual([0, 5, 10]);
        });

        it('should reset state correctly', () => {
            const items = [{ text: 'Hello', cfi: '1' }];
            manager.setQueue(items, 0, 1);
            manager.reset();

            expect(manager.queue).toEqual([]);
            expect(manager.currentIndex).toBe(0);
            expect(manager.currentSectionIndex).toBe(-1);
            expect(manager.prefixSums).toEqual([0]);
        });

        it('should handle book ID changes', () => {
            const items = [{ text: 'Hello', cfi: '1' }];

            // Set first book
            manager.setBookId('book1');
            manager.setQueue(items, 0, 1);
            expect(manager.queue.length).toBe(1);

            // Change to new book - should reset state implicitly if desired,
            // but the method just updates ID and resets persisted queue tracker.
            // If passed null, it resets everything.
            manager.setBookId('book2');
            // Queue remains until explicit reset or setQueue, but persistence tracker is reset.

            // Test reset on null
            manager.setBookId(null);
            expect(manager.queue).toEqual([]);
        });

        it('should check if queue is identical', () => {
            const items = [{ text: 'A', cfi: '1' }];
            const itemsSame = [{ text: 'A', cfi: '1' }];
            const itemsDiffText = [{ text: 'B', cfi: '1' }];
            const itemsDiffCfi = [{ text: 'A', cfi: '2' }];
            const itemsDiffLen = [{ text: 'A', cfi: '1' }, { text: 'B', cfi: '2' }];

            manager.setQueue(items, 0, 0);

            expect(manager.isIdenticalTo(itemsSame)).toBe(true);
            expect(manager.isIdenticalTo(itemsDiffText)).toBe(false);
            expect(manager.isIdenticalTo(itemsDiffCfi)).toBe(false);
            expect(manager.isIdenticalTo(itemsDiffLen)).toBe(false);
        });

        it('should return current item', () => {
            const items = [{ text: 'A', cfi: '1' }, { text: 'B', cfi: '2' }];
            manager.setQueue(items, 1, 0);
            expect(manager.getCurrentItem()).toEqual(items[1]);

            manager.reset();
            expect(manager.getCurrentItem()).toBeNull();
        });
    });

    describe('Navigation', () => {
        beforeEach(() => {
            const items = [
                { text: '1', cfi: 'a' },
                { text: '2', cfi: 'b' },
                { text: '3', cfi: 'c' }
            ];
            manager.setQueue(items, 1, 0); // Start at middle item
        });

        it('should report hasNext/hasPrev correctly', () => {
            expect(manager.hasNext()).toBe(true);
            expect(manager.hasPrev()).toBe(true);

            manager.jumpToEnd();
            expect(manager.hasNext()).toBe(false);
            expect(manager.hasPrev()).toBe(true);

            manager.jumpTo(0);
            expect(manager.hasNext()).toBe(true);
            expect(manager.hasPrev()).toBe(false);
        });

        it('should navigate next', () => {
            expect(manager.next()).toBe(true);
            expect(manager.currentIndex).toBe(2);
            expect(manager.next()).toBe(false); // Can't go past end
            expect(manager.currentIndex).toBe(2);
        });

        it('should navigate prev', () => {
            expect(manager.prev()).toBe(true);
            expect(manager.currentIndex).toBe(0);
            expect(manager.prev()).toBe(false); // Can't go past start
            expect(manager.currentIndex).toBe(0);
        });

        it('should jump to index', () => {
            expect(manager.jumpTo(0)).toBe(true);
            expect(manager.currentIndex).toBe(0);
            expect(manager.jumpTo(2)).toBe(true);
            expect(manager.currentIndex).toBe(2);

            // Invalid indices
            expect(manager.jumpTo(-1)).toBe(false);
            expect(manager.jumpTo(3)).toBe(false);
            expect(manager.currentIndex).toBe(2); // Should not change
        });

        it('should jump to end', () => {
            manager.jumpTo(0);
            manager.jumpToEnd();
            expect(manager.currentIndex).toBe(2);
        });
    });

    describe('Time Calculations', () => {
        beforeEach(() => {
            const items = [
                { text: 'abcde', cfi: '1' }, // 5 chars
                { text: 'fghij', cfi: '2' }  // 5 chars
            ];
            manager.setQueue(items, 0, 0);
        });

        it('should calculate chars per second', () => {
            // Speed independent -> 900 chars/min -> 15 chars/sec
            expect(manager.calculateCharsPerSecond()).toBe(15);
        });

        it('should seek to time', () => {
            // 15 chars/sec. Item 1 ends at 5 chars (0.33s).

            // Seek to 0.1s -> 1.5 chars -> Index 0
            expect(manager.seekToTime(0.1)).toBe(false); // No change

            // Seek to 0.4s -> 6 chars -> Index 1
            expect(manager.seekToTime(0.4)).toBe(true);
            expect(manager.currentIndex).toBe(1);
        });

        it('should calculate current position', () => {
            // Index 0. 15 chars/sec.
            // Start of item 0 is 0s.
            expect(manager.getCurrentPosition(0.1)).toBeCloseTo(0.1);

            // Move to Index 1. Prefix sum = 5.
            manager.next();
            // Start of item 1 is 5/15 = 0.333s.
            // Provider time 0.1s -> Total 0.433s
            expect(manager.getCurrentPosition(0.1)).toBeCloseTo(0.333 + 0.1);
        });

        it('should calculate total duration', () => {
            // Total 10 chars. 15 chars/sec.
            // Duration = 10/15 = 0.666s
            expect(manager.getTotalDuration()).toBeCloseTo(0.666);
        });

        it('should handle zero duration gracefully', () => {
            manager.setQueue([], 0, 0);
            expect(manager.getTotalDuration()).toBe(0);
            expect(manager.getCurrentPosition(0)).toBe(0);
        });
    });

    describe('Persistence', () => {
        it('should persist queue correctly', () => {
            const items = [{ text: 'Hello', cfi: '1' }, { text: 'World', cfi: '2' }];
            manager.setBookId('book1');
            manager.setQueue(items, 0, 1);

            // setQueue automatically persists
            expect(dbService.saveTTSState).toHaveBeenCalledWith('book1', items, 0, 1);

            // Move to next item
            manager.next();
            // next calls persistQueue. Since queue ref is same, should use saveTTSPosition
            expect(dbService.saveTTSPosition).toHaveBeenCalledWith('book1', 1, 1);
        });

        it('should save playback state', async () => {
            const items = [{ text: 'Hello', cfi: 'cfi1' }];
            manager.setBookId('book1');
            manager.setQueue(items, 0, 0);

            await manager.savePlaybackState('paused');

            expect(dbService.updatePlaybackState).toHaveBeenCalledWith(
                'book1',
                'cfi1',
                expect.any(Number) // timestamp
            );
        });

        it('should not persist if bookId is not set', () => {
            const items = [{ text: 'Hello', cfi: '1' }];
            manager.setQueue(items, 0, 1); // No book ID set

            expect(dbService.saveTTSState).not.toHaveBeenCalled();
            expect(dbService.saveTTSPosition).not.toHaveBeenCalled();
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

            manager.next();
            expect(listener).toHaveBeenCalledTimes(2); // setQueue + next (valid)
        });

        it('should not notify subscribers if next fails', () => {
            const listener = vi.fn();
            manager.subscribe(listener);

            const items = [{ text: 'Hello', cfi: '1' }];
            manager.setQueue(items, 0, 0); // 1 call

            manager.next(); // fails
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
