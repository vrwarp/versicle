import type { TTSQueueItem } from './AudioPlayerService';
import { dbService } from '../../db/DBService';

export type PlaybackStateListener = (currentIndex: number, queue: TTSQueueItem[]) => void;

export class PlaybackStateManager {
    private queue: TTSQueueItem[] = [];
    private currentIndex: number = 0;
    private currentSectionIndex: number = -1;
    private prefixSums: number[] = [0];
    private listeners: PlaybackStateListener[] = [];

    // Track last persisted queue to avoid redundant heavy writes
    private lastPersistedQueue: TTSQueueItem[] | null = null;

    // Speed tracking is needed for calculations
    private speed: number = 1.0;

    constructor() {}

    getQueue(): TTSQueueItem[] {
        return this.queue;
    }

    getCurrentIndex(): number {
        return this.currentIndex;
    }

    getCurrentSectionIndex(): number {
        return this.currentSectionIndex;
    }

    getCurrentItem(): TTSQueueItem | undefined {
        return this.queue[this.currentIndex];
    }

    hasNext(): boolean {
        return this.currentIndex < this.queue.length - 1;
    }

    hasPrev(): boolean {
        return this.currentIndex > 0;
    }

    setSpeed(speed: number) {
        this.speed = speed;
    }

    setQueue(queue: TTSQueueItem[], startIndex: number = 0, sectionIndex: number) {
        this.queue = queue;
        this.currentIndex = startIndex;
        this.currentSectionIndex = sectionIndex;
        this.lastPersistedQueue = null; // Reset tracker
        this.calculatePrefixSums();
        this.notifyListeners();
    }

    reset() {
        this.queue = [];
        this.currentIndex = 0;
        this.currentSectionIndex = -1;
        this.prefixSums = [0];
        this.lastPersistedQueue = null;
        this.notifyListeners();
    }

    next(): boolean {
        if (this.hasNext()) {
            this.currentIndex++;
            this.notifyListeners();
            return true;
        }
        return false;
    }

    prev(): boolean {
        if (this.hasPrev()) {
            this.currentIndex--;
            this.notifyListeners();
            return true;
        }
        return false;
    }

    jumpTo(index: number): boolean {
        if (index >= 0 && index < this.queue.length) {
            this.currentIndex = index;
            this.notifyListeners();
            return true;
        }
        return false;
    }

    moveToEnd() {
        if (this.queue.length > 0) {
            this.currentIndex = this.queue.length - 1;
            this.notifyListeners();
        }
    }

    private calculatePrefixSums() {
        this.prefixSums = new Array(this.queue.length + 1).fill(0);
        for (let i = 0; i < this.queue.length; i++) {
            this.prefixSums[i + 1] = this.prefixSums[i] + (this.queue[i].text?.length || 0);
        }
    }

    /**
     * Calculates the processing speed in characters per second.
     */
    private calculateCharsPerSecond(): number {
        return (900 * this.speed) / 60;
    }

    calculateTargetIndexForTime(time: number): number {
        if (!this.queue.length || !this.prefixSums.length) return 0;

        const charsPerSecond = this.calculateCharsPerSecond();
        if (charsPerSecond <= 0) return 0;

        const targetChars = time * charsPerSecond;

        let newIndex = 0;
        for (let i = 0; i < this.queue.length; i++) {
            if (targetChars < this.prefixSums[i + 1]) {
                newIndex = i;
                break;
            }
            newIndex = i;
        }
        return newIndex;
    }

    getDuration(): number {
         const charsPerSecond = this.calculateCharsPerSecond();
         if (charsPerSecond === 0 || this.queue.length === 0) return 0;
         const totalChars = this.prefixSums[this.queue.length];
         return totalChars / charsPerSecond;
    }

    getCurrentPosition(providerTime: number): number {
        const charsPerSecond = this.calculateCharsPerSecond();
        if (charsPerSecond === 0) return 0;

        const elapsedBeforeCurrent = this.prefixSums[this.currentIndex] / charsPerSecond;
        return elapsedBeforeCurrent + providerTime;
    }

    persist(bookId: string) {
        if (bookId) {
            if (this.lastPersistedQueue === this.queue) {
                dbService.saveTTSPosition(bookId, this.currentIndex, this.currentSectionIndex).catch(console.error);
            } else {
                dbService.saveTTSState(bookId, this.queue, this.currentIndex, this.currentSectionIndex).catch(console.error);
                this.lastPersistedQueue = this.queue;
            }
        }
    }

    subscribe(listener: PlaybackStateListener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }

    private notifyListeners() {
        this.listeners.forEach(l => l(this.currentIndex, this.queue));
    }
}
