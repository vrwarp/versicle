/**
 * The shared engine behavioral contract, run against the IN-PROCESS transport:
 * PlaybackController driven directly with FakeEngineContext + FakePlaybackBackend +
 * the injected parityHostDb storage ports. The same scenarios run over the worker
 * bridge in engineParity.worker.test.ts.
 *
 * ZERO vi.mock (phase5-tts-strangler.md N3 deadline, reached at 5b-PR4): the
 * engine reaches storage only through the EngineContext ports, so the suite
 * injects in-memory fakes instead of mocking modules — enforced by eslint
 * (no-restricted-syntax in eslint.config.js).
 */
import { vi } from 'vitest';
import { describe, it, expect } from 'vitest';
import { PlaybackController } from './PlaybackController';
import type { TTSQueueItem } from '~types/tts';
import { FakeEngineContext } from './FakeEngineContext';
import { FakePlaybackBackend } from './FakePlaybackBackend';
import {
    createParityBookContent,
    createParityHostDbState,
    createParitySessionStore,
    gateParitySections,
    resetParityHostDb,
} from './parityHostDb';
import {
    advanceParityClock,
    describeEngineParity,
    type ParityHarness,
    type ParitySnapshot,
} from './engineParityScenarios';
import type {
    TTSSettingsData,
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
} as Partial<TTSSettingsData>;

const hostDb = createParityHostDbState();

describeEngineParity('in-process', async (): Promise<ParityHarness> => {
    resetParityHostDb(hostDb);

    const ctx = new FakeEngineContext();
    ctx.ttsSettings = PARITY_TTS_SETTINGS;
    ctx.genAISettings = { isEnabled: false } as Partial<GenAISettingsSnapshot>;
    // Storage ports: the shared parity in-memory implementations.
    ctx.content = createParityBookContent(hostDb);
    ctx.session = createParitySessionStore(hostDb);
    const backendRef = FakePlaybackBackend.factory();
    const svc = PlaybackController.createWithContext(ctx, backendRef.factory, platformFactory);
    const backend = backendRef.get()!;

    const snapshots: ParitySnapshot[] = [];
    const queueRefs: Array<ReadonlyArray<TTSQueueItem>> = [];
    // Snapshot channel (5b-PR2): `queue` is attached only when the queueId changed;
    // the consumer keeps its cached array otherwise — exactly what the production
    // handle does. queueRefs records the EFFECTIVE queue per broadcast, so the
    // identity scenarios (P14/P23) assert on what consumers actually observe.
    let lastQueue: ReadonlyArray<TTSQueueItem> = [];
    svc.subscribe((snap) => {
        if (snap.queue) lastQueue = snap.queue;
        snapshots.push({
            status: snap.status,
            index: snap.index,
            queueLen: lastQueue.length,
            error: snap.error?.message ?? null,
        });
        queueRefs.push(lastQueue);
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

// In-process-only subscribe-semantics pin carried from the deleted
// AudioPlayerService.predictability.test.ts (absorption ledger row 2; the
// staleness cases live in the shared scenarios' P18 + predictability blocks).
describe('regression: AudioPlayerService.predictability (subscribe semantics)', () => {
    it('a listener unsubscribed before the next-tick replay never fires', async () => {
        const svc = PlaybackController.createWithContext(
            new FakeEngineContext(),
            FakePlaybackBackend.factory().factory,
            platformFactory,
        );

        const listener = vi.fn();
        const unsubscribe = svc.subscribe(listener);
        unsubscribe(); // immediately, before the setTimeout(0) replay

        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(listener).not.toHaveBeenCalled();
    });
});
