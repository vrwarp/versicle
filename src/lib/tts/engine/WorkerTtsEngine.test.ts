import { describe, it, expect, vi } from 'vitest';
import * as Comlink from 'comlink';

/**
 * Verification of the live worker bridge. We run the real WorkerTtsEngine (→ AudioPlayerService)
 * on one end of a MessageChannel and drive it over Comlink from the other — exactly the wiring a
 * real Web Worker uses, minus OS-thread isolation. This exercises the full round-trip:
 * engine API call (main→worker), backend command (worker→host proxy), provider event
 * (host→worker), and the status callback (worker→main proxy).
 *
 * The engine's remaining in-process collaborators that aren't part of the bridge (LexiconService,
 * dbService) are stubbed — the worker injects its own backend + media platform, so the real
 * providers / MediaSession are never constructed here.
 */
vi.mock('../LexiconService', () => ({
    LexiconService: {
        getInstance: () => ({
            getRules: vi.fn().mockResolvedValue([]),
            applyLexicon: (t: string) => t,
            getBibleLexiconPreference: vi.fn().mockResolvedValue('default'),
        }),
    },
}));

vi.mock('../../../db/DBService', () => ({
    dbService: {
        getBookMetadata: vi.fn().mockResolvedValue({}),
        getSections: vi.fn().mockResolvedValue([]),
        getTTSState: vi.fn().mockResolvedValue(null),
        saveTTSState: vi.fn(),
        updatePlaybackState: vi.fn().mockResolvedValue(undefined),
    },
}));

import { WorkerTtsEngine, type EngineHost, type BackendEvent } from './WorkerTtsEngine';
import type { EngineHostCommand } from './WorkerEngineContext';

describe('WorkerTtsEngine over a MessageChannel (live worker bridge)', () => {
    it('runs orchestration across the boundary: play → backend proxy → provider event → status', async () => {
        const channel = new MessageChannel();
        const engine = new WorkerTtsEngine();
        Comlink.expose(engine, channel.port1);
        channel.port1.start();
        const remote = Comlink.wrap<WorkerTtsEngine>(channel.port2);
        channel.port2.start();

        // The "main-thread host": records what the worker asked it to do.
        const played: Array<{ text: string; voiceId: string; speed: number }> = [];
        const hostCommands: EngineHostCommand[] = [];
        const earcons: string[] = [];
        const host: EngineHost = {
            platformName: () => 'web',
            backendInit: async () => {},
            backendPlay: async (text, options) => { played.push({ text, ...options }); },
            backendPreload: async () => {},
            backendPause: async () => {},
            backendStop: async () => {},
            backendGetVoices: async () => [{ id: 'v1', name: 'Voice 1', lang: 'en', provider: 'local' }],
            backendSetLocale: async () => {},
            backendPlayEarcon: async (type) => { earcons.push(type); },
            backendDownloadVoice: async () => {},
            backendDeleteVoice: async () => {},
            backendIsVoiceDownloaded: async () => false,
            backendSetProviderById: async () => {},
            platformUpdateMetadata: () => {},
            platformUpdatePlaybackState: () => {},
            platformSetPositionState: () => {},
            platformSetBackgroundAudioMode: () => {},
            platformSetBackgroundVolume: () => {},
            platformStop: async () => {},
            lexiconGetRules: async () => [],
            lexiconGetBiblePreference: async () => 'default',
            applyHostCommand: (cmd) => hostCommands.push(cmd),
        };

        await remote.connect(Comlink.proxy(host));

        // Replicate the minimal store state the engine reads.
        await remote.applyStateUpdate({ kind: 'settings', settings: {} as never });
        await remote.applyStateUpdate({ kind: 'genAI', settings: { isEnabled: false } as never });
        await remote.applyStateUpdate({ kind: 'activeLanguage', lang: 'en' });

        // Subscribe across the boundary (the callback is a Comlink proxy).
        const statuses: string[] = [];
        await remote.subscribe(Comlink.proxy((status: string) => { statuses.push(status); }));

        // getVoices is a request/response round-trip into the host backend.
        const voices = await remote.getVoices();
        expect(voices).toEqual([{ id: 'v1', name: 'Voice 1', lang: 'en', provider: 'local' }]);

        await remote.setQueue([{ text: 'Hello from the worker.', cfi: 'cfi1', sourceIndices: [0] }], 0);
        await remote.play();

        // The engine ran in the "worker" and called the main-thread backend.
        await vi.waitFor(() => expect(played.length).toBeGreaterThan(0));
        expect(played[0].text).toContain('Hello from the worker');

        // A provider 'start' event from the host propagates into the engine → status broadcast back.
        await remote.dispatchBackendEvent({ type: 'start' } as BackendEvent);
        await vi.waitFor(() => expect(statuses).toContain('playing'));

        // A pause command crosses to the backend.
        await remote.pause();
        // (pause is fire-and-forget on the engine; status 'paused' is broadcast)
        await vi.waitFor(() => expect(statuses).toContain('paused'));

        channel.port1.close();
        channel.port2.close();
    });
});
