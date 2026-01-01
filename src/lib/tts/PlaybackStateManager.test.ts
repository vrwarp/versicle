import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackStateManager } from './PlaybackStateManager';
import { TTSQueueItem } from './AudioPlayerService';
import { dbService } from '../../db/DBService';

vi.mock('../../db/DBService', () => ({
    dbService: {
        getTTSState: vi.fn(),
        saveTTSState: vi.fn(),
        saveTTSPosition: vi.fn(),
    }
}));

describe('PlaybackStateManager', () => {
    let manager: PlaybackStateManager;

    const queue: TTSQueueItem[] = [
        { text: 'Hello', cfi: 'cfi1' },
        { text: 'World', cfi: 'cfi2' }
    ];

    beforeEach(() => {
        manager = new PlaybackStateManager();
    });

    it('should set and get queue', () => {
        manager.setQueue(queue, 0, 1);
        expect(manager.getQueue()).toEqual(queue);
        expect(manager.getCurrentIndex()).toBe(0);
        expect(manager.getCurrentSectionIndex()).toBe(1);
    });

    it('should navigate next', () => {
        manager.setQueue(queue, 0, 1);
        expect(manager.hasNext()).toBe(true);
        expect(manager.next()).toBe(true);
        expect(manager.getCurrentIndex()).toBe(1);
        expect(manager.hasNext()).toBe(false);
        expect(manager.next()).toBe(false);
    });

    it('should navigate prev', () => {
        manager.setQueue(queue, 1, 1);
        expect(manager.hasPrev()).toBe(true);
        expect(manager.prev()).toBe(true);
        expect(manager.getCurrentIndex()).toBe(0);
        expect(manager.hasPrev()).toBe(false);
        expect(manager.prev()).toBe(false);
    });

    it('should calculate duration correctly', () => {
        // 'Hello' = 5, 'World' = 5. Total = 10.
        // Speed: 180wpm * 1.0 / 60 = 3 chars/sec (using the formula in AudioPlayerService)
        // Actually the service uses (900 * speed) / 60 = 15 chars/sec by default if we assume 5 chars/word.
        // The service formula: (900 * speed) / 60

        manager.setQueue(queue, 0, 1);
        const charsPerSecond = 10;

        expect(manager.calculateTotalDuration(charsPerSecond)).toBe(1); // 10 chars / 10 cps = 1 sec
    });

    it('should calculate current position correctly', () => {
        manager.setQueue(queue, 1, 1); // At 'World'
        const charsPerSecond = 5;
        // Prefix sum for index 1 ('World') is length of 'Hello' = 5.
        // Elapsed before current = 5 / 5 = 1 sec.
        // Provider time = 0.5s

        expect(manager.calculateCurrentPosition(charsPerSecond, 0.5)).toBe(1.5);
    });

    it('should persist queue state', () => {
        manager.setQueue(queue, 0, 1);
        manager.persistQueue('book1');

        expect(dbService.saveTTSState).toHaveBeenCalledWith('book1', queue, 0, 1);
    });

    it('should optimize persistence if queue is unchanged', () => {
        manager.setQueue(queue, 0, 1);
        manager.persistQueue('book1'); // Full persist

        // Change index only
        manager.setCurrentIndex(1);
        manager.persistQueue('book1'); // Should be position persist

        expect(dbService.saveTTSPosition).toHaveBeenCalledWith('book1', 1, 1);
    });

    it('should restore queue from DB', async () => {
        vi.mocked(dbService.getTTSState).mockResolvedValue({
            queue: queue,
            currentIndex: 1,
            sectionIndex: 2
        });

        const success = await manager.restoreQueue('book1');

        expect(success).toBe(true);
        expect(manager.getQueue()).toEqual(queue);
        expect(manager.getCurrentIndex()).toBe(1);
        expect(manager.getCurrentSectionIndex()).toBe(2);
    });
});
