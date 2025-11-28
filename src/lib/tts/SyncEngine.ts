
export interface AlignmentData {
  time: number; // Start time in seconds
  type: 'word' | 'sentence';
  textOffset?: number; // Character offset in the original text (optional)
  value?: string; // The word or sentence text
}

export class SyncEngine {
  private alignment: AlignmentData[] = [];
  private onHighlightCallback: ((index: number, length?: number) => void) | null = null;
  private currentIdx: number = -1;

  constructor() {}

  public loadAlignment(alignment: AlignmentData[]) {
    this.alignment = alignment.sort((a, b) => a.time - b.time);
    this.currentIdx = -1;
  }

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

  public setOnHighlight(callback: (index: number, length?: number) => void) {
    this.onHighlightCallback = callback;
  }

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
