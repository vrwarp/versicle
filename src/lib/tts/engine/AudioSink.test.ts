import { describe, it, expect } from 'vitest';
import { FakeAudioSink } from './FakeAudioSink';
import { MockCloudProvider } from '../providers/MockCloudProvider';
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
