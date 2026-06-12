/**
 * MediaMetadataPublisher — lock-screen/media-session metadata + position
 * state, extracted from AudioPlayerService (Phase 5b decomposition;
 * phase5-tts-strangler.md §5b.1).
 *
 * Absorbs the two NEAR-IDENTICAL metadata builders the legacy engine carried
 * (`engageBackgroundMode` and `updateMediaSessionMetadata` — now ONE
 * {@link buildMetadata}), the book-wide progress calculation, and the
 * per-timeupdate position push — which gains the S19 deadband: positions are
 * pushed only when they moved by ≥ {@link POSITION_DEADBAND_S} seconds (or
 * the duration/rate changed, or a metadata refresh forces it), instead of on
 * every provider timeupdate.
 *
 * The Bluetooth metadata-deadband keeper stays in PlatformIntegration — this
 * unit feeds it, it does not replace it.
 */
import type { TTSQueueItem } from '~types/tts';
import type { SectionMetadata, PerceptualPalette } from '~types/db';
import type { MediaPlatform } from '../PlatformIntegration';
import type { QueueModel } from '../QueueModel';
import { createLogger } from '../../logger';

const logger = createLogger('MediaMetadataPublisher');

/** Positions closer than this (seconds) to the last push are dropped (S19). */
export const POSITION_DEADBAND_S = 1.0;

export interface BookPresentation {
    title: string;
    author: string;
    coverUrl: string | undefined;
    palette: number[] | undefined;
    perceptualPalette: PerceptualPalette | undefined;
}

export interface MetadataSource {
    queue: QueueModel;
    getPlaylist(): SectionMetadata[];
    getBook(): BookPresentation;
    getSpeed(): number;
}

export class MediaMetadataPublisher {
    private lastPushedPosition: number | null = null;
    private lastPushedDuration: number | null = null;
    private lastPushedRate: number | null = null;

    constructor(
        private readonly platform: MediaPlatform,
        private readonly source: MetadataSource,
    ) {}

    /** The single metadata builder (the legacy duplicated pair, unified). */
    private buildMetadata(item: TTSQueueItem) {
        const book = this.source.getBook();
        return {
            title: item.title || 'Chapter Text',
            artist: book.author || 'Versicle',
            album: book.title || '',
            artwork: book.coverUrl ? [{ src: book.coverUrl }] : [],
            coverPalette: book.palette,
            perceptualPalette: book.perceptualPalette,
            sectionIndex: this.source.queue.currentSectionIndex,
            totalSections: this.source.getPlaylist().length,
            progress: this.calculateBookProgress(),
        };
    }

    /**
     * Engage background playback for an item: push its metadata and flip the
     * platform playback state to 'playing'. Returns whether engagement
     * succeeded (the Android can-not-play-in-background path).
     */
    engageBackgroundMode(item: TTSQueueItem): boolean {
        try {
            this.platform.updateMetadata(this.buildMetadata(item));
            this.platform.updatePlaybackState('playing');
            return true;
        } catch (e) {
            logger.error('Background engagement failed', e);
            return false;
        }
    }

    /** Refresh metadata for the current item (no-op when the queue is empty). */
    updateMediaSessionMetadata(): void {
        const item = this.source.queue.getCurrentItem();
        if (item) {
            this.platform.updateMetadata(this.buildMetadata(item));
            this.updatePosition(0, { force: true });
        }
    }

    /**
     * Push the position state derived from the provider's playback time.
     * Deadbanded (S19): per-timeupdate pushes that moved less than
     * {@link POSITION_DEADBAND_S} with unchanged duration/rate are dropped.
     */
    updatePosition(providerTime: number, opts: { force?: boolean } = {}): void {
        const queue = this.source.queue;
        const position = queue.getCurrentPosition(providerTime);
        const duration = queue.getTotalDuration();
        const safeDuration = Math.max(duration, position);
        const rate = this.source.getSpeed();

        if (!opts.force
            && this.lastPushedPosition !== null
            && Math.abs(position - this.lastPushedPosition) < POSITION_DEADBAND_S
            && this.lastPushedDuration === safeDuration
            && this.lastPushedRate === rate) {
            return;
        }
        this.lastPushedPosition = position;
        this.lastPushedDuration = safeDuration;
        this.lastPushedRate = rate;

        this.platform.setPositionState({
            duration: safeDuration,
            playbackRate: rate,
            position,
        });
    }

    /**
     * Book-wide progress in [0,1]: characters of all completed sections plus
     * the prefix-sum consumed inside the current one, over the book total.
     */
    calculateBookProgress(): number {
        const playlist = this.source.getPlaylist();
        const queue = this.source.queue;
        if (playlist.length === 0) return 0;

        let totalChars = 0;
        let completedChars = 0;

        for (let i = 0; i < playlist.length; i++) {
            const section = playlist[i];
            totalChars += section.characterCount || 0;

            if (i < queue.currentSectionIndex) {
                completedChars += section.characterCount || 0;
            } else if (i === queue.currentSectionIndex) {
                // Add characters consumed within the current section.
                // prefixSums[index] gives cumulative chars before index in the current queue.
                if (queue.prefixSums && queue.currentIndex >= 0) {
                    completedChars += queue.prefixSums[queue.currentIndex];
                }
            }
        }

        if (totalChars === 0) return 0;
        return Math.min(Math.max(completedChars / totalChars, 0), 1);
    }
}
