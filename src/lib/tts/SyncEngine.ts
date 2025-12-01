
/**
 * Represents the alignment data for a specific point in time.
 */
export interface AlignmentData {
  /** Start time in seconds for this segment. */
  time: number;
  /** The type of segment ('word' or 'sentence'). */
  type: 'word' | 'sentence';
  /** Character offset in the original text (optional). */
  textOffset?: number;
  /** The text content of the word or sentence (optional). */
  value?: string;
}

/**
 * Manages the synchronization between audio playback time and text highlighting.
 * Efficiently determines which text segment corresponds to the current playback time.
 */
export class SyncEngine {
  private alignment: AlignmentData[] = [];
  private onHighlightCallback: ((index: number, length?: number) => void) | null = null;
  private currentIdx: number = -1;

  constructor() {}

  /**
   * Loads the alignment data for the current audio track.
   *
   * @param alignment - An array of AlignmentData objects.
   */
  public loadAlignment(alignment: AlignmentData[]) {
    this.alignment = alignment.sort((a, b) => a.time - b.time);
    this.currentIdx = -1;
  }

  /**
   * Updates the current playback time and triggers highlight callbacks if necessary.
   *
   * @param currentTime - The current playback time in seconds.
   */
  public updateTime(currentTime: number) {
    if (this.alignment.length === 0) return;

    // Find the last item where time <= currentTime
    let activeIdx = -1;

    // Optimization: start searching from currentIdx
    // Usually time moves forward
    const startSearch = this.currentIdx >= 0 ? this.currentIdx : 0;

    for (let i = startSearch; i < this.alignment.length; i++) {
        if (this.alignment[i].time <= currentTime) {
            activeIdx = i;
        } else {
            // Since array is sorted, we can break early once we find a future time
            break;
        }
    }

    // If we wrapped around or seeked backwards, we might need to search from 0
    if (activeIdx === -1 && startSearch > 0) {
        for (let i = 0; i < startSearch; i++) {
             if (this.alignment[i].time <= currentTime) {
                activeIdx = i;
            } else {
                break;
            }
        }
    }

    if (activeIdx !== -1 && activeIdx !== this.currentIdx) {
      this.currentIdx = activeIdx;
      this.emitHighlight(this.alignment[activeIdx]);
    }
  }

  /**
   * Sets the callback to be invoked when a new segment should be highlighted.
   *
   * @param callback - Function receiving the character index and optional length.
   */
  public setOnHighlight(callback: (index: number, length?: number) => void) {
    this.onHighlightCallback = callback;
  }

  /**
   * Triggers the highlight callback for a specific alignment segment.
   *
   * @param data - The active AlignmentData segment.
   */
  private emitHighlight(data: AlignmentData) {
    if (this.onHighlightCallback) {
        // We assume textOffset is available or we pass just index if that's what we have
        // The consumer of this callback needs to know how to map this back to DOM/CFI
        if (data.textOffset !== undefined) {
            this.onHighlightCallback(data.textOffset);
        } else {
            // Fallback or alternative strategy needed if textOffset isn't there
            // For now, let's assume textOffset is the key
            console.warn("SyncEngine: Alignment data missing textOffset");
        }
    }
  }
}
