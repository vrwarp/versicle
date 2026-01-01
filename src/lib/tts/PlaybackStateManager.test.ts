import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackStateManager } from './PlaybackStateManager';
import { dbService } from '../../db/DBService';

vi.mock('../../db/DBService', () => ({
    dbService: {
        saveTTSPosition: vi.fn().mockResolvedValue(undefined),
        saveTTSState: vi.fn().mockResolvedValue(undefined)
    }
}));

describe('PlaybackStateManager', () => {
    let manager: PlaybackStateManager;
    const mockQueue = [
        { text: 'Sentence one.', cfi: 'cfi1' }, // 13 chars
        { text: 'Sentence two.', cfi: 'cfi2' }  // 13 chars
    ];

    beforeEach(() => {
        manager = new PlaybackStateManager();
        vi.clearAllMocks();
    });

    it('should initialize empty', () => {
        expect(manager.getQueue()).toEqual([]);
        expect(manager.getCurrentIndex()).toBe(0);
    });

    it('should set queue and calculate prefix sums', () => {
        manager.setQueue(mockQueue, 0, 1);
        expect(manager.getQueue()).toEqual(mockQueue);
        expect(manager.getCurrentSectionIndex()).toBe(1);

        // Duration check. Speed 1.0 -> 15 chars/sec (900/60)
        // Total chars: 26. Duration: 26/15 = 1.7333
        expect(manager.getDuration()).toBeCloseTo(1.7333, 3);
    });

    it('should navigate next and prev', () => {
        manager.setQueue(mockQueue, 0, 1);

        expect(manager.next()).toBe(true);
        expect(manager.getCurrentIndex()).toBe(1);

        expect(manager.next()).toBe(false);
        expect(manager.getCurrentIndex()).toBe(1);

        expect(manager.prev()).toBe(true);
        expect(manager.getCurrentIndex()).toBe(0);

        expect(manager.prev()).toBe(false);
        expect(manager.getCurrentIndex()).toBe(0);
    });

    it('should calculate target index for time', () => {
        manager.setQueue(mockQueue, 0, 1);
        manager.setSpeed(1.0); // 15 chars/sec

        // 0.5s -> 7.5 chars -> index 0 (length 13)
        expect(manager.calculateTargetIndexForTime(0.5)).toBe(0);

        // 1.0s -> 15 chars -> index 1 (starts at 13)
        expect(manager.calculateTargetIndexForTime(1.0)).toBe(1);
    });

    it('should persist state', () => {
        manager.setQueue(mockQueue, 0, 1);
        manager.persist('book1');
        expect(dbService.saveTTSState).toHaveBeenCalledWith('book1', mockQueue, 0, 1);

        manager.next();
        manager.persist('book1');
        // Optimized persist called
        expect(dbService.saveTTSPosition).toHaveBeenCalledWith('book1', 1, 1);
    });
});
