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

    it('should calculate index from time using seekToTime', () => {
         const items = [
            { text: 'Hello', cfi: '1' }, // 5 chars
            { text: 'World', cfi: '2' }  // 5 chars
        ];
        manager.setQueue(items, 0, 1);
        // speed 1.0 -> 900 chars/min -> 15 chars/sec

        // Time 0.1s -> 1.5 chars -> Index 0
        // If current index is 0, seekToTime returns false as index doesn't change
        expect(manager.seekToTime(0.1, 1.0)).toBe(false);
        expect(manager.currentIndex).toBe(0);

        // Time 0.4s -> 6 chars -> Index 1 (since first item is 5 chars)
        // This should change index to 1
        expect(manager.seekToTime(0.4, 1.0)).toBe(true);
        expect(manager.currentIndex).toBe(1);
    });

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
});
