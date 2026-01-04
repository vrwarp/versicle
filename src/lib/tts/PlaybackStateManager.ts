import type { TTSQueueItem, TTSStatus } from './AudioPlayerService';
import { dbService } from '../../db/DBService';

export type PlaybackStateSnapshot = {
    queue: ReadonlyArray<TTSQueueItem>;
    currentIndex: number;
    currentItem: TTSQueueItem | null;
    currentSectionIndex: number;
};

export type StateChangeListener = (state: PlaybackStateSnapshot) => void;

/**
 * Manages the state of the TTS playback session.
 * Tracks the current queue, current index, section index, and reading progress.
 * Handles state persistence to the database.
 */
export class PlaybackStateManager {
    private _queue: TTSQueueItem[] = [];
    private _currentIndex: number = 0;
    private _currentSectionIndex: number = -1;
    prefixSums: number[] = [0];

    // Track last persisted queue to avoid redundant heavy writes
    private lastPersistedQueue: TTSQueueItem[] | null = null;
    private currentBookId: string | null = null;

    private listeners: StateChangeListener[] = [];

    /**
     * Sets the active book ID and resets state if the book changes.
     *
     * @param {string | null} bookId The ID of the book.
     */
    setBookId(bookId: string | null) {
        if (this.currentBookId !== bookId) {
            this.currentBookId = bookId;
            this.lastPersistedQueue = null;
            if (!bookId) {
                this.reset();
            }
        }
    }

    /**
     * Resets the playback state to its initial values.
     */
    reset() {
        this._queue = [];
        this._currentIndex = 0;
        this._currentSectionIndex = -1;
        this.prefixSums = [0];
        this.lastPersistedQueue = null;
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
        this._queue = items;
        this._currentIndex = startIndex;
        this._currentSectionIndex = sectionIndex;
        this.lastPersistedQueue = null; // Reset persisted tracker since queue changed
        this.calculatePrefixSums();
        this.persistQueue();
        this.notifyListeners();
    }

    /**
     * Applies a mask to mark specific raw indices as skipped.
     * This updates the `isSkipped` flag on queue items and recalculates prefix sums.
     *
     * @param {Set<number>} rawSkippedIndices A set of raw sentence indices to skip.
     * @param {string} sectionId The section ID for validation.
     */
    applySkippedMask(rawSkippedIndices: Set<number>, sectionId?: string) {
        // Validation of sectionId can be added here if needed, currently implicitly handled by caller
        if (sectionId && this.currentSectionIndex === -1) {
             // Optional: validate section ID
        }
        let changed = false;

        // Iterate over the queue and update isSkipped status
        for (let i = 0; i < this._queue.length; i++) {
            const item = this._queue[i];

            // Only skip if ALL source indices are in the skipped set
            let shouldSkip = false;
            if (item.sourceIndices && item.sourceIndices.length > 0) {
                 shouldSkip = item.sourceIndices.every(idx => rawSkippedIndices.has(idx));
            }

            if (item.isSkipped !== shouldSkip) {
                // Clone the item to maintain immutability of the previous state reference
                this._queue[i] = { ...item, isSkipped: shouldSkip };
                changed = true;
            }
        }

        if (changed) {
            this.calculatePrefixSums();
            this.persistQueue();
            this.notifyListeners();
        }
    }

