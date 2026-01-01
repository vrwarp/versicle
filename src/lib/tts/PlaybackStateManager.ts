import type { TTSQueueItem } from './AudioPlayerService';
import { dbService } from '../../db/DBService';

export class PlaybackStateManager {
  private queue: TTSQueueItem[] = [];
  private currentIndex: number = 0;
  private currentSectionIndex: number = -1;
  private prefixSums: number[] = [0];

  // Track last persisted queue to avoid redundant heavy writes
  private lastPersistedQueue: TTSQueueItem[] | null = null;

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getCurrentSectionIndex(): number {
    return this.currentSectionIndex;
  }

  getQueue(): TTSQueueItem[] {
    return this.queue;
  }

  getCurrentItem(): TTSQueueItem | undefined {
    return this.queue[this.currentIndex];
  }

  setCurrentIndex(index: number) {
    this.currentIndex = index;
  }

  setQueue(queue: TTSQueueItem[], startIndex: number = 0, sectionIndex: number) {
    this.queue = queue;
    this.currentIndex = startIndex;
    this.currentSectionIndex = sectionIndex;
    this.lastPersistedQueue = null; // Reset persistence tracker
    this.calculatePrefixSums();
  }

  private calculatePrefixSums() {
      this.prefixSums = new Array(this.queue.length + 1).fill(0);
      for (let i = 0; i < this.queue.length; i++) {
          this.prefixSums[i + 1] = this.prefixSums[i] + (this.queue[i].text?.length || 0);
      }
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

  calculateCurrentPosition(charsPerSecond: number, providerTime: number): number {
      if (!this.queue.length || !this.prefixSums.length) return 0;
      if (charsPerSecond === 0) return 0;

      const elapsedBeforeCurrent = this.prefixSums[this.currentIndex] / charsPerSecond;
      return elapsedBeforeCurrent + providerTime;
  }

  calculateTotalDuration(charsPerSecond: number): number {
      if (!this.queue.length || !this.prefixSums.length) return 0;
      if (charsPerSecond === 0) return 0;
      const totalChars = this.prefixSums[this.queue.length];
      return totalChars / charsPerSecond;
  }

  /**
   * Calculates the target index for a seek time (in seconds).
   * @param time Target time in seconds.
   * @param charsPerSecond Reading speed.
   * @returns The new index.
   */
  calculateIndexForTime(time: number, charsPerSecond: number): number {
      if (!this.queue.length || !this.prefixSums.length) return 0;
      if (charsPerSecond <= 0) return 0;

      const targetChars = time * charsPerSecond;

      for (let i = 0; i < this.queue.length; i++) {
          if (targetChars < this.prefixSums[i + 1]) {
              return i;
          }
      }
      return Math.max(0, this.queue.length - 1);
  }

  persistQueue(bookId: string) {
      if (bookId) {
          // Optimization: If queue has not changed since last persist,
          // only update the position (currentIndex/sectionIndex).
          if (this.lastPersistedQueue === this.queue) {
              dbService.saveTTSPosition(bookId, this.currentIndex, this.currentSectionIndex);
          } else {
              dbService.saveTTSState(bookId, this.queue, this.currentIndex, this.currentSectionIndex);
              this.lastPersistedQueue = this.queue;
          }
      }
  }

  async restoreQueue(bookId: string): Promise<boolean> {
      try {
          const state = await dbService.getTTSState(bookId);

          if (state && state.queue && state.queue.length > 0) {
              this.queue = state.queue;
              this.currentIndex = state.currentIndex || 0;
              this.currentSectionIndex = state.sectionIndex ?? -1;

              // Track restored queue as persisted
              this.lastPersistedQueue = this.queue;
              this.calculatePrefixSums();
              return true;
          }
      } catch (e) {
          console.error("Failed to restore TTS queue", e);
      }
      return false;
  }
}
