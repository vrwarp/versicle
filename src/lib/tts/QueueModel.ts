import type { TTSQueueItem } from '~types/tts';
import { flightRecorder } from './TTSFlightRecorder';


type PlaybackStateSnapshot = {
    queue: ReadonlyArray<TTSQueueItem>;
    /** Changes iff the queue's content identity changed (feeds PlaybackSnapshot.queueId). */
    queueId: string;
    currentIndex: number;
    currentItem: TTSQueueItem | null;
    currentSectionIndex: number;
};

export type StateChangeListener = (state: PlaybackStateSnapshot) => void;

let nextQueueId = 0;

/**
 * QueueModel — the IMMUTABLE queue/position model of the TTS playback session
 * (Phase 5b-PR2; the renamed PlaybackStateManager).
 *
 * Copy-on-write: every mutation replaces `_queue` with a fresh array (frozen in
 * DEV) and stamps a new `queueId` when the queue's CONTENT identity changed —
 * a published queue array is never mutated afterwards, so consumers (the
 * snapshot channel, the store mirror, persistence) can rely on reference
 * identity. The in-place `applySkippedMask` mutation (the S4 debt and the P14
 * parity rider) died here. Persistence dedupe is keyed on `queueId`, not on
 * array reference (the reference check was defeated by exactly that in-place
 * mutation).
 *
 * Also tracks the current index, section index, and reading progress. The
 * model is PURE since 5b-PR4: persistence moved behind the SessionStore port
 * (EngineContext), driven by the PlaybackController's subscription keyed on
 * `queueId` — the QueueModel no longer touches storage at all.
 */
export class QueueModel {
    private _queue: ReadonlyArray<TTSQueueItem> = QueueModel.seal([]);
    private _queueId: string = QueueModel.newQueueId();
    private _currentIndex: number = 0;
    private _currentSectionIndex: number = -1;
    prefixSums: number[] = [0];

    private listeners: StateChangeListener[] = [];

    /**
     * DEV-only mutation tripwire (Phase 5b-PR3, the C4 dev-assert): the engine
     * installs a guard that throws unless a sequenced task is currently
     * running, making "only sequenced tasks mutate the queue" a crashing
     * invariant in dev/test instead of a convention. No-op when unset
     * (standalone QueueModel unit tests drive the model directly).
     */
    private mutationGuard: ((op: string) => void) | null = null;

    setMutationGuard(guard: ((op: string) => void) | null): void {
        this.mutationGuard = guard;
    }

    private assertMutable(op: string): void {
        this.mutationGuard?.(op);
    }

    /** Freeze in DEV/test so any in-place mutation attempt throws loudly. */
    private static seal(items: TTSQueueItem[]): ReadonlyArray<TTSQueueItem> {
        return import.meta.env.DEV ? Object.freeze(items) : items;
    }

    private static newQueueId(): string {
        return `q${++nextQueueId}`;
    }

    /** Replace the queue array (copy-on-write) and stamp a fresh content identity. */
    private replaceQueue(items: TTSQueueItem[]) {
        this._queue = QueueModel.seal(items);
        this._queueId = QueueModel.newQueueId();
    }

    /**
     * Resets the playback state to its initial values.
     */
    reset() {
        this.assertMutable('reset');
        flightRecorder.record('PSM', 'reset');
        this.replaceQueue([]);
        this._currentIndex = 0;
        this._currentSectionIndex = -1;
        this.prefixSums = [0];
        this.notifyListeners();
    }

    /**
     * Updates the playback queue and current position indices.
     * Recalculates prefix sums for progress tracking.
     *
     * @param {TTSQueueItem[]} items The new queue items.
     * @param {number} startIndex The index to start playback from.
     * @param {number} sectionIndex The index of the current section in the book.
     */
    setQueue(items: TTSQueueItem[], startIndex: number, sectionIndex: number) {
        this.assertMutable('setQueue');
        flightRecorder.record('PSM', 'setQueue', {
            len: items.length,
            startIndex,
            sectionIndex,
            prevLen: this._queue.length,
            prevIndex: this._currentIndex
        });
        // Copy-on-write: never adopt the caller's array (it could be mutated later).
        this.replaceQueue([...items]);
        this._currentIndex = startIndex;
        this._currentSectionIndex = sectionIndex;
        this.calculatePrefixSums();
        this.notifyListeners();
    }

