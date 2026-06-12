/**
 * The shared engine behavioral contract, run against the WORKER transport: the real
 * WorkerTtsEngine exposed over a MessageChannel via Comlink — exactly the production wiring
 * (engine API in, backend commands out to the host, provider events in, status broadcasts
 * out) minus OS-thread isolation. Identical scenarios run in-process in
 * engineParity.inprocess.test.ts; together they pin transport parity for the bridge.
 *
 * The `host.*` seams replicate state the way the production client does: store-slice pushes
 * via applyStateUpdate (genAI/analysis/progress/bookLanguage — see replicationSpec.ts) and
 * host ports for async reads (book metadata, persisted ContentAnalysis rows). The data repos
 * the worker-resident engine imports are the same mocked modules (the engine-dir vi.mock
 * allowlist: {@data/repos/bookContent, @data/repos/playbackCache, ../LexiconService} here —
 * PlatformIntegration is proxied, not imported, on this transport).
 */
import { vi } from 'vitest';
import * as Comlink from 'comlink';
import type { ParityHostDbState } from './parityHostDb';

const hostDb = vi.hoisted(
    (): ParityHostDbState => ({
        sections: {},
        ttsState: {},
        ttsContent: {},
        contentErrors: {},
        sectionGates: {},
        contentFetches: {},
    }),
);

vi.mock('../LexiconService', () => ({
    LexiconService: {
        getInstance: () => ({
            getRules: vi.fn().mockResolvedValue([]),
            applyLexicon: (t: string) => t,
            getBibleLexiconPreference: vi.fn().mockResolvedValue('default'),
        }),
    },
}));

vi.mock('@data/repos/bookContent', async () => {
    const { createParityBookContent } = await import('./parityHostDb');
    return { bookContent: createParityBookContent(hostDb) };
});
vi.mock('@data/repos/playbackCache', async () => {
    const { createParityPlaybackCache } = await import('./parityHostDb');
    return { playbackCache: createParityPlaybackCache(hostDb) };
});

import { WorkerTtsEngine, type EngineHost, type BackendEvent } from './WorkerTtsEngine';
import type { TTSVoice } from '../providers/types';
import type { TTSQueueItem } from '../AudioPlayerService';
import type {
    BookMetadata,
    ContentAnalysis,
    SectionAnalysis,
    TTSSettingsSnapshot,
    GenAISettingsSnapshot,
    Progress,
} from './EngineContext';
import type { EngineHostCommand } from './WorkerEngineContext';
import { gateParitySections, resetParityHostDb } from './parityHostDb';
import {
    advanceParityClock,
    describeEngineParity,
    type ParityAnnotation,
    type ParityHarness,
    type ParitySnapshot,
} from './engineParityScenarios';

/** The TTS settings slice the content pipeline reads (refinement off: keep fixtures 1:1). */
const PARITY_TTS_SETTINGS = {
    customAbbreviations: [],
    alwaysMerge: [],
    sentenceStarters: [],
    isBibleLexiconEnabled: false,
    profiles: { en: { voiceId: null, rate: 1.0, pitch: 1.0, volume: 1.0, minSentenceLength: 0 } },
} as Partial<TTSSettingsSnapshot> as TTSSettingsSnapshot;

