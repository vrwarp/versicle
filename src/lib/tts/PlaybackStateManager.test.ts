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

    it('should calculate index from time', () => {
         const items = [
            { text: 'Hello', cfi: '1' }, // 5 chars
            { text: 'World', cfi: '2' }  // 5 chars
        ];
        manager.setQueue(items, 0, 1);
        // speed 1.0 -> 900 chars/min -> 15 chars/sec

        // Time 0.1s -> 1.5 chars -> Index 0
        expect(manager.calculateIndexFromTime(0.1, 1.0)).toBe(0);

        // Time 0.4s -> 6 chars -> Index 1 (since first item is 5 chars)
        expect(manager.calculateIndexFromTime(0.4, 1.0)).toBe(1);
    });

     it('should persist queue correctly', () => {
        const items = [{ text: 'Hello', cfi: '1' }];
        manager.setBookId('book1');
        manager.setQueue(items, 0, 1);

        manager.persistQueue();
        expect(dbService.saveTTSState).toHaveBeenCalledWith('book1', items, 0, 1);

        manager.currentIndex = 1;
        manager.persistQueue(); // Should call saveTTSPosition since queue ref is same
        expect(dbService.saveTTSPosition).toHaveBeenCalledWith('book1', 1, 1);
    });
});
