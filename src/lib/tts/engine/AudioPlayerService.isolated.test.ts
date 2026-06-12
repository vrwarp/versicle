import { describe, it, expect, vi } from 'vitest';

/**
 * Capstone test for the engine boundary: drive AudioPlayerService (the orchestration
 * "brain") entirely through injected fakes — a FakeEngineContext for host state and a
 * FakePlaybackBackend for audio output. No Zustand stores, no real providers, no
 * HTMLAudioElement. The remaining main-thread "shell" collaborators that aren't yet behind
 * ports (PlatformIntegration, LexiconService, dbService) are stubbed.
 */
vi.mock('../PlatformIntegration', () => ({
    PlatformIntegration: vi.fn(function () {
        return {
            updateMetadata: vi.fn(),
            updatePlaybackState: vi.fn(),
            stop: vi.fn().mockResolvedValue(undefined),
            setBackgroundAudioMode: vi.fn(),
            getBackgroundAudioMode: vi.fn(() => 'off'),
            setBackgroundVolume: vi.fn(),
            setPositionState: vi.fn(),
        };
    }),
}));

vi.mock('../LexiconService', () => ({
    LexiconService: {
        getInstance: vi.fn(() => ({
            getRules: vi.fn().mockResolvedValue([]),
            applyLexicon: vi.fn((t: string) => t),
        })),
    },
}));

vi.mock('@data/repos/bookContent', () => ({
    bookContent: {
        getSections: vi.fn().mockResolvedValue([]),
    }
}));
vi.mock('@data/repos/playbackCache', () => ({
    playbackCache: {
        getSession: vi.fn().mockResolvedValue(null),
        saveQueue: vi.fn(),
        savePauseTime: vi.fn().mockResolvedValue(undefined),
    }
}));

import { AudioPlayerService } from '../AudioPlayerService';
import { FakeEngineContext } from './FakeEngineContext';
import { FakePlaybackBackend } from './FakePlaybackBackend';

/** A no-op media platform (the engine's media-session/background-audio dependency). */
const platformFactory = () => ({
    setBackgroundAudioMode: vi.fn(),
    getBackgroundAudioMode: vi.fn(() => 'off' as const),
    setBackgroundVolume: vi.fn(),
    updatePlaybackState: vi.fn(),
    updateMetadata: vi.fn(),
    setPositionState: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
});

describe('AudioPlayerService driven entirely by injected fakes', () => {
    it('routes play() to the injected backend and broadcasts provider status to subscribers', async () => {
        const ctx = new FakeEngineContext();
        const backendRef = FakePlaybackBackend.factory();
        const svc = AudioPlayerService.createWithContext(ctx, backendRef.factory, platformFactory);

        const statuses: string[] = [];
        svc.subscribe((snap) => statuses.push(snap.status));

        await svc.setQueue([{ text: 'Hello world.', cfi: 'cfi1', sourceIndices: [0] }], 0);
        await svc.play();

        const backend = backendRef.get()!;
        expect(backend.played).toHaveLength(1);
        expect(backend.played[0].text).toContain('Hello world');

        // The brain only learns playback started when the (main-thread) backend says so.
        // Sequenced since 5b-PR3: the status lands when the provider.start task runs.
        backend.fireStart();
        await vi.waitFor(() => expect(statuses).toContain('playing'));

        await svc.pause();
        expect(backend.pauseCount).toBe(1);
    });

    it('forwards language + voice changes to the injected backend', async () => {
        const ctx = new FakeEngineContext();
        const backendRef = FakePlaybackBackend.factory();
        const svc = AudioPlayerService.createWithContext(ctx, backendRef.factory, platformFactory);

        svc.setLanguage('zh-CN');
        expect(backendRef.get()!.locale).toBe('zh-CN');
    });

    it('captures an audio-bookmark annotation into the injected context (Dragnet)', async () => {
        const ctx = new FakeEngineContext();
        const backendRef = FakePlaybackBackend.factory();
        const svc = AudioPlayerService.createWithContext(ctx, backendRef.factory, platformFactory);

        // A book id is required for the Dragnet capture to dispatch an annotation.
        // setBookId reads only through the injected context + (stubbed) dbService.
        svc.setBookId('book-1');
        await svc.setQueue([{ text: 'A sentence.', cfi: 'cfi1', sourceIndices: [0] }], 0);

        // Simulate a pause immediately followed by a play within the 5s Dragnet window.
        await svc.pause();
        await svc.play();

        // The pause→play gesture captured an audio bookmark into the injected annotation port.
        expect(ctx.addedAnnotations.length).toBeGreaterThan(0);
        expect(ctx.addedAnnotations[0].type).toBe('audio-bookmark');
        expect(backendRef.get()!.earcons).toContain('bookmark_captured');
    });
});
