/**
 * DragnetGesture — the pause→play "Dragnet" audio-bookmark capture, extracted
 * from AudioPlayerService (Phase 5b decomposition; phase5-tts-strangler.md
 * §5b.1).
 *
 * Owns the pause-gesture timestamp and the capture itself (run INSIDE the
 * sequenced play task, 5b-PR3), plus the invalidation policy:
 *
 *  - SECTION-CHANGE invalidation is INTERNAL since 5b-PR4: the controller
 *    feeds every QueueModel section index through {@link noteSectionIndex},
 *    and a change disarms the gesture. This replaced the external
 *    `clearPauseGesture()` call sites (ReaderView's TOC handler, useTTS's
 *    section-change effect) — the engine API surface lost the method
 *    entirely. Known tradeoff (recorded in the prep doc deviations): the
 *    TOC handler used to clear on navigation INTENT, ahead of WebKit's slow
 *    relocation; engine-internal invalidation fires when the engine's own
 *    section actually changes.
 *  - Explicit navigation (loadSection) still disarms via {@link clear}.
 *
 * P19/P20 pin the behavior across the move.
 */
import type { TTSQueueItem } from '~types/tts';
import type { QueueModel } from '../QueueModel';
import type { AnnotationPort } from './EngineContext';
import type { PlaybackBackend } from './PlaybackBackend';
import { mergeCfiSlow } from '../../../kernel/cfi';
import { flightRecorder } from '../TTSFlightRecorder';
import { createLogger } from '../../logger';

const logger = createLogger('DragnetGesture');

/** A pause older than this is a stop, not a resume gesture. */
const CAPTURE_WINDOW_MS = 5000;

export interface DragnetDeps {
    queue: QueueModel;
    annotations: AnnotationPort;
    backend: () => PlaybackBackend;
    getBookId: () => string | null;
}

export class DragnetGesture {
    private lastUserPauseTimestamp: number | null = null;
    private lastSectionIndex: number | null = null;

    constructor(private readonly deps: DragnetDeps) {}

    /** Arm the gesture — called synchronously when the user pauses. */
    armPause(): void {
        this.lastUserPauseTimestamp = Date.now();
    }

    /** Disarm a pending gesture (navigation, book switch, …). */
    clear(reason: string): void {
        if (this.lastUserPauseTimestamp !== null) {
            flightRecorder.record('APS', 'clearPauseGesture', { reason });
            this.lastUserPauseTimestamp = null;
        }
    }

    /**
     * Feed the engine's current section index (from the QueueModel
     * subscription). A CHANGE between a pause and the next play is deliberate
     * navigation, not a resume gesture — disarm.
     */
    noteSectionIndex(sectionIndex: number): void {
        if (this.lastSectionIndex !== null && sectionIndex !== this.lastSectionIndex) {
            this.clear('section-change');
        }
        this.lastSectionIndex = sectionIndex;
    }

    /**
     * Run the pause→play gesture check INSIDE the sequenced play task: if a
     * pause is armed and younger than the capture window, capture ONE
     * audio-bookmark spanning the previous + current sentence. Always
     * disarms.
     */
    async maybeCapture(): Promise<void> {
        const armedAt = this.lastUserPauseTimestamp;
        this.lastUserPauseTimestamp = null;
        const now = Date.now();
        logger.debug(`Play gesture check. lastUserPauseTimestamp: ${armedAt}, diff: ${armedAt ? now - armedAt : 'N/A'}`);
        if (!armedAt || now - armedAt > CAPTURE_WINDOW_MS) return;

        logger.debug('Triggering Dragnet Capture');
        await this.capture();
    }

    private async capture(): Promise<void> {
        const queue = this.deps.queue.queue;
        const currentIndex = this.deps.queue.currentIndex;
        const bookId = this.deps.getBookId();

        logger.debug(`executeDragnetCapture. currentIndex: ${currentIndex}, queueLength: ${queue.length}, currentBookId: ${bookId}`);

        // Boundary protection: don't cross chapter boundaries backwards
        const startIndex = Math.max(0, currentIndex - 1);
        const targetItems = queue.slice(startIndex, currentIndex + 1);

        logger.debug(`targetItems count: ${targetItems.length}`);

        if (targetItems.length === 0 || !bookId) {
            logger.warn('Dragnet Capture failed: no target items or no bookId');
            this.deps.backend().playEarcon('bookmark_failed');
            return;
        }

        // 1. Concatenate Text
        const mergedText = targetItems.map((item: TTSQueueItem) => item.text).join(' ');

        // 2. Generate Spanning CFI
        let mergedCfi = targetItems[0].cfi;
        if (targetItems.length > 1 && targetItems[0].cfi && targetItems[1].cfi) {
            mergedCfi = mergeCfiSlow(targetItems[0].cfi, targetItems[1].cfi);
        }

        if (!mergedCfi) {
            this.deps.backend().playEarcon('bookmark_failed');
            return;
        }

        // 3. Audio Feedback (Earcon)
        this.deps.backend().playEarcon('bookmark_captured');

        // 4. Dispatch to Yjs Store
        this.deps.annotations.add({
            bookId,
            cfiRange: mergedCfi,
            type: 'audio-bookmark',
            text: mergedText,
            color: '#ff9800' // Default color, won't be strictly used due to custom CSS
        });
    }
}
