import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlaybackStateManager } from './PlaybackStateManager';
import { TTSQueueItem } from './AudioPlayerService';

// Mock dbService
vi.mock('../../db/DBService', () => ({
  dbService: {
    saveTTSPosition: vi.fn(),
    saveTTSState: vi.fn(),
    updatePlaybackState: vi.fn(),
  }
}));

describe('PlaybackStateManager - Table Adaptations', () => {
    let manager: PlaybackStateManager;

    beforeEach(() => {
        manager = new PlaybackStateManager();
        manager.setBookId('test-book');
        vi.clearAllMocks();
    });

    const createItem = (text: string, sourceIndices: number[], isSkipped: boolean = false): TTSQueueItem => ({
        text,
        sourceIndices,
        isSkipped,
        cfi: '',
        type: 'text'
    });

    it('should apply adaptation replacing single item', () => {
        const queue = [
            createItem('Row 1 Col 1', [0]),
            createItem('Row 1 Col 2', [1]),
        ];
        manager.setQueue(queue, 0, 0);

        manager.applyTableAdaptations([
            { indices: [0], text: 'Adapted Row 1 Col 1' }
        ]);

        const newQueue = manager.queue;
        expect(newQueue[0].text).toBe('Adapted Row 1 Col 1');
        expect(newQueue[0].isSkipped).toBe(false);
        expect(newQueue[1].text).toBe('Row 1 Col 2');
    });

    it('should apply adaptation merging multiple items', () => {
        const queue = [
            createItem('Header', [0]),
            createItem('Cell 1', [1]),
            createItem('Cell 2', [2]),
            createItem('Footer', [3]),
        ];
        manager.setQueue(queue, 0, 0);

        // Adaptation covers items with indices 1 and 2
        manager.applyTableAdaptations([
            { indices: [1, 2], text: 'Adapted Table Row' }
        ]);

        const newQueue = manager.queue;
        expect(newQueue[0].text).toBe('Header');

        // First item of the group is updated (Anchor)
        expect(newQueue[1].text).toBe('Adapted Table Row');
        expect(newQueue[1].isSkipped).toBe(false);

        // Subsequent items are skipped
        expect(newQueue[2].isSkipped).toBe(true);

        expect(newQueue[3].text).toBe('Footer');
        expect(newQueue[3].isSkipped).toBe(false);
    });

    it('should handle disjoint adaptations', () => {
        const queue = [
            createItem('A', [1]),
            createItem('B', [2]),
            createItem('C', [3]),
            createItem('D', [4]),
        ];
        manager.setQueue(queue, 0, 0);

        manager.applyTableAdaptations([
            { indices: [1], text: 'New A' },
            { indices: [3, 4], text: 'New CD' }
        ]);

        const newQueue = manager.queue;
        expect(newQueue[0].text).toBe('New A');
        expect(newQueue[1].text).toBe('B');
        expect(newQueue[2].text).toBe('New CD');
        expect(newQueue[3].isSkipped).toBe(true);
    });

    it('should ignore adaptations with no matching items', () => {
        const queue = [createItem('A', [1])];
        manager.setQueue(queue, 0, 0);

        manager.applyTableAdaptations([
            { indices: [99], text: 'Ghost' }
        ]);

        expect(manager.queue[0].text).toBe('A');
    });

    it('should not match item if source indices are partially outside adaptation', () => {
        // Adaptation indices: [1]
        // Item indices: [1, 2] -> Item is NOT fully contained in adaptation -> No Match
        const queue = [createItem('Combined', [1, 2])];
        manager.setQueue(queue, 0, 0);

        manager.applyTableAdaptations([
            { indices: [1], text: 'Partial' }
        ]);

        expect(manager.queue[0].text).toBe('Combined');
    });

    it('should match item if source indices are subset of adaptation', () => {
        // Adaptation indices: [1, 2, 3]
        // Item indices: [1, 2] -> Item IS fully contained -> Match
        const queue = [createItem('Subset', [1, 2])];
        manager.setQueue(queue, 0, 0);

        manager.applyTableAdaptations([
            { indices: [1, 2, 3], text: 'Superset' }
        ]);

        expect(manager.queue[0].text).toBe('Superset');
    });

    it('should unskip item if it becomes the anchor of an adaptation', () => {
        const queue = [createItem('A', [1], true)]; // Initially skipped
        manager.setQueue(queue, 0, 0);

        manager.applyTableAdaptations([
            { indices: [1], text: 'Revived' }
        ]);

        expect(manager.queue[0].isSkipped).toBe(false);
        expect(manager.queue[0].text).toBe('Revived');
    });

    it('should update prefix sums when adaptation changes text length', () => {
        // Original: "A" (len 1) + "B" (len 1) = 2
        // Adapted: "Longer" (len 6), "B" skipped
        const queue = [
            createItem('A', [1]),
            createItem('B', [2])
        ];
        manager.setQueue(queue, 0, 0);

        expect(manager.prefixSums).toEqual([0, 1, 2]);

        manager.applyTableAdaptations([
            { indices: [1, 2], text: 'Longer' }
        ]);

        // New queue: Item 0 is "Longer" (6), Item 1 is skipped (0)
        expect(manager.prefixSums).toEqual([0, 6, 6]);
    });

    it('should notify listeners on change', () => {
        const listener = vi.fn();
        manager.subscribe(listener);

        const queue = [createItem('A', [1])];
        manager.setQueue(queue, 0, 0);
        listener.mockClear(); // Clear initial setQueue call

        manager.applyTableAdaptations([
            { indices: [1], text: 'B' }
        ]);

        expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should not notify if no changes', () => {
         const listener = vi.fn();
         const queue = [createItem('A', [1])];
         manager.setQueue(queue, 0, 0);
         listener.mockClear();
         manager.subscribe(listener);

         manager.applyTableAdaptations([]); // Empty
         expect(listener).not.toHaveBeenCalled();

         manager.applyTableAdaptations([{ indices: [99], text: 'X' }]); // No match
         expect(listener).not.toHaveBeenCalled();
    });

    it('should handle overlapping adaptations prioritizing order', () => {
        // Tests the logic that prevents handled indices from being processed again
        const queue = [
            createItem('A', [1]),
            createItem('B', [2]),
            createItem('C', [3])
        ];
        manager.setQueue(queue, 0, 0);

        // Adapt 1: [1, 2] -> Covers A, B
        // Adapt 2: [2, 3] -> Covers B, C

        manager.applyTableAdaptations([
            { indices: [1, 2], text: 'AB' },
            { indices: [2, 3], text: 'BC' }
        ]);

        const newQueue = manager.queue;
        // First adaptation wins for A and B
        expect(newQueue[0].text).toBe('AB');
        expect(newQueue[1].isSkipped).toBe(true);

        // Second adaptation looks for matches.
        // B (idx 1) is handled by first.
        // C (idx 2) is NOT handled. Matches [2, 3] because [3] is subset of [2, 3].

        expect(newQueue[2].text).toBe('BC');
        expect(newQueue[2].isSkipped).toBe(false);
    });
});
