import { describe, it, expect, vi, afterEach } from 'vitest';
import { FakeAudioSink } from './FakeAudioSink';
import { MockCloudProvider } from '../providers/MockCloudProvider';
import { getDB } from '@db/db';
import type { TTSEvent } from '../providers/types';

describe('AudioSink injection', () => {
    it('records commands without touching the DOM', async () => {
        const sink = new FakeAudioSink();
        sink.setRate(2);
        await sink.playBlob(new Blob(['x']));
        sink.playEarcon('bookmark_captured');
        sink.pause();
        sink.stop();

        expect(sink.rate).toBe(2);
        expect(sink.playedBlobs).toHaveLength(1);
        expect(sink.earcons).toEqual(['bookmark_captured']);
        expect(sink.pauseCount).toBe(1);
        expect(sink.stopCount).toBe(1);
    });

    it('fires lifecycle callbacks to whoever subscribed', () => {
        const sink = new FakeAudioSink();
        const times: number[] = [];
        let ended = false;
        sink.setOnTimeUpdate((t) => times.push(t));
        sink.setOnEnded(() => { ended = true; });

        sink.fireTimeUpdate(1.5);
        sink.fireEnded();

        expect(times).toEqual([1.5]);
        expect(sink.getCurrentTime()).toBe(1.5);
        expect(ended).toBe(true);
    });

    it('drives a real cloud provider through the injected sink (no HTMLAudioElement)', async () => {
        const sink = new FakeAudioSink();
        const provider = new MockCloudProvider(sink);
        await provider.init();

        const events: TTSEvent[] = [];
        provider.on((e) => events.push(e));

        await provider.play('hello world', { voiceId: 'mock-male', speed: 1.25 });

        // The provider synthesized audio and handed it to the injected sink.
        expect(sink.playedBlobs).toHaveLength(1);
        expect(sink.rate).toBe(1.25);
        expect(events.some((e) => e.type === 'start')).toBe(true);

        // The engine learns playback finished only when the (main-thread) sink says so.
        sink.fireEnded();
        expect(events.some((e) => e.type === 'end')).toBe(true);
    });
});

describe('regression: cloud speed/alignment policy through the real cache', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('same text+voice at a different speed hits the same cache entry, rate at the sink, alignment intact', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fetchSpy = vi.spyOn(MockCloudProvider.prototype as any, 'fetchAudioData');
        const text = 'speed-independent cache round trip sentence';

        // First play at 1.0: cache miss → synthesize → write blob + alignment to IndexedDB.
        const sinkA = new FakeAudioSink();
        const providerA = new MockCloudProvider(sinkA);
        await providerA.play(text, { voiceId: 'mock-male', speed: 1.0 });
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        // Second play from a fresh provider at 1.75: must reuse the cached entry
        // (no re-synthesis), apply the rate at the sink, and keep the timepoints.
        const sinkB = new FakeAudioSink();
        const providerB = new MockCloudProvider(sinkB);

        await providerB.play(text, { voiceId: 'mock-male', speed: 1.75 });

        expect(fetchSpy).toHaveBeenCalledTimes(1); // cache hit despite the speed change
        expect(sinkB.playedBlobs).toHaveLength(1);
        expect(sinkB.rate).toBe(1.75);

        // The cached row keeps the timepoints intact across the speed change.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const segment = await (providerB as any).getOrFetch(text, { voiceId: 'mock-male', speed: 1.75 });
        expect(fetchSpy).toHaveBeenCalledTimes(1); // still the same cache entry
        expect(segment.alignment).toEqual([{ timeSeconds: 0, charIndex: 0, type: 'sentence' }]);
    });

    it('reads alignment from legacy rows written under the old alignmentData field', async () => {
        const text = 'legacy alignmentData row sentence';
        const timepoints = [{ timeSeconds: 0.5, charIndex: 3, type: 'sentence' }];

        // Seed a row the way pre-unification builds wrote it (alignmentData field),
        // under the key the provider will compute for this text+voice.
        const provider = new MockCloudProvider(new FakeAudioSink());
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const key = await (provider as any).cache.generateKey(text, 'mock-male');
        const db = await getDB();
        await db.put('cache_audio_blobs', {
            key,
            audio: new ArrayBuffer(4),
            alignmentData: timepoints,
            createdAt: 1,
            lastAccessed: 1,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fetchSpy = vi.spyOn(MockCloudProvider.prototype as any, 'fetchAudioData');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const segment = await (provider as any).getOrFetch(text, { voiceId: 'mock-male', speed: 1.0 });

        expect(fetchSpy).not.toHaveBeenCalled(); // legacy row is a usable cache hit
        expect(segment.alignment).toEqual(timepoints);
    });
});
