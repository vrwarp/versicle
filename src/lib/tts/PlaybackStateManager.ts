import type { TTSQueueItem, TTSStatus } from './AudioPlayerService';
import { dbService } from '../../db/DBService';

export class PlaybackStateManager {
    queue: TTSQueueItem[] = [];
    currentIndex: number = 0;
    currentSectionIndex: number = -1;
    prefixSums: number[] = [0];

    // Track last persisted queue to avoid redundant heavy writes
    private lastPersistedQueue: TTSQueueItem[] | null = null;
    private currentBookId: string | null = null;

    setBookId(bookId: string | null) {
        if (this.currentBookId !== bookId) {
            this.currentBookId = bookId;
            this.lastPersistedQueue = null;
            if (!bookId) {
                this.reset();
            }
        }
    }

    reset() {
        this.queue = [];
        this.currentIndex = 0;
        this.currentSectionIndex = -1;
        this.prefixSums = [0];
        this.lastPersistedQueue = null;
    }

    setQueue(items: TTSQueueItem[], startIndex: number = 0, sectionIndex: number) {
        this.queue = items;
        this.currentIndex = startIndex;
        this.currentSectionIndex = sectionIndex;
        this.lastPersistedQueue = null; // Reset persisted tracker since queue changed
        this.calculatePrefixSums();
    }

    private calculatePrefixSums() {
        this.prefixSums = new Array(this.queue.length + 1).fill(0);
        for (let i = 0; i < this.queue.length; i++) {
            this.prefixSums[i + 1] = this.prefixSums[i] + (this.queue[i].text?.length || 0);
        }
    }

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
     * @returns {number} Characters per second.
     */
    calculateCharsPerSecond(speed: number): number {
        // Base WPM = 180. Avg chars per word = 5. -> Chars per minute = 900.
        // charsPerSecond = (900 * speed) / 60
        return (900 * speed) / 60;
    }

    getCurrentPosition(providerTime: number, speed: number): number {
        if (!this.queue.length || !this.prefixSums.length) return 0;

        const charsPerSecond = this.calculateCharsPerSecond(speed);
        if (charsPerSecond === 0) return 0;

        const elapsedBeforeCurrent = this.prefixSums[this.currentIndex] / charsPerSecond;
        return elapsedBeforeCurrent + providerTime;
    }

    getTotalDuration(speed: number): number {
         if (!this.queue.length || !this.prefixSums.length) return 0;
         const charsPerSecond = this.calculateCharsPerSecond(speed);
         if (charsPerSecond === 0) return 0;
         return this.prefixSums[this.queue.length] / charsPerSecond;
    }

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