describeEngineParity('worker bridge (MessageChannel + Comlink)', async (): Promise<ParityHarness> => {
    resetParityHostDb(hostDb);

    const channel = new MessageChannel();
    const engine = new WorkerTtsEngine();
    Comlink.expose(engine, channel.port1);
    channel.port1.start();
    const remote = Comlink.wrap<WorkerTtsEngine>(channel.port2);
    channel.port2.start();

    // The "main-thread host": records what the worker-resident engine asks of the backend.
    const played: Array<{ text: string; voiceId: string; speed: number }> = [];
    const providerIds: string[] = [];
    const earcons: string[] = [];
    const annotations: ParityAnnotation[] = [];
    let voices: TTSVoice[] = [];
    let pauseCount = 0;
    let stopCount = 0;
    let currentProviderId = 'local';
    let failNext: { message: string } | null = null;
    /** bookId → metadata served by the getBookMetadata host port. */
    const bookMetadata: Record<string, BookMetadata> = {};
    /** `${bookId}/${sectionId}` → persisted ContentAnalysis served by the host port. */
    const contentAnalyses: Record<string, ContentAnalysis> = {};
    const analysisFetchLog: string[] = [];
    /** The analysis snapshot replicated so far (rebuilt on every pushAnalysisSuccess). */
    const analysisSections: Record<string, SectionAnalysis> = {};

    const fire = (event: BackendEvent) => remote.dispatchBackendEvent(event);

    const host: EngineHost = {
        platformName: () => 'web',
        backendInit: async () => {},
        backendPlay: async (text, options) => {
            played.push({ text, ...options });
            const failure = failNext;
            if (failure && currentProviderId !== 'local') {
                // Replicates TTSProviderManager's CURRENT fallback (the S2 double-fire): the
                // provider error event AND the play-catch path both emit {type:'fallback'}
                // and swap to the local provider. 5a-PR2 collapses this to one rejection
                // path; the P21 it.fails rider tracks the flip.
                failNext = null;
                currentProviderId = 'local';
                void fire({ type: 'error', error: { type: 'fallback', message: failure.message } });
                void fire({ type: 'error', error: { type: 'fallback', message: failure.message } });
            }
        },
        backendPreload: async () => {},
        backendPause: async () => { pauseCount++; },
        backendStop: async () => { stopCount++; },
        backendGetVoices: async () => voices,
        backendSetLocale: async () => {},
        backendPlayEarcon: async (type) => { earcons.push(type); },
        backendDownloadVoice: async () => {},
        backendDeleteVoice: async () => {},
        backendIsVoiceDownloaded: async () => false,
        backendSetProviderById: async (providerId) => {
            providerIds.push(providerId);
            currentProviderId = providerId;
        },
        platformUpdateMetadata: () => {},
        platformUpdatePlaybackState: () => {},
        platformSetPositionState: () => {},
        platformSetBackgroundAudioMode: () => {},
        platformSetBackgroundVolume: () => {},
        platformStop: async () => {},
        lexiconGetRules: async () => [],
        lexiconGetBiblePreference: async () => 'default',
        getContentAnalysis: async (bookId, sectionId) => {
            analysisFetchLog.push(`${bookId}/${sectionId}`);
            return contentAnalyses[`${bookId}/${sectionId}`];
        },
        getBookMetadata: async (bookId) => bookMetadata[bookId],
        genAIIsConfigured: async () => false,
        genAIConfigure: () => {},
        genAIDetectContentTypes: async () => ({ classifications: [], justification: '', agreedWithHeuristic: false }),
        genAIGenerateTableAdaptations: async () => [],
        applyHostCommand: (command: EngineHostCommand) => {
            if (command.kind === 'addAnnotation') {
                annotations.push({
                    bookId: command.annotation.bookId,
                    cfiRange: command.annotation.cfiRange,
                    type: command.annotation.type as string,
                    text: command.annotation.text ?? '',
                });
            }
        },
    };

    await remote.connect(Comlink.proxy(host));

    // Boot replication — the same slices the production client pushes before reporting ready.
    await remote.applyStateUpdate({ kind: 'settings', settings: PARITY_TTS_SETTINGS });
    await remote.applyStateUpdate({ kind: 'genAI', settings: { isEnabled: false } as never });
    await remote.applyStateUpdate({ kind: 'activeLanguage', lang: 'en' });
    await remote.applyStateUpdate({ kind: 'analysis', snapshot: { sections: analysisSections } });

    const snapshots: ParitySnapshot[] = [];
    const queueRefs: Array<ReadonlyArray<TTSQueueItem>> = [];
    await remote.subscribe(Comlink.proxy((status: string, _cfi: string | null, currentIndex: number, queue: ReadonlyArray<TTSQueueItem>, error: string | null) => {
        snapshots.push({ status, index: currentIndex, queueLen: queue.length, error });
        queueRefs.push(queue);
    }));

    return {
        transport: 'worker',
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
            setBookId: async (bookId) => {
                // Mirror the production client's setBook: pre-push the per-book slices the
                // engine reads synchronously inside setBookId (createWorkerEngineClient).
                if (bookId) {
                    await remote.applyStateUpdate({ kind: 'bookLanguage', bookId, lang: 'en' });
                }
                await remote.setBookId(bookId);
            },
            loadSection: (index, autoPlay) => remote.loadSection(index, autoPlay),
            loadSectionBySectionId: (sectionId, autoPlay) => {
                void remote.loadSectionBySectionId(sectionId, autoPlay);
            },
            skipToNextSection: () => remote.skipToNextSection(),
            skipToPreviousSection: () => remote.skipToPreviousSection(),
            clearPauseGesture: () => remote.clearPauseGesture(),
        },
        backend: {
            played: () => played,
            pauseCount: () => pauseCount,
            stopCount: () => stopCount,
            providerIds: () => providerIds,
            setVoices: (v) => { voices = v; },
            failNextPlay: (error) => { failNext = error; },
            activeProviderId: () => currentProviderId,
            earcons: () => earcons,
        },
        host: {
            seedTTSState: (bookId, queue) => {
                hostDb.ttsState[bookId] = { queue };
            },
            seedProgress: async (bookId, queueIndex, sectionIndex) => {
                await remote.applyStateUpdate({
                    kind: 'progress',
                    bookId,
                    progress: {
                        currentQueueIndex: queueIndex,
                        currentSectionIndex: sectionIndex,
                    } as unknown as Progress,
                });
            },
            seedSections: (bookId, sections) => {
                hostDb.sections[bookId] = sections;
            },
            seedTTSContent: (bookId, sectionId, sentences) => {
                hostDb.ttsContent[`${bookId}/${sectionId}`] = { sentences };
            },
            failTTSContent: (bookId, sectionId) => {
                hostDb.contentErrors[`${bookId}/${sectionId}`] = true;
            },
            gateSections: (bookId) => gateParitySections(hostDb, bookId),
            seedBookMetadata: (bookId, metadata) => {
                bookMetadata[bookId] = metadata as unknown as BookMetadata;
            },
            setGenAISettings: async (settings) => {
                await remote.applyStateUpdate({
                    kind: 'genAI',
                    settings: settings as unknown as GenAISettingsSnapshot,
                });
            },
            pushAnalysisSuccess: async (bookId, sectionId, analysis) => {
                const key = `${bookId}/${sectionId}`;
                contentAnalyses[key] = {
                    status: 'success',
                    generatedAt: analysis.generatedAt,
                    referenceStartCfi: analysis.referenceStartCfi,
                    tableAdaptations: analysis.tableAdaptations,
                } as unknown as ContentAnalysis;
                analysisSections[key] = {
                    status: 'success',
                    generatedAt: analysis.generatedAt,
                    tableAdaptations: analysis.tableAdaptations,
                } as unknown as SectionAnalysis;
                await remote.applyStateUpdate({
                    kind: 'analysis',
                    snapshot: { sections: { ...analysisSections } },
                });
            },
            annotations: () => annotations,
            analysisFetchCount: (bookId, sectionId) =>
                analysisFetchLog.filter((k) => k === `${bookId}/${sectionId}`).length,
            contentFetchCount: (bookId, sectionId) =>
                hostDb.contentFetches[`${bookId}/${sectionId}`] ?? 0,
        },
        fireStart: () => fire({ type: 'start' } as BackendEvent),
        fireEnd: () => fire({ type: 'end' } as BackendEvent),
        fireError: (error) => fire({ type: 'error', error } as BackendEvent),
        snapshots: () => snapshots,
        queueRefs: () => queueRefs,
        advanceTime: (ms) => advanceParityClock(ms),
        dispose: () => {
            vi.useRealTimers();
            channel.port1.close();
            channel.port2.close();
        },
    };
}, 'worker');