    /**
     * Applies a mask to mark specific raw indices as skipped.
     * Copy-on-write: produces a NEW queue array with `isSkipped` recomputed; the
     * previously published array is untouched (the P14 identity guarantee).
     *
     * @param {Set<number>} rawSkippedIndices A set of raw sentence indices to skip.
     * @param {string} sectionId The section ID for validation.
     */
    applySkippedMask(rawSkippedIndices: Set<number>, sectionId?: string) {
        this.assertMutable('applySkippedMask');
        let changed = false;

        const newQueue = this._queue.map((item) => {
            // Only skip if ALL source indices are in the skipped set
            let shouldSkip = false;
            if (item.sourceIndices && item.sourceIndices.length > 0) {
                shouldSkip = item.sourceIndices.every(idx => rawSkippedIndices.has(idx));
            }

            // NOTE comparison is deliberately strict (no ?? normalization): an item
            // with isSkipped UNDEFINED is normalized to an explicit false on the first
            // mask application — the legacy behavior consumers/persistence pin.
            if (item.isSkipped !== shouldSkip) {
                changed = true;
                return { ...item, isSkipped: shouldSkip };
            }
            return item;
        });

        if (changed) {
            flightRecorder.record('PSM', 'applySkippedMask', {
                count: rawSkippedIndices.size,
                sectionId
            });
            this.replaceQueue(newQueue);
            this.calculatePrefixSums();
            this.notifyListeners();
        }
    }

    /**
     * Applies table adaptations using strict index matching.
     * 1. Finds all queue items whose source indices are fully contained in the adaptation's covered indices.
     * 2. Replaces the text of the *first* matching item with the adaptation.
     * 3. Marks all *other* matching items as skipped.
     *
     * Copy-on-write like every other mutation here.
     *
     * @param {Array<{ indices: number[], text: string }>} adaptations List of adaptations.
     */
    applyTableAdaptations(adaptations: { indices: number[], text: string }[]) {
        this.assertMutable('applyTableAdaptations');
        let changed = false;

        // Clone queue to avoid mutation
        const newQueue = [...this._queue];
        // Set of queue indices we have already handled to avoid overlaps
        const handledQueueIndices = new Set<number>();

        for (const adaptation of adaptations) {
            const adaptIndicesSet = new Set(adaptation.indices);
            const matchingQueueIndices: number[] = [];

            // Find all queue items that belong to this adaptation
            for (let i = 0; i < newQueue.length; i++) {
                if (handledQueueIndices.has(i)) continue;

                const item = newQueue[i];
                if (item.sourceIndices && item.sourceIndices.length > 0) {
                    // Check if all source indices of this item are in the adaptation's set
                    const isMatch = item.sourceIndices.every(idx => adaptIndicesSet.has(idx));
                    if (isMatch) {
                        matchingQueueIndices.push(i);
                    }
                }
            }

            if (matchingQueueIndices.length > 0) {
                // Mark these as handled
                matchingQueueIndices.forEach(idx => handledQueueIndices.add(idx));

                // 1. Update the first item (Anchor)
                const firstIdx = matchingQueueIndices[0];
                if (newQueue[firstIdx].text !== adaptation.text || newQueue[firstIdx].isSkipped) {
                    newQueue[firstIdx] = {
                        ...newQueue[firstIdx],
                        text: adaptation.text,
                        isSkipped: false
                    };
                    changed = true;
                }

                // 2. Mark others as skipped
                for (let k = 1; k < matchingQueueIndices.length; k++) {
                    const idx = matchingQueueIndices[k];
                    if (!newQueue[idx].isSkipped) {
                        newQueue[idx] = { ...newQueue[idx], isSkipped: true };
                        changed = true;
                    }
                }
            }
        }

        if (changed) {
            flightRecorder.record('PSM', 'applyTableAdaptations', {
                count: adaptations.length
            });
            this.replaceQueue(newQueue);
            this.calculatePrefixSums();
            this.notifyListeners();
        }
    }

