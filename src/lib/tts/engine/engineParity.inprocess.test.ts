/**
 * The shared engine behavioral contract, run against the IN-PROCESS transport:
 * AudioPlayerService driven directly with FakeEngineContext + FakePlaybackBackend.
 * The same scenarios run over the worker bridge in engineParity.worker.test.ts.
 *
 * vi.mock here is frozen to the engine-dir allowlist (phase5-tts-strangler.md N3, rewritten
 * post-P3 when src/db died): {@data/repos/bookContent, @data/repos/playbackCache,
 * ../LexiconService, ../PlatformIntegration} — enforced by eslint
 * (no-restricted-syntax in eslint.config.js); shrinks to ∅ at 5b-PR5.
 */
import { vi } from 'vitest';
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

vi.mock('@data/repos/bookContent', async () => {
    const { createParityBookContent } = await import('./parityHostDb');
    return { bookContent: createParityBookContent(hostDb) };
});
vi.mock('@data/repos/playbackCache', async () => {
    const { createParityPlaybackCache } = await import('./parityHostDb');
    return { playbackCache: createParityPlaybackCache(hostDb) };
});

import { AudioPlayerService } from '../AudioPlayerService';
import type { TTSQueueItem } from '../AudioPlayerService';
import { FakeEngineContext } from './FakeEngineContext';
import { FakePlaybackBackend } from './FakePlaybackBackend';
import { gateParitySections, resetParityHostDb } from './parityHostDb';
import {
    advanceParityClock,
    describeEngineParity,
    type ParityHarness,
    type ParitySnapshot,
} from './engineParityScenarios';
import type {
    TTSSettingsSnapshot,
    GenAISettingsSnapshot,
    Progress,
    BookMetadata,
    ContentAnalysis,
    SectionAnalysis,
} from './EngineContext';

const platformFactory = () => ({
    setBackgroundAudioMode: vi.fn(),
    getBackgroundAudioMode: vi.fn(() => 'off' as const),
    setBackgroundVolume: vi.fn(),
    updatePlaybackState: vi.fn(),
    updateMetadata: vi.fn(),
    setPositionState: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
});

/** The TTS settings slice the content pipeline reads (refinement off: keep fixtures 1:1). */
const PARITY_TTS_SETTINGS = {
    customAbbreviations: [],
    alwaysMerge: [],
    sentenceStarters: [],
    isBibleLexiconEnabled: false,
    profiles: { en: { voiceId: null, rate: 1.0, pitch: 1.0, volume: 1.0, minSentenceLength: 0 } },
} as Partial<TTSSettingsSnapshot>;

describeEngineParity('in-process', async (): Promise<ParityHarness> => {
    resetParityHostDb(hostDb);

    const ctx = new FakeEngineContext();
    ctx.ttsSettings = PARITY_TTS_SETTINGS;
    ctx.genAISettings = { isEnabled: false } as Partial<GenAISettingsSnapshot>;
    const backendRef = FakePlaybackBackend.factory();
    const svc = AudioPlayerService.createWithContext(ctx, backendRef.factory, platformFactory);
    const backend = backendRef.get()!;

    const snapshots: ParitySnapshot[] = [];
    const queueRefs: Array<ReadonlyArray<TTSQueueItem>> = [];
    svc.subscribe((status, _cfi, currentIndex, queue, error) => {
        snapshots.push({ status, index: currentIndex, queueLen: queue.length, error });
        queueRefs.push(queue);
    });

    return {
        transport: 'in-process',
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
            setBookId: (bookId) => svc.setBookId(bookId),
            loadSection: (index, autoPlay) => svc.loadSection(index, autoPlay) as unknown as Promise<void>,
            loadSectionBySectionId: (sectionId, autoPlay) => {
                void svc.loadSectionBySectionId(sectionId, autoPlay);
            },
            skipToNextSection: () => svc.skipToNextSection(),
            skipToPreviousSection: () => svc.skipToPreviousSection(),
            clearPauseGesture: () => svc.clearPauseGesture(),
        },
        backend: {
            played: () => backend.played,
            pauseCount: () => backend.pauseCount,
            stopCount: () => backend.stopCount,
            providerIds: () => backend.providerIds,
            setVoices: (voices) => { backend.voices = voices; },
            failNextPlay: (error) => backend.failNextPlay(error),
            activeProviderId: () => backend.currentProviderId,
            earcons: () => backend.earcons,
        },
        host: {
            seedTTSState: (bookId, queue) => {
                hostDb.ttsState[bookId] = { queue };
            },
            seedProgress: (bookId, queueIndex, sectionIndex) => {
                ctx.progress[bookId] = {
                    currentQueueIndex: queueIndex,
                    currentSectionIndex: sectionIndex,
                } as unknown as Progress;
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
                ctx.bookMetadata[bookId] = metadata as unknown as BookMetadata;
            },
            setGenAISettings: (settings) => {
                ctx.genAISettings = settings as Partial<GenAISettingsSnapshot>;
                ctx.emitGenAIChange();
            },
            pushAnalysisSuccess: (bookId, sectionId, analysis) => {
                const key = `${bookId}/${sectionId}`;
                ctx.contentAnalyses[key] = {
                    status: 'success',
                    generatedAt: analysis.generatedAt,
                    referenceStartCfi: analysis.referenceStartCfi,
                    tableAdaptations: analysis.tableAdaptations,
                } as unknown as ContentAnalysis;
                ctx.analyses[key] = {
                    status: 'success',
                    generatedAt: analysis.generatedAt,
                    tableAdaptations: analysis.tableAdaptations,
                } as unknown as SectionAnalysis;
                ctx.emitAnalysisChange();
            },
            annotations: () =>
                ctx.addedAnnotations.map((a) => ({
                    bookId: a.bookId,
                    cfiRange: a.cfiRange,
                    type: a.type as string,
                    text: a.text ?? '',
                })),
            analysisFetchCount: (bookId, sectionId) =>
                ctx.contentAnalysisFetchLog.filter((k) => k === `${bookId}/${sectionId}`).length,
            contentFetchCount: (bookId, sectionId) =>
                hostDb.contentFetches[`${bookId}/${sectionId}`] ?? 0,
        },
        fireStart: () => backend.fireStart(),
        fireEnd: () => backend.fireEnd(),
        fireError: (error) => backend.fireError(error),
        snapshots: () => snapshots,
        queueRefs: () => queueRefs,
        advanceTime: (ms) => advanceParityClock(ms),
        dispose: () => {
            vi.useRealTimers();
            void svc.stop();
        },
    };
}, 'in-process');
