import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackStateManager } from './PlaybackStateManager';
import type { TTSQueueItem } from './AudioPlayerService';

// Mock DBService
vi.mock('../../db/DBService', () => ({
    dbService: {
        saveTTSState: vi.fn(),
        saveTTSPosition: vi.fn(),
        updatePlaybackState: vi.fn(),
    }
}));

describe('PlaybackStateManager Async Masking', () => {
    let stateManager: PlaybackStateManager;

    const mockQueue: TTSQueueItem[] = [
        { text: 'Sentence 1', cfi: 'cfi1', sourceIndices: [0] },
        { text: 'Sentence 2', cfi: 'cfi2', sourceIndices: [1] },
        { text: 'Sentence 3', cfi: 'cfi3', sourceIndices: [2] },
        { text: 'Sentence 4', cfi: 'cfi4', sourceIndices: [3] },
        { text: 'Sentence 5', cfi: 'cfi5', sourceIndices: [4] },
    ];

    beforeEach(() => {
        stateManager = new PlaybackStateManager();
        stateManager.setBookId('test-book');
        stateManager.setQueue([...mockQueue], 0, 0); // Start at 0
        vi.clearAllMocks();
    });

    it('should calculate prefix sums correctly with skipped items', () => {
        // Initially no skips
        // Lengths: 10, 10, 10, 10, 10
        // Prefix sums: [0, 10, 20, 30, 40, 50]

        // Skip indices 1 and 2 (Sentence 2 and 3)
        const skippedRaw = new Set([1, 2]);
        stateManager.applySkippedMask(skippedRaw);

        // Queue length should remain same
        expect(stateManager.queue.length).toBe(5);
        expect(stateManager.queue[1].isSkipped).toBe(true);
        expect(stateManager.queue[2].isSkipped).toBe(true);
        expect(stateManager.queue[0].isSkipped).toBe(false);

        // Virtual lengths: 10, 0, 0, 10, 10
        // Expected Prefix sums: [0, 10, 10, 10, 20, 30]

        // We can't access private prefixSums directly, but we can verify via seek/duration
        // or just reflection if needed, but let's test via public API.

        const totalDuration = stateManager.getTotalDuration();
        // 30 chars / 15 chars/sec = 2 seconds
        expect(totalDuration).toBe(2);
    });

    it('next() should skip over masked items', () => {
        // Skip indices 1 and 2
        const skippedRaw = new Set([1, 2]);
        stateManager.applySkippedMask(skippedRaw);

        // Current index 0. Next should be 3 (Sentence 4).
        stateManager.next();
        expect(stateManager.currentIndex).toBe(3);
        expect(stateManager.getCurrentItem()?.text).toBe('Sentence 4');
    });

    it('prev() should skip over masked items', () => {
        // Skip indices 1 and 2
        const skippedRaw = new Set([1, 2]);
        stateManager.applySkippedMask(skippedRaw);

        // Jump to 4 (Sentence 5)
        stateManager.jumpTo(4);

        // Prev should be 3 (Sentence 4)
        stateManager.prev();
        expect(stateManager.currentIndex).toBe(3);

        // Prev should be 0 (Sentence 1), skipping 2 and 1
        stateManager.prev();
        expect(stateManager.currentIndex).toBe(0);
    });

    it('should handle complex merging logic', () => {
        // Create a merged item
        const complexQueue: TTSQueueItem[] = [
            { text: 'A', cfi: 'c1', sourceIndices: [0] },
            { text: 'BC', cfi: 'c2', sourceIndices: [1, 2] }, // Merged
            { text: 'D', cfi: 'c3', sourceIndices: [3] }
        ];

        stateManager.setQueue(complexQueue, 0, 0);

        // Case 1: Skip only index 1. Item 1 has [1, 2]. NOT ALL skipped. Should NOT skip item.
        stateManager.applySkippedMask(new Set([1]));
        expect(stateManager.queue[1].isSkipped).toBe(false);

        // Case 2: Skip 1 and 2. Item 1 has [1, 2]. ALL skipped. SHOULD skip item.
        stateManager.applySkippedMask(new Set([1, 2]));
        expect(stateManager.queue[1].isSkipped).toBe(true);
    });

    it('seekToTime should respect virtual timeline', () => {
        // Lengths: 10 each.
        // Skip 2nd item (index 1).
        stateManager.applySkippedMask(new Set([1]));

        // Queue: [10, 0(skipped), 10, 10, 10]
        // Timeline:
        // 0-10 chars: Item 0
        // 10-20 chars: Item 2 (Item 1 is skipped)
        // 20-30 chars: Item 3

        // Chars per second is 15.
        // Seek to 0.8s -> 12 chars.
        // Should land on Item 2 (index 2).

        const changed = stateManager.seekToTime(0.8);
        expect(changed).toBe(true);
        expect(stateManager.currentIndex).toBe(2);
    });
});