    get queue(): ReadonlyArray<TTSQueueItem> {
        return this._queue;
    }

    /** Content identity of the current queue — new value per queue change. */
    get queueId(): string {
        return this._queueId;
    }

    get currentIndex(): number {
        return this._currentIndex;
    }

    get currentSectionIndex(): number {
        return this._currentSectionIndex;
    }

    /**
     * Calculates cumulative character counts for the queue to support time-based seeking.
     * Skips items marked as `isSkipped`.
     */
    private calculatePrefixSums() {
        this.prefixSums = new Array(this._queue.length + 1).fill(0);
        for (let i = 0; i < this._queue.length; i++) {
            const length = this._queue[i].isSkipped ? 0 : (this._queue[i].text?.length || 0);
            this.prefixSums[i + 1] = this.prefixSums[i] + length;
        }
    }

    /**
     * Returns the item currently being played.
     * @returns {TTSQueueItem | null} The current item or null if queue is empty.
     */
    getCurrentItem(): TTSQueueItem | null {
        return this._queue[this._currentIndex] || null;
    }

    hasNext(): boolean {
        return this.getNextVisibleIndex(this._currentIndex) !== -1;
    }

    /**
     * Returns diagnostic information about the skip state of the queue.
     * Used by the flight recorder to capture queue state during anomalies.
     * This is NOT on the hot path — only called during anomaly detection.
     */
    getSkipDiagnostics(aroundIndex: number): {
        skippedCount: number;
        firstSkippedIndex: number;
        lastSkippedIndex: number;
        sample: { idx: number; isSkipped: boolean | undefined; textLen: number }[];
    } {
        let skippedCount = 0;
        let firstSkippedIndex = -1;
        let lastSkippedIndex = -1;

        for (let i = 0; i < this._queue.length; i++) {
            if (this._queue[i]?.isSkipped) {
                skippedCount++;
                if (firstSkippedIndex === -1) firstSkippedIndex = i;
                lastSkippedIndex = i;
            }
        }

        // Sample 5 items around the given index (the boundary)
        const sample: { idx: number; isSkipped: boolean | undefined; textLen: number }[] = [];
        for (let i = Math.max(0, aroundIndex - 1); i < Math.min(this._queue.length, aroundIndex + 5); i++) {
            const item = this._queue[i];
            sample.push({
                idx: i,
                isSkipped: item?.isSkipped,
                textLen: item?.text?.length ?? -1,
            });
        }

        return { skippedCount, firstSkippedIndex, lastSkippedIndex, sample };
    }

    hasPrev(): boolean {
        return this.getPrevVisibleIndex(this._currentIndex) !== -1;
    }

    next(): boolean {
        this.assertMutable('next');
        const nextIndex = this.getNextVisibleIndex(this._currentIndex);
        if (nextIndex !== -1) {
            flightRecorder.record('PSM', 'next', { from: this._currentIndex, to: nextIndex });
            this._currentIndex = nextIndex;
            this.notifyListeners();
            return true;
        }
        return false;
    }

    prev(): boolean {
        this.assertMutable('prev');
        const prevIndex = this.getPrevVisibleIndex(this._currentIndex);
        if (prevIndex !== -1) {
            flightRecorder.record('PSM', 'prev', { from: this._currentIndex, to: prevIndex });
            this._currentIndex = prevIndex;
            this.notifyListeners();
            return true;
        }
        return false;
    }

    /**
     * Scans forward to find the next visible (non-skipped) index.
     */
    private getNextVisibleIndex(startIndex: number): number {
        for (let i = startIndex + 1; i < this._queue.length; i++) {
            if (!this._queue[i].isSkipped) {
                return i;
            }
        }
        return -1;
    }

    /**
     * Scans backward to find the previous visible (non-skipped) index.
     */
    private getPrevVisibleIndex(startIndex: number): number {
        for (let i = startIndex - 1; i >= 0; i--) {
            if (!this._queue[i].isSkipped) {
                return i;
            }
        }
        return -1;
    }

