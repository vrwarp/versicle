/**
 * The shared engine behavioral contract, run against the WORKER transport: the real
 * WorkerTtsEngine exposed over a MessageChannel via Comlink — exactly the production wiring
 * (engine API in, backend commands out to the host, provider events in, status broadcasts
 * out) minus OS-thread isolation. Identical scenarios run in-process in
 * engineParity.inprocess.test.ts; together they pin transport parity for the bridge.
 */
import { vi } from 'vitest';
import * as Comlink from 'comlink';

vi.mock('../LexiconService', () => ({
    LexiconService: {
        getInstance: () => ({
            getRules: vi.fn().mockResolvedValue([]),
            applyLexicon: (t: string) => t,
            getBibleLexiconPreference: vi.fn().mockResolvedValue('default'),
        }),
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

import { WorkerTtsEngine, type EngineHost, type BackendEvent } from './WorkerTtsEngine';
import type { TTSVoice } from '../providers/types';
import { describeEngineParity, type ParityHarness, type ParitySnapshot } from './engineParityScenarios';

describeEngineParity('worker bridge (MessageChannel + Comlink)', async (): Promise<ParityHarness> => {
    const channel = new MessageChannel();
    const engine = new WorkerTtsEngine();
    Comlink.expose(engine, channel.port1);
    channel.port1.start();
    const remote = Comlink.wrap<WorkerTtsEngine>(channel.port2);
    channel.port2.start();

    // The "main-thread host": records what the worker-resident engine asks of the backend.
    const played: Array<{ text: string; voiceId: string; speed: number }> = [];
    const providerIds: string[] = [];
    let voices: TTSVoice[] = [];
    let pauseCount = 0;
    let stopCount = 0;

    const host: EngineHost = {
        platformName: () => 'web',
        backendInit: async () => {},
        backendPlay: async (text, options) => { played.push({ text, ...options }); },
        backendPreload: async () => {},
        backendPause: async () => { pauseCount++; },
        backendStop: async () => { stopCount++; },
        backendGetVoices: async () => voices,
        backendSetLocale: async () => {},
        backendPlayEarcon: async () => {},
        backendDownloadVoice: async () => {},
        backendDeleteVoice: async () => {},
        backendIsVoiceDownloaded: async () => false,
        backendSetProviderById: async (providerId) => { providerIds.push(providerId); },
        platformUpdateMetadata: () => {},
        platformUpdatePlaybackState: () => {},
        platformSetPositionState: () => {},
        platformSetBackgroundAudioMode: () => {},
        platformSetBackgroundVolume: () => {},
        platformStop: async () => {},
        lexiconGetRules: async () => [],
        lexiconGetBiblePreference: async () => 'default',
        getContentAnalysis: async () => undefined,
        getBookMetadata: async () => undefined,
        genAIIsConfigured: async () => false,
        genAIConfigure: () => {},
        genAIDetectContentTypes: async () => ({ classifications: [], justification: '', agreedWithHeuristic: false }),
        genAIGenerateTableAdaptations: async () => [],
        applyHostCommand: () => {},
    };

    await remote.connect(Comlink.proxy(host));

    // Boot replication — the same slices the production client pushes before reporting ready.
    await remote.applyStateUpdate({ kind: 'settings', settings: {} as never });
    await remote.applyStateUpdate({ kind: 'genAI', settings: { isEnabled: false } as never });
    await remote.applyStateUpdate({ kind: 'activeLanguage', lang: 'en' });
    await remote.applyStateUpdate({ kind: 'analysis', snapshot: { sections: {} } });

    const snapshots: ParitySnapshot[] = [];
    await remote.subscribe(Comlink.proxy((status: string, _cfi: string | null, currentIndex: number, queue: ReadonlyArray<unknown>, error: string | null) => {
        snapshots.push({ status, index: currentIndex, queueLen: queue.length, error });
    }));

    const fire = (event: BackendEvent) => remote.dispatchBackendEvent(event);

    return {
        engine: {
            setQueue: (items, startIndex) => remote.setQueue(items, startIndex),
            play: () => remote.play(),
            pause: () => remote.pause(),
            stop: () => remote.stop(),
            jumpTo: (index) => remote.jumpTo(index),
            setVoice: (voiceId) => remote.setVoice(voiceId),
            setSpeed: (speed) => remote.setSpeed(speed),
            setProviderById: (providerId) => remote.setProviderById(providerId),
            getVoices: () => remote.getVoices(),
        },
        backend: {
            played: () => played,
            pauseCount: () => pauseCount,
            stopCount: () => stopCount,
            providerIds: () => providerIds,
            setVoices: (v) => { voices = v; },
        },
        fireStart: () => fire({ type: 'start' } as BackendEvent),
        fireEnd: () => fire({ type: 'end' } as BackendEvent),
        fireError: (error) => fire({ type: 'error', error } as BackendEvent),
        snapshots: () => snapshots,
        dispose: () => {
            channel.port1.close();
            channel.port2.close();
        },
    };
});
