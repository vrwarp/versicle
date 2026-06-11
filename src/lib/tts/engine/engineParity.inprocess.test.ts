/**
 * The shared engine behavioral contract, run against the IN-PROCESS transport:
 * AudioPlayerService driven directly with FakeEngineContext + FakePlaybackBackend.
 * The same scenarios run over the worker bridge in engineParity.worker.test.ts.
 */
import { vi } from 'vitest';

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
            getBibleLexiconPreference: vi.fn().mockResolvedValue('default'),
        })),
    },
}));

vi.mock('@db/DBService', () => ({
    dbService: {
        getSections: vi.fn().mockResolvedValue([]),
        getTTSState: vi.fn().mockResolvedValue(null),
        saveTTSState: vi.fn(),
        updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    },
}));

import { AudioPlayerService } from '../AudioPlayerService';
import { FakeEngineContext } from './FakeEngineContext';
import { FakePlaybackBackend } from './FakePlaybackBackend';
import { describeEngineParity, type ParityHarness, type ParitySnapshot } from './engineParityScenarios';

const platformFactory = () => ({
    setBackgroundAudioMode: vi.fn(),
    getBackgroundAudioMode: vi.fn(() => 'off' as const),
    setBackgroundVolume: vi.fn(),
    updatePlaybackState: vi.fn(),
    updateMetadata: vi.fn(),
    setPositionState: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
});

describeEngineParity('in-process', async (): Promise<ParityHarness> => {
    const ctx = new FakeEngineContext();
    const backendRef = FakePlaybackBackend.factory();
    const svc = AudioPlayerService.createWithContext(ctx, backendRef.factory, platformFactory);
    const backend = backendRef.get()!;

    const snapshots: ParitySnapshot[] = [];
    svc.subscribe((status, _cfi, currentIndex, queue, error) => {
        snapshots.push({ status, index: currentIndex, queueLen: queue.length, error });
    });

    return {
        engine: {
            setQueue: (items, startIndex) => svc.setQueue(items, startIndex) as unknown as Promise<void>,
            play: () => svc.play() as Promise<void>,
            pause: () => svc.pause() as unknown as Promise<void>,
            stop: () => svc.stop() as unknown as Promise<void>,
            jumpTo: (index) => svc.jumpTo(index) as unknown as Promise<void>,
            setVoice: (voiceId) => svc.setVoice(voiceId) as unknown as Promise<void>,
            setSpeed: (speed) => svc.setSpeed(speed) as unknown as Promise<void>,
            setProviderById: (providerId) => svc.setProviderById(providerId) as unknown as Promise<void>,
            getVoices: () => svc.getVoices(),
        },
        backend: {
            played: () => backend.played,
            pauseCount: () => backend.pauseCount,
            stopCount: () => backend.stopCount,
            providerIds: () => backend.providerIds,
            setVoices: (voices) => { backend.voices = voices; },
        },
        fireStart: () => backend.fireStart(),
        fireEnd: () => backend.fireEnd(),
        fireError: (error) => backend.fireError(error),
        snapshots: () => snapshots,
        dispose: () => { void svc.stop(); },
    };
});
