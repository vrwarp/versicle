/**
 * MediaMetadataPublisher unit suite (Phase 5b decomposition) — fake-driven,
 * ZERO vi.mock. Carries the named regression block for the deleted
 * AudioPlayerService_MediaSession.test.ts (absorption ledger row 11; the
 * handler-registration half lives in PlaybackController.test.ts, which pins
 * that the controller wires all seven platform callbacks incl. seekTo) and
 * the calculateBookProgress cases from the deleted AudioPlayerService.test.ts.
 */
import { describe, it, expect, vi } from 'vitest';
import { MediaMetadataPublisher, POSITION_DEADBAND_S } from './MediaMetadataPublisher';
import { QueueModel } from '../QueueModel';
import type { MediaPlatform } from '../PlatformIntegration';
import type { SectionMetadata } from '~types/book';

function makePublisher(opts: { playlist?: SectionMetadata[]; speed?: number } = {}) {
    const platform = {
        updateMetadata: vi.fn(),
        updatePlaybackState: vi.fn(),
        setPositionState: vi.fn(),
        setBackgroundAudioMode: vi.fn(),
        getBackgroundAudioMode: vi.fn(() => 'off' as const),
        setBackgroundVolume: vi.fn(),
        stop: vi.fn().mockResolvedValue(undefined),
    } as unknown as MediaPlatform & {
        updateMetadata: ReturnType<typeof vi.fn>;
        updatePlaybackState: ReturnType<typeof vi.fn>;
        setPositionState: ReturnType<typeof vi.fn>;
    };
    const queue = new QueueModel();
    let speed = opts.speed ?? 1.0;
    const publisher = new MediaMetadataPublisher(platform, {
        queue,
        getPlaylist: () => opts.playlist ?? [],
        getBook: () => ({
            title: 'Test Book',
            author: 'Test Author',
            coverUrl: 'http://example.com/cover.jpg',
            palette: undefined,
            perceptualPalette: undefined,
        }),
        getSpeed: () => speed,
    });
    return { publisher, platform, queue, setSpeed: (s: number) => { speed = s; } };
}

describe('MediaMetadataPublisher', () => {
    describe('regression: AudioPlayerService_MediaSession', () => {
        it('pushes position state with duration + playbackRate during playback', () => {
            const { publisher, platform, queue } = makePublisher();
            queue.setQueue([{ text: 'a'.repeat(150), cfi: '1' }], 0, 0);

            publisher.updatePosition(10);

            expect(platform.setPositionState).toHaveBeenCalledWith(expect.objectContaining({
                duration: expect.any(Number),
                playbackRate: 1,
                position: 10,
            }));
        });

        it('builds ONE metadata shape for engage + refresh (the unified builder)', () => {
            const { publisher, platform, queue } = makePublisher({
                playlist: [{ sectionId: 's1', characterCount: 100 } as SectionMetadata],
            });
            queue.setQueue([{ text: 'Hello', cfi: '1', title: 'Chapter 1' }], 0, 0);

            const engaged = publisher.engageBackgroundMode(queue.getCurrentItem()!);
            expect(engaged).toBe(true);
            expect(platform.updatePlaybackState).toHaveBeenCalledWith('playing');

            publisher.updateMediaSessionMetadata();

            const [engageMeta, refreshMeta] = platform.updateMetadata.mock.calls.map((c) => c[0]);
            expect(refreshMeta).toEqual(engageMeta);
            expect(engageMeta).toEqual(expect.objectContaining({
                title: 'Chapter 1',
                artist: 'Test Author',
                album: 'Test Book',
                artwork: [{ src: 'http://example.com/cover.jpg' }],
                sectionIndex: 0,
                totalSections: 1,
            }));
        });

        it('engageBackgroundMode reports failure instead of throwing', () => {
            const { publisher, platform, queue } = makePublisher();
            queue.setQueue([{ text: 'Hello', cfi: '1' }], 0, 0);
            platform.updateMetadata.mockImplementation(() => { throw new Error('no media session'); });

            expect(publisher.engageBackgroundMode(queue.getCurrentItem()!)).toBe(false);
        });
    });

    describe('position deadband (S19)', () => {
        it('drops per-timeupdate pushes that moved less than the deadband', () => {
            const { publisher, platform, queue } = makePublisher();
            queue.setQueue([{ text: 'a'.repeat(600), cfi: '1' }], 0, 0);

            publisher.updatePosition(10);
            publisher.updatePosition(10 + POSITION_DEADBAND_S / 2); // within deadband
            expect(platform.setPositionState).toHaveBeenCalledTimes(1);

            publisher.updatePosition(10 + POSITION_DEADBAND_S + 0.1); // beyond deadband
            expect(platform.setPositionState).toHaveBeenCalledTimes(2);
        });

        it('a rate change defeats the deadband, and metadata refreshes force a push', () => {
            const { publisher, platform, queue, setSpeed } = makePublisher();
            queue.setQueue([{ text: 'a'.repeat(600), cfi: '1' }], 0, 0);

            publisher.updatePosition(10);
            setSpeed(1.5);
            publisher.updatePosition(10); // same position, new rate
            expect(platform.setPositionState).toHaveBeenCalledTimes(2);

            publisher.updateMediaSessionMetadata(); // force-pushes position 0
            expect(platform.setPositionState).toHaveBeenCalledTimes(3);
        });
    });

    describe('regression: AudioPlayerService.test (calculateBookProgress)', () => {
        const playlist = [
            { sectionId: 'sec1', characterCount: 100 },
            { sectionId: 'sec2', characterCount: 0 },
            { sectionId: 'sec3', characterCount: 100 },
        ] as SectionMetadata[];

        it('calculates book-wide progress across sections and prefix sums', () => {
            const { publisher, queue } = makePublisher({ playlist });

            // Case 1: start of book
            queue.setQueue([{ text: 'a', cfi: '1' }], 0, 0);
            expect(publisher.calculateBookProgress()).toBe(0);

            // Case 2: middle of first section — 20 of 200 chars consumed
            queue.setQueue([{ text: 'a'.repeat(20), cfi: '1' }, { text: 'b', cfi: '2' }], 1, 0);
            expect(publisher.calculateBookProgress()).toBe(0.1);

            // Case 3: start of second section — sec1 (100) of 200 done
            queue.setQueue([{ text: 'b', cfi: '2' }], 0, 1);
            expect(publisher.calculateBookProgress()).toBe(0.5);

            // Case 4: inside the last section — 100 + 50 of 200
            queue.setQueue([{ text: 'c'.repeat(50), cfi: '3' }, { text: 'd', cfi: '4' }], 1, 2);
            expect(publisher.calculateBookProgress()).toBe(0.75);
        });

        it('returns 0 for an empty playlist or zero total characters', () => {
            const empty = makePublisher({ playlist: [] });
            expect(empty.publisher.calculateBookProgress()).toBe(0);

            const zero = makePublisher({
                playlist: [{ sectionId: 's', characterCount: 0 } as SectionMetadata],
            });
            expect(zero.publisher.calculateBookProgress()).toBe(0);
        });
    });
});
