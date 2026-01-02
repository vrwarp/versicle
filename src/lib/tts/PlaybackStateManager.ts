import type { TTSQueueItem, TTSStatus } from './AudioPlayerService';
import { dbService } from '../../db/DBService';

/**
 * Manages the state of the TTS playback session.
 * Tracks the current queue, current index, section index, and reading progress.
 * Handles state persistence to the database.
 */
export class PlaybackStateManager {
    queue: TTSQueueItem[] = [];
    currentIndex: number = 0;
    currentSectionIndex: number = -1;
    prefixSums: number[] = [0];

    // Track last persisted queue to avoid redundant heavy writes
    private lastPersistedQueue: TTSQueueItem[] | null = null;
    private currentBookId: string | null = null;

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
        this.queue = [];
        this.currentIndex = 0;
        this.currentSectionIndex = -1;
        this.prefixSums = [0];
        this.lastPersistedQueue = null;
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
        this.queue = items;
        this.currentIndex = startIndex;
        this.currentSectionIndex = sectionIndex;
        this.lastPersistedQueue = null; // Reset persisted tracker since queue changed
        this.calculatePrefixSums();
    }

    /**
     * Calculates cumulative character counts for the queue to support time-based seeking.
     */
    private calculatePrefixSums() {
        this.prefixSums = new Array(this.queue.length + 1).fill(0);
        for (let i = 0; i < this.queue.length; i++) {
            this.prefixSums[i + 1] = this.prefixSums[i] + (this.queue[i].text?.length || 0);
        }
    }

    /**
     * Returns the item currently being played.
     * @returns {TTSQueueItem | null} The current item or null if queue is empty.
     */
    getCurrentItem(): TTSQueueItem | null {
        return this.queue[this.currentIndex] || null;
    }

    hasNext(): boolean {
        return this.currentIndex < this.queue.length - 1;
    }

    hasPrev(): boolean {
        return this.currentIndex > 0;
    }

    next(): boolean {
        if (this.hasNext()) {
            this.currentIndex++;
            return true;
        }
        return false;
    }

    prev(): boolean {
        if (this.hasPrev()) {
            this.currentIndex--;
            return true;
        }
        return false;
    }

    jumpTo(index: number): boolean {
        if (index >= 0 && index < this.queue.length) {
            this.currentIndex = index;
            return true;
        }
        return false;
    }

    /**
     * Estimates the queue index corresponding to a given playback time in seconds.
     *
     * @param {number} time The elapsed time in seconds.
     * @param {number} speed The playback speed factor.
     * @returns {number} The estimated queue index.
     */
    calculateIndexFromTime(time: number, speed: number): number {
        if (!this.queue.length || !this.prefixSums.length) return this.currentIndex;

        const charsPerSecond = this.calculateCharsPerSecond(speed);
        if (charsPerSecond <= 0) return this.currentIndex;

        const targetChars = time * charsPerSecond;

        for (let i = 0; i < this.queue.length; i++) {
            if (targetChars < this.prefixSums[i + 1]) {
                return i;
            }
        }
        return 0; // Fallback
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
        if (!this.queue.length || !this.prefixSums.length) return 0;

        const charsPerSecond = this.calculateCharsPerSecond(speed);
        if (charsPerSecond === 0) return 0;

        const elapsedBeforeCurrent = this.prefixSums[this.currentIndex] / charsPerSecond;
        return elapsedBeforeCurrent + providerTime;
    }

    /**
     * Calculates the total estimated duration of the current queue in seconds.
     *
     * @param {number} speed The playback speed factor.
     * @returns {number} Total duration in seconds.
     */
    getTotalDuration(speed: number): number {
         if (!this.queue.length || !this.prefixSums.length) return 0;
         const charsPerSecond = this.calculateCharsPerSecond(speed);
         if (charsPerSecond === 0) return 0;
         return this.prefixSums[this.queue.length] / charsPerSecond;
    }

    /**
     * Persists the current queue and playback position to the database.
     * Optimizes writes by checking if the queue structure has changed.
     */
    persistQueue() {
        if (this.currentBookId) {
            // Optimization: If queue has not changed since last persist,
            // only update the position (currentIndex/sectionIndex).
            if (this.lastPersistedQueue === this.queue) {
                dbService.saveTTSPosition(this.currentBookId, this.currentIndex, this.currentSectionIndex);
            } else {
                dbService.saveTTSState(this.currentBookId, this.queue, this.currentIndex, this.currentSectionIndex);
                this.lastPersistedQueue = this.queue;
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
        const currentItem = this.queue[this.currentIndex];
        const lastPlayedCfi = (currentItem && currentItem.cfi) ? currentItem.cfi : undefined;
        const isPaused = status === 'paused';
        const lastPauseTime = isPaused ? Date.now() : null;
        try {
            await dbService.updatePlaybackState(this.currentBookId, lastPlayedCfi, lastPauseTime);
        } catch (e) {
            console.warn('Failed to save playback state', e);
        }
    }
}
