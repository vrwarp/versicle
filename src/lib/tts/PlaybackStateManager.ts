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
     * @param {number} [startIndex=0] The index to start playback from.
     * @param {number} sectionIndex The index of the current section in the book.
     */
    setQueue(items: TTSQueueItem[], startIndex: number = 0, sectionIndex: number) {
        this._queue = items;
        this._currentIndex = startIndex;
        this._currentSectionIndex = sectionIndex;
        this.lastPersistedQueue = null; // Reset persisted tracker since queue changed
        this.calculatePrefixSums();
        this.persistQueue();
        this.notifyListeners();
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
     */
    private calculatePrefixSums() {
        this.prefixSums = new Array(this._queue.length + 1).fill(0);
        for (let i = 0; i < this._queue.length; i++) {
            this.prefixSums[i + 1] = this.prefixSums[i] + (this._queue[i].text?.length || 0);
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
        return this._currentIndex < this._queue.length - 1;
    }

    hasPrev(): boolean {
        return this._currentIndex > 0;
    }

    next(): boolean {
        if (this.hasNext()) {
            this._currentIndex++;
            this.persistQueue();
            this.notifyListeners();
            return true;
        }
        return false;
    }

    prev(): boolean {
        if (this.hasPrev()) {
            this._currentIndex--;
            this.persistQueue();
            this.notifyListeners();
            return true;
        }
        return false;
    }

    jumpTo(index: number): boolean {
        if (index >= 0 && index < this._queue.length) {
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
     * @param {number} speed The playback speed factor.
     * @returns {boolean} True if the index changed.
     */
    seekToTime(time: number, speed: number): boolean {
        if (!this._queue.length || !this.prefixSums.length) return false;

        const charsPerSecond = this.calculateCharsPerSecond(speed);
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
     * Calculates the processing speed in characters per second based on the current playback speed.
     * Assumes a base reading rate of 180 words per minute and 5 characters per word.
     * @param {number} speed The playback speed factor.
     * @returns {number} Characters per second.
     */
    calculateCharsPerSecond(speed: number): number {
        // Base WPM = 180. Avg chars per word = 5. -> Chars per minute = 900.
        // charsPerSecond = (900 * speed) / 60
        return (900 * speed) / 60;
    }

    /**
     * Calculates the current playback position in seconds relative to the start of the section.
     *
     * @param {number} providerTime The time reported by the TTS provider for the current utterance.
     * @param {number} speed The playback speed factor.
     * @returns {number} The total elapsed time in seconds for the section.
     */
    getCurrentPosition(providerTime: number, speed: number): number {
        if (!this._queue.length || !this.prefixSums.length) return 0;

        const charsPerSecond = this.calculateCharsPerSecond(speed);
        if (charsPerSecond === 0) return 0;

        const elapsedBeforeCurrent = this.prefixSums[this._currentIndex] / charsPerSecond;
        return elapsedBeforeCurrent + providerTime;
    }

    /**
     * Calculates the total estimated duration of the current queue in seconds.
     *
     * @param {number} speed The playback speed factor.
     * @returns {number} Total duration in seconds.
     */
    getTotalDuration(speed: number): number {
         if (!this._queue.length || !this.prefixSums.length) return 0;
         const charsPerSecond = this.calculateCharsPerSecond(speed);
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