    jumpTo(index: number): boolean {
        this.assertMutable('jumpTo');
        if (index >= 0 && index < this._queue.length) {
            flightRecorder.record('PSM', 'jumpTo', { from: this._currentIndex, to: index });
            this._currentIndex = index;
            this.notifyListeners();
            return true;
        }
        return false;
    }

    /**
     * Seeks to a specific time in the current section.
     * Updates the current index and persists the state.
     *
     * @param {number} time The elapsed time in seconds.
     * @returns {boolean} True if the index changed.
     */
    seekToTime(time: number): boolean {
        this.assertMutable('seekToTime');
        if (!this._queue.length || !this.prefixSums.length) return false;

        const charsPerSecond = this.calculateCharsPerSecond();
        const targetChars = time * (charsPerSecond > 0 ? charsPerSecond : 0);
        let newIndex = 0;

        if (charsPerSecond > 0) {
            for (let i = 0; i < this._queue.length; i++) {
                if (targetChars < this.prefixSums[i + 1]) {
                    newIndex = i;
                    break;
                }
            }
        }

        if (newIndex !== this._currentIndex) {
            flightRecorder.record('PSM', 'seekToTime', { time, from: this._currentIndex, to: newIndex });
            this._currentIndex = newIndex;
            this.notifyListeners();
            return true;
        }
        return false;
    }

    /**
     * Jumps to the last item in the queue.
     */
    jumpToEnd() {
        this.assertMutable('jumpToEnd');
        if (this._queue.length > 0) {
            const last = this._queue.length - 1;
            flightRecorder.record('PSM', 'jumpToEnd', { from: this._currentIndex, to: last });
            this._currentIndex = last;
            this.notifyListeners();
        }
    }

    /**
     * Checks if the provided queue is identical to the current one.
     */
    isIdenticalTo(items: TTSQueueItem[]): boolean {
        if (this._queue.length !== items.length) return false;
        for (let i = 0; i < this._queue.length; i++) {
            if (this._queue[i].text !== items[i].text) return false;
            if (this._queue[i].cfi !== items[i].cfi) return false;
        }
        return true;
    }

    /**
     * Calculates the processing speed in characters per second.
     * Assumes a base reading rate of 180 words per minute and 5 characters per word.
     * @returns {number} Characters per second (fixed at 15 for base 1x speed).
     */
    calculateCharsPerSecond(): number {
        // Base WPM = 180. Avg chars per word = 5. -> Chars per minute = 900.
        // charsPerSecond = 900 / 60 = 15
        return 15;
    }

    /**
     * Calculates the current playback position in seconds relative to the start of the section.
     *
     * @param {number} providerTime The time reported by the TTS provider for the current utterance.
     * @returns {number} The total elapsed time in seconds for the section.
     */
    getCurrentPosition(providerTime: number): number {
        if (!this._queue.length || !this.prefixSums.length) return 0;

        const charsPerSecond = this.calculateCharsPerSecond();
        if (charsPerSecond === 0) return 0;

        const elapsedBeforeCurrent = this.prefixSums[this._currentIndex] / charsPerSecond;
        return elapsedBeforeCurrent + providerTime;
    }

    /**
     * Calculates the total estimated duration of the current queue in seconds.
     *
     * @returns {number} Total duration in seconds.
     */
    getTotalDuration(): number {
        if (!this._queue.length || !this.prefixSums.length) return 0;
        const charsPerSecond = this.calculateCharsPerSecond();
        if (charsPerSecond === 0) return 0;
        return this.prefixSums[this._queue.length] / charsPerSecond;
    }

    subscribe(listener: StateChangeListener): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notifyListeners() {
        const snapshot: PlaybackStateSnapshot = {
            queue: this._queue,
            queueId: this._queueId,
            currentIndex: this._currentIndex,
            currentItem: this.getCurrentItem(),
            currentSectionIndex: this._currentSectionIndex
        };
        this.listeners.forEach(l => l(snapshot));
    }
}
