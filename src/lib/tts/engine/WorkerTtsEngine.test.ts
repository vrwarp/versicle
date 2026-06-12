import { describe, it, expect, vi } from 'vitest';
import * as Comlink from 'comlink';

/**
 * Verification of the live worker bridge. We run the real WorkerTtsEngine (→ PlaybackController)
 * on one end of a MessageChannel and drive it over Comlink from the other — exactly the wiring a
 * real Web Worker uses, minus OS-thread isolation. This exercises the full round-trip:
 * engine API call (main→worker), backend command (worker→host proxy), provider event
 * (host→worker), and the status callback (worker→main proxy).
 *
 * Storage is injected through the WorkerTtsEngine constructor ports (5b-PR4) — no vi.mock.
 */
import { WorkerTtsEngine, type EngineHost, type BackendEvent } from './WorkerTtsEngine';
import type { EngineHostCommand } from './WorkerEngineContext';
import type { BookContentPort } from './EngineContext';

describe('WorkerTtsEngine over a MessageChannel (live worker bridge)', () => {
    it('runs orchestration across the boundary: play → backend proxy → provider event → status', async () => {
        const channel = new MessageChannel();
        const engine = new WorkerTtsEngine({
            content: {
                getSections: async () => [],
                getTTSPreparation: async () => undefined,
                getTableImages: async () => [],
                getBookStructure: async () => undefined,
            } as unknown as BookContentPort,
            session: {
                loadSession: async () => undefined,
                persistQueue: () => {},
                persistPauseTime: async () => {},
            },
        });
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
            getContentAnalysis: async () => undefined,
            getBookMetadata: async () => undefined,
            genAIIsConfigured: async () => false,
            genAIConfigure: () => {},
            genAIDetectContentTypes: async () => ({ classifications: [], justification: '', agreedWithHeuristic: false }),
            genAIGenerateTableAdaptations: async () => [],
            applyHostCommand: (cmd) => hostCommands.push(cmd),
        };

        await remote.connect(Comlink.proxy(host));

        // Replicate the boot slices the engine reads (the same set the production client
        // pushes before reporting ready — see replicationSpec.ts).
        await remote.applyStateUpdate({ kind: 'settings', settings: {} as never });
        await remote.applyStateUpdate({ kind: 'genAI', settings: { isEnabled: false } as never });
        await remote.applyStateUpdate({ kind: 'activeLanguage', lang: 'en' });
        await remote.applyStateUpdate({ kind: 'analysis', snapshot: { sections: {} } });
        expect(await remote.hasReplicated(['settings', 'genAI', 'activeLanguage', 'analysis'])).toBe(true);

        // Subscribe across the boundary (the callback is a Comlink proxy).
        const statuses: string[] = [];
        await remote.subscribe(Comlink.proxy((snap: import('./TtsEngine').PlaybackSnapshot) => { statuses.push(snap.status); }));

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