    /**
     * Applies table adaptations using "Swap-and-Skip" logic.
     *
     * @param {Map<string, string>} adaptations Map of root CFI to adapted text.
     */
    applyTableAdaptations(adaptations: Map<string, string>) {
        const handledRoots = new Set<string>();
        let changed = false;

        const newQueue = this._queue.map((item) => {
            if (!item.cfi) return item;

            for (const [rootCfi, text] of adaptations) {
                // Check if segment is a child of the table root
                // We compare the base CFI (without step indirections if possible)
                // But for simplicity, we assume startsWith works if rooted correctly.
                // The rootCfi usually looks like `epubcfi(/6/14[table1])` or `/6/14[table1]`.
                // The item.cfi looks like `/6/14[table1]/2/1`.

                // Clean up CFIs for comparison (remove 'epubcfi(' wrapper if present)
                const cleanRoot = rootCfi.replace(/^epubcfi\((.*)\)$/, '$1');
                const cleanItemCfi = item.cfi.replace(/^epubcfi\((.*)\)$/, '$1');

                // Ensure strict path matching (prevent /2 matching /20)
                const isChild = cleanItemCfi.startsWith(cleanRoot) &&
                    (cleanItemCfi.length === cleanRoot.length ||
                     ['/', '!', '[', ':'].includes(cleanItemCfi[cleanRoot.length]));

                if (isChild) {
                    // Check if it's the anchor (first encountered for this root)
                    if (!handledRoots.has(rootCfi)) {
                        handledRoots.add(rootCfi);
                        // Update only the anchor item with the full natural adaptation
                        // Make sure we unskip it if it was skipped (unless globally skipped?)
                        // But adaptations override raw text.
                        changed = true;
                        return { ...item, text, isSkipped: false };
                    } else {
                        // Mark subsequent cell data as skipped to avoid double-reading
                        if (!item.isSkipped) {
                            changed = true;
                            return { ...item, isSkipped: true };
                        }
                    }
                }
            }
            return item;
        });

        if (changed) {
            this._queue = newQueue;
            this.calculatePrefixSums();
            this.persistQueue();
            this.notifyListeners();
        }
    }

    get queue(): ReadonlyArray<TTSQueueItem> {
        return this._queue;
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

    hasPrev(): boolean {
        return this.getPrevVisibleIndex(this._currentIndex) !== -1;
    }

    next(): boolean {
        const nextIndex = this.getNextVisibleIndex(this._currentIndex);
        if (nextIndex !== -1) {
            this._currentIndex = nextIndex;
            this.persistQueue();
            this.notifyListeners();
            return true;
        }
        return false;
    }

    prev(): boolean {
        const prevIndex = this.getPrevVisibleIndex(this._currentIndex);
        if (prevIndex !== -1) {
            this._currentIndex = prevIndex;
            this.persistQueue();
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
        if (index >= 0 && index < this._queue.length) {
            // Even if we jump to a skipped item (e.g. manually), we allow it?
            // Or should we snap to nearest visible?
            // For now, allow direct jumps, assuming UI handles visibility.
            // But if auto-playing, it might be weird.
            // Let's assume if user clicks it, they want to hear it even if skipped.
            // BUT, for consistency, let's just update index.
            this._currentIndex = index;
            this.persistQueue();
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
            this._currentIndex = newIndex;
            this.persistQueue();
            this.notifyListeners();
            return true;
        }
        return false;
    }

    /**
     * Jumps to the last item in the queue.
     */
    jumpToEnd() {
        if (this._queue.length > 0) {
            this._currentIndex = this._queue.length - 1;
            this.persistQueue();
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

    /**
     * Persists the current queue and playback position to the database.
     * Optimizes writes by checking if the queue structure has changed.
     */
    persistQueue() {
        if (this.currentBookId) {
            // Optimization: If queue has not changed since last persist,
            // only update the position (currentIndex/sectionIndex).
            if (this.lastPersistedQueue === this._queue) {
                dbService.saveTTSPosition(this.currentBookId, this._currentIndex, this._currentSectionIndex);
            } else {
                dbService.saveTTSState(this.currentBookId, this._queue, this._currentIndex, this._currentSectionIndex);
                this.lastPersistedQueue = this._queue;
            }
        }
    }

    /**
     * Updates the persistent playback state (last read CFI, pause time) in the database.
     *
     * @param {TTSStatus} status The current playback status.
     */
    async savePlaybackState(status: TTSStatus) {
        if (!this.currentBookId) return;
        const currentItem = this._queue[this._currentIndex];
        const lastPlayedCfi = (currentItem && currentItem.cfi) ? currentItem.cfi : undefined;
        const isPaused = status === 'paused';
        const lastPauseTime = isPaused ? Date.now() : null;
        try {
            await dbService.updatePlaybackState(this.currentBookId, lastPlayedCfi, lastPauseTime);
        } catch (e) {
            console.warn('Failed to save playback state', e);
        }
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
            currentIndex: this._currentIndex,
            currentItem: this.getCurrentItem(),
            currentSectionIndex: this._currentSectionIndex
        };
        this.listeners.forEach(l => l(snapshot));
    }
}
