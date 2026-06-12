/**
 * QueueModel unit suite (Phase 5b-PR2) — the immutable (copy-on-write) queue
 * model, renamed from PlaybackStateManager.
 *
 * Carries, per the absorption ledger (plan/overhaul/prep/phase5-absorption-ledger.md
 * row 14), the surviving assertions of the two per-bug suites deleted in this
 * commit as named regression blocks:
 *   - describe('regression: PlaybackStateManager_Masking')
 *   - describe('regression: PlaybackStateManager_Adaptation')
 * plus the immutability/identity suite that flips the P14 parity rider green.
 * The base behavior specs below are the former PlaybackStateManager.test.ts,
 * renamed with the class (merge, not delete-without-absorb).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueueModel } from './QueueModel';
import type { TTSQueueItem } from './AudioPlayerService';
import { playbackCache } from '@data/repos/playbackCache';

// Mock the playback session repo
vi.mock('@data/repos/playbackCache', () => ({
    playbackCache: {
        saveQueue: vi.fn(),
        savePauseTime: vi.fn(),
    }
}));

describe('QueueModel', () => {
    let manager: QueueModel;

    beforeEach(() => {
        manager = new QueueModel();
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

        // setBookId only resets when the id is cleared; a switch to another
        // book keeps the queue (AudioPlayerService owns the cross-book reset).
        expect(manager.queue).toEqual(items);
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

    describe('immutability & identity (the P14 copy-on-write guarantee)', () => {
        const items = (): TTSQueueItem[] => [
            { text: 'Sentence 1', cfi: 'cfi1', sourceIndices: [0] },
            { text: 'Sentence 2', cfi: 'cfi2', sourceIndices: [1] },
        ];

        it('setQueue does not adopt the caller’s array (later caller mutation is invisible)', () => {
            const input = items();
            manager.setQueue(input, 0, 0);
            expect(manager.queue).not.toBe(input);

            input.push({ text: 'sneaky', cfi: 'x' });
            expect(manager.queue).toHaveLength(2);
        });

        it('applySkippedMask is copy-on-write: fresh array, fresh queueId, old array untouched', () => {
            manager.setQueue(items(), 0, 0);
            const before = manager.queue;
            const beforeId = manager.queueId;

            manager.applySkippedMask(new Set([1]));

            expect(manager.queue).not.toBe(before);
            expect(manager.queueId).not.toBe(beforeId);
            expect(manager.queue[1].isSkipped).toBe(true);
            // The previously published array kept its content (no in-place mutation).
            expect(before[1].isSkipped ?? false).toBe(false);
        });

        it('applyTableAdaptations is copy-on-write with a fresh queueId', () => {
            manager.setQueue(items(), 0, 0);
            const before = manager.queue;
            const beforeId = manager.queueId;

            manager.applyTableAdaptations([{ indices: [0, 1], text: 'Adapted' }]);

            expect(manager.queue).not.toBe(before);
            expect(manager.queueId).not.toBe(beforeId);
            expect(before[0].text).toBe('Sentence 1');
        });

        it('published queues are frozen in DEV: in-place mutation throws', () => {
            manager.setQueue(items(), 0, 0);
            expect(Object.isFrozen(manager.queue)).toBe(true);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            expect(() => { (manager.queue as any).push({ text: 'no', cfi: 'no' }); }).toThrow();
        });

        it('index moves (next/jumpTo) do NOT change the queueId or the array identity', () => {
            manager.setQueue(items(), 0, 0);
            const ref = manager.queue;
            const id = manager.queueId;

            manager.next();
            manager.jumpTo(0);

            expect(manager.queue).toBe(ref);
            expect(manager.queueId).toBe(id);
        });

        it('a no-op mask (nothing changes) keeps array identity and queueId', () => {
            // Explicit isSkipped:false — items with UNDEFINED isSkipped get normalized
            // to false on first mask application (legacy behavior), which counts as a
            // change; a true no-op needs the flags already explicit.
            manager.setQueue(items().map((i) => ({ ...i, isSkipped: false })), 0, 0);
            const ref = manager.queue;
            const id = manager.queueId;

            manager.applySkippedMask(new Set());

            expect(manager.queue).toBe(ref);
            expect(manager.queueId).toBe(id);
        });
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
            expect(playbackCache.saveQueue).toHaveBeenCalledWith('book1', items);
        });

        it('should save playback state', async () => {
            const items = [{ text: 'Hello', cfi: 'cfi1' }];
            manager.setBookId('book1');
            manager.setQueue(items, 0, 0);

            await manager.savePlaybackState('paused');

            expect(playbackCache.savePauseTime).toHaveBeenCalledWith('book1', expect.any(Number));
        });

        it('should not persist if bookId is not set', () => {
            const items = [{ text: 'Hello', cfi: '1' }];
            manager.setQueue(items, 0, 1); // No book ID set

            expect(playbackCache.saveQueue).not.toHaveBeenCalled();
        });

        it('dedupes persistence on queueId: index moves do not re-save, queue changes do', () => {
            const items = [
                { text: 'Hello', cfi: '1', sourceIndices: [0] },
                { text: 'World', cfi: '2', sourceIndices: [1] },
            ];
            manager.setBookId('book1');
            manager.setQueue(items, 0, 0);
            expect(playbackCache.saveQueue).toHaveBeenCalledTimes(1);

            // Index-only moves keep the same queueId — no re-save.
            manager.next();
            manager.jumpTo(0);
            expect(playbackCache.saveQueue).toHaveBeenCalledTimes(1);

            // A content change (mask) stamps a new queueId — saved again, with the
            // masked flag included (the S4 bug: the reference-dedupe used to skip
            // exactly this write because the array was mutated in place).
            manager.applySkippedMask(new Set([1]));
            expect(playbackCache.saveQueue).toHaveBeenCalledTimes(2);
            const saved = vi.mocked(playbackCache.saveQueue).mock.calls[1][1];
            expect(saved[1].isSkipped).toBe(true);
        });
    });

    describe('Events', () => {
        it('should notify subscribers on state change (incl. queueId)', () => {
            const listener = vi.fn();
            manager.subscribe(listener);

            const items = [{ text: 'Hello', cfi: '1' }, { text: 'World', cfi: '2' }];
            manager.setQueue(items, 0, 0);

            expect(listener).toHaveBeenCalledWith(expect.objectContaining({
                queue: items,
                queueId: manager.queueId,
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

    // =======================================================================
    // Absorbed per-bug suites (ledger row 14, deleted in this commit).
    // =======================================================================

    describe('regression: PlaybackStateManager_Masking', () => {
        const mockQueue: TTSQueueItem[] = [
            { text: 'Sentence 1', cfi: 'cfi1', sourceIndices: [0] },
            { text: 'Sentence 2', cfi: 'cfi2', sourceIndices: [1] },
            { text: 'Sentence 3', cfi: 'cfi3', sourceIndices: [2] },
            { text: 'Sentence 4', cfi: 'cfi4', sourceIndices: [3] },
            { text: 'Sentence 5', cfi: 'cfi5', sourceIndices: [4] },
        ];

        beforeEach(() => {
            manager.setBookId('test-book');
            manager.setQueue([...mockQueue], 0, 0); // Start at 0
            vi.clearAllMocks();
        });

        it('should calculate prefix sums correctly with skipped items', () => {
            // Initially no skips
            // Lengths: 10, 10, 10, 10, 10

            // Skip indices 1 and 2 (Sentence 2 and 3)
            manager.applySkippedMask(new Set([1, 2]));

            // Queue length should remain same
            expect(manager.queue.length).toBe(5);
            expect(manager.queue[1].isSkipped).toBe(true);
            expect(manager.queue[2].isSkipped).toBe(true);
            expect(manager.queue[0].isSkipped).toBe(false);

            // Virtual lengths: 10, 0, 0, 10, 10 → 30 chars / 15 chars/sec = 2 seconds
            expect(manager.getTotalDuration()).toBe(2);
        });

        it('next() should skip over masked items', () => {
            manager.applySkippedMask(new Set([1, 2]));

            // Current index 0. Next should be 3 (Sentence 4).
            manager.next();
            expect(manager.currentIndex).toBe(3);
            expect(manager.getCurrentItem()?.text).toBe('Sentence 4');
        });

        it('prev() should skip over masked items', () => {
            manager.applySkippedMask(new Set([1, 2]));

            // Jump to 4 (Sentence 5)
            manager.jumpTo(4);

            // Prev should be 3 (Sentence 4)
            manager.prev();
            expect(manager.currentIndex).toBe(3);

            // Prev should be 0 (Sentence 1), skipping 2 and 1
            manager.prev();
            expect(manager.currentIndex).toBe(0);
        });

        it('should handle complex merging logic', () => {
            // Create a merged item
            const complexQueue: TTSQueueItem[] = [
                { text: 'A', cfi: 'c1', sourceIndices: [0] },
                { text: 'BC', cfi: 'c2', sourceIndices: [1, 2] }, // Merged
                { text: 'D', cfi: 'c3', sourceIndices: [3] }
            ];

            manager.setQueue(complexQueue, 0, 0);

            // Case 1: Skip only index 1. Item 1 has [1, 2]. NOT ALL skipped. Should NOT skip item.
            manager.applySkippedMask(new Set([1]));
            expect(manager.queue[1].isSkipped ?? false).toBe(false);

            // Case 2: Skip 1 and 2. Item 1 has [1, 2]. ALL skipped. SHOULD skip item.
            manager.applySkippedMask(new Set([1, 2]));
            expect(manager.queue[1].isSkipped).toBe(true);
        });

        it('seekToTime should respect virtual timeline', () => {
            // Lengths: 10 each. Skip 2nd item (index 1).
            manager.applySkippedMask(new Set([1]));

            // Queue: [10, 0(skipped), 10, 10, 10]
            // Chars per second is 15. Seek to 0.8s -> 12 chars -> Item 2 (index 2).
            const changed = manager.seekToTime(0.8);
            expect(changed).toBe(true);
            expect(manager.currentIndex).toBe(2);
        });
    });

    describe('regression: PlaybackStateManager_Adaptation', () => {
        const createItem = (text: string, sourceIndices: number[], isSkipped: boolean = false): TTSQueueItem => ({
            text,
            sourceIndices,
            isSkipped,
            cfi: '',
        });

        beforeEach(() => {
            manager.setBookId('test-book');
            vi.clearAllMocks();
        });

        it('should apply adaptation replacing single item', () => {
            manager.setQueue([
                createItem('Row 1 Col 1', [0]),
                createItem('Row 1 Col 2', [1]),
            ], 0, 0);

            manager.applyTableAdaptations([
                { indices: [0], text: 'Adapted Row 1 Col 1' }
            ]);

            const newQueue = manager.queue;
            expect(newQueue[0].text).toBe('Adapted Row 1 Col 1');
            expect(newQueue[0].isSkipped).toBe(false);
            expect(newQueue[1].text).toBe('Row 1 Col 2');
        });

        it('should apply adaptation merging multiple items', () => {
            manager.setQueue([
                createItem('Header', [0]),
                createItem('Cell 1', [1]),
                createItem('Cell 2', [2]),
                createItem('Footer', [3]),
            ], 0, 0);

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
            manager.setQueue([
                createItem('A', [1]),
                createItem('B', [2]),
                createItem('C', [3]),
                createItem('D', [4]),
            ], 0, 0);

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
            manager.setQueue([createItem('A', [1])], 0, 0);

            manager.applyTableAdaptations([
                { indices: [99], text: 'Ghost' }
            ]);

            expect(manager.queue[0].text).toBe('A');
        });

        it('should not match item if source indices are partially outside adaptation', () => {
            // Adaptation indices: [1]; item indices: [1, 2] → NOT fully contained → no match
            manager.setQueue([createItem('Combined', [1, 2])], 0, 0);

            manager.applyTableAdaptations([
                { indices: [1], text: 'Partial' }
            ]);

            expect(manager.queue[0].text).toBe('Combined');
        });

        it('should match item if source indices are subset of adaptation', () => {
            // Adaptation indices: [1, 2, 3]; item indices: [1, 2] → fully contained → match
            manager.setQueue([createItem('Subset', [1, 2])], 0, 0);

            manager.applyTableAdaptations([
                { indices: [1, 2, 3], text: 'Superset' }
            ]);

            expect(manager.queue[0].text).toBe('Superset');
        });

        it('should unskip item if it becomes the anchor of an adaptation', () => {
            manager.setQueue([createItem('A', [1], true)], 0, 0); // Initially skipped

            manager.applyTableAdaptations([
                { indices: [1], text: 'Revived' }
            ]);

            expect(manager.queue[0].isSkipped).toBe(false);
            expect(manager.queue[0].text).toBe('Revived');
        });

        it('should update prefix sums when adaptation changes text length', () => {
            // Original: "A" (len 1) + "B" (len 1) = 2
            // Adapted: "Longer" (len 6), "B" skipped
            manager.setQueue([
                createItem('A', [1]),
                createItem('B', [2])
            ], 0, 0);

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

            manager.setQueue([createItem('A', [1])], 0, 0);
            listener.mockClear(); // Clear initial setQueue call

            manager.applyTableAdaptations([
                { indices: [1], text: 'B' }
            ]);

            expect(listener).toHaveBeenCalledTimes(1);
        });

        it('should not notify if no changes', () => {
            const listener = vi.fn();
            manager.setQueue([createItem('A', [1])], 0, 0);
            listener.mockClear();
            manager.subscribe(listener);

            manager.applyTableAdaptations([]); // Empty
            expect(listener).not.toHaveBeenCalled();

            manager.applyTableAdaptations([{ indices: [99], text: 'X' }]); // No match
            expect(listener).not.toHaveBeenCalled();
        });

        it('should handle overlapping adaptations prioritizing order', () => {
            // Tests the logic that prevents handled indices from being processed again
            manager.setQueue([
                createItem('A', [1]),
                createItem('B', [2]),
                createItem('C', [3])
            ], 0, 0);

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

            // Second adaptation: B (idx 1) is handled by first; C matches [2, 3].
            expect(newQueue[2].text).toBe('BC');
            expect(newQueue[2].isSkipped).toBe(false);
        });
    });
});
