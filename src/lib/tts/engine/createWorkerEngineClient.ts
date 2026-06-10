/**
 * Main-thread bridge to the worker-resident TTS engine.
 *
 * Creates the Web Worker, hosts the real audio backend ({@link TTSProviderManager}) and media
 * platform ({@link PlatformIntegration}) on the main thread, replicates the Zustand store state
 * into the worker, and applies the worker's write commands back to the stores. Returns a
 * Comlink proxy to the engine (a {@link WorkerTtsEngine}).
 *
 * The same `WorkerTtsEngine` + `EngineHost` contract is verified in `WorkerTtsEngine.test.ts`
 * over a MessageChannel; here the transport is a real `Worker`.
 *
 * NOTE on adoption: this returns an *async* (Comlink) engine, whereas `getAudioPlayer()` is the
 * synchronous in-process engine. Swapping the app onto the worker means awaiting
 * `createWorkerEngineClient()` once at startup and routing `useTTSStore` through the returned
 * proxy (fire-and-forget calls work unchanged; `subscribe` already returns a Comlink proxy
 * unsubscribe). See PORTING-TO-WORKER.md.
 */
import * as Comlink from 'comlink';
import { Capacitor } from '@capacitor/core';
import { TTSProviderManager } from '../TTSProviderManager';
import { PlatformIntegration } from '../PlatformIntegration';
import { LexiconService } from '../LexiconService';
import { bookRepository } from '../../../db/BookRepository';
import { contentAnalysisRepository } from '../../../db/ContentAnalysisRepository';
import { genAIService } from '../../genai/GenAIService';
import { createReplicatedSlices, bookSnapshotUpdates } from './replicationSpec';
import { useTTSStore } from '../../../store/useTTSStore';
import { useGenAIStore } from '../../../store/useGenAIStore';
import { useReadingStateStore } from '../../../store/useReadingStateStore';
import { useAnnotationStore } from '../../../store/useAnnotationStore';
import { useToastStore } from '../../../store/useToastStore';
import { useReaderUIStore } from '../../../store/useReaderUIStore';
import { createLogger } from '../../logger';
import type { WorkerTtsEngine, EngineHost } from './WorkerTtsEngine';
import type { EngineHostCommand } from './WorkerEngineContext';
import type { TTSQueueItem, TTSStatus, DownloadInfo } from '../AudioPlayerService';

type StatusListener = (
    status: TTSStatus,
    activeCfi: string | null,
    currentIndex: number,
    queue: ReadonlyArray<TTSQueueItem>,
    error: string | null,
    downloadInfo?: DownloadInfo,
) => void;

const logger = createLogger('WorkerEngineClient');

/**
 * Apply a worker write command to the real Zustand stores (mirrors createZustandEngineContext).
 * Exported for unit tests — every EngineHostCommand kind must map to the right store/repository
 * call (createWorkerEngineClient.hostCommands.test.ts).
 */
export function applyHostCommand(command: EngineHostCommand): void {
    switch (command.kind) {
        case 'setActiveLanguage': useTTSStore.getState().setActiveLanguage(command.lang); break;
        case 'updateTTSProgress':
            useReadingStateStore.getState().updateTTSProgress(command.bookId, command.queueIndex, command.sectionIndex);
            break;
        case 'addCompletedRange':
            useReadingStateStore.getState().addCompletedRange(command.bookId, command.cfiRange, command.type);
            break;
        case 'updatePlaybackPosition':
            useReadingStateStore.getState().updatePlaybackPosition(command.bookId, command.lastPlayedCfi);
            break;
        case 'addAnnotation': useAnnotationStore.getState().add(command.annotation); break;
        case 'showToast': useToastStore.getState().showToast(command.message, command.type); break;
        case 'addGenAILog': useGenAIStore.getState().addLog(command.entry); break;
        case 'setCurrentSection':
            useReaderUIStore.getState().setCurrentSection(command.title, command.sectionId);
            break;
        case 'saveReferenceStartCfi':
            contentAnalysisRepository.saveReferenceStartCfi(command.bookId, command.sectionId, command.cfi);
            break;
        case 'markAnalysisLoading':
            contentAnalysisRepository.markAnalysisLoading(command.bookId, command.sectionId);
            break;
        case 'markAnalysisError':
            contentAnalysisRepository.markAnalysisError(command.bookId, command.sectionId, command.error);
            break;
        case 'saveTableAdaptations':
            contentAnalysisRepository.saveTableAdaptations(command.bookId, command.sectionId, command.adaptations);
            break;
    }
}

export interface WorkerEngineClient {
    /** Comlink proxy to the worker-resident engine. */
    engine: Comlink.Remote<WorkerTtsEngine>;
    /** Subscribe to playback updates. Wraps the listener as a Comlink proxy automatically. */
    subscribe(listener: StatusListener): Promise<() => void>;
    /** Replicate the current language + progress for a book, then set it on the engine. */
    setBook(bookId: string | null): Promise<void>;
    /** Tear down the worker and store subscriptions. */
    dispose(): void;
}

/**
 * Spin up the TTS engine in a Worker and wire it to the main-thread backend + stores.
 */
export async function createWorkerEngineClient(): Promise<WorkerEngineClient> {
    const worker = new Worker(new URL('../../../workers/tts.worker.ts', import.meta.url), { type: 'module' });

    // Surface worker load/runtime errors — otherwise a module-init failure inside the worker
    // would leave every Comlink call hanging forever (no response, no rejection).
    let workerError: string | null = null;
    worker.addEventListener('error', (e: ErrorEvent) => {
        workerError = `${e.message}${e.filename ? ` (${e.filename}:${e.lineno})` : ''}`;
        logger.error('TTS worker error', workerError);
    });

    const engine = Comlink.wrap<WorkerTtsEngine>(worker);

    const withWorkerGuard = async <T>(label: string, op: Promise<T>): Promise<T> => {
        return Promise.race([
            op,
            new Promise<T>((_, reject) =>
                setTimeout(() => reject(new Error(`TTS worker ${label} timed out${workerError ? `: ${workerError}` : ''}`)), 15000),
            ),
        ]);
    };

    // The real audio backend lives on the main thread; its events are forwarded into the worker.
    const backend = new TTSProviderManager({
        onStart: () => { void engine.dispatchBackendEvent({ type: 'start' }); },
        onEnd: () => { void engine.dispatchBackendEvent({ type: 'end' }); },
        onError: (error) => {
            const safe = error instanceof Error ? { message: error.message } : error;
            void engine.dispatchBackendEvent({ type: 'error', error: safe });
        },
        onTimeUpdate: (currentTime) => { void engine.dispatchBackendEvent({ type: 'timeupdate', currentTime }); },
        onDownloadProgress: (voiceId, percent, status) => {
            void engine.dispatchBackendEvent({ type: 'downloadProgress', voiceId, percent, status });
        },
    });

    // The real media platform (lock screen / background audio) on the main thread.
    const platform = new PlatformIntegration({
        onPlay: () => { void engine.play(); },
        onPause: () => { engine.pause(); },
        onStop: () => { engine.stop(); },
        onPrev: () => { void engine.skipToPreviousSection(); },
        onNext: () => { void engine.skipToNextSection(); },
        onSeek: (offset) => { engine.seek(offset); },
        onSeekTo: () => { /* seekTo is internal; lock-screen seek uses onSeek */ },
    });

    const host: EngineHost = {
        platformName: () => Capacitor.getPlatform(),
        backendInit: () => backend.init(),
        backendPlay: (text, options) => backend.play(text, options) as Promise<void>,
        backendPreload: async (text, options) => backend.preload(text, options),
        backendPause: async () => backend.pause(),
        backendStop: async () => backend.stop(),
        backendGetVoices: () => backend.getVoices(),
        backendSetLocale: async (locale) => backend.setLocale(locale),
        backendPlayEarcon: async (type) => backend.playEarcon(type),
        backendDownloadVoice: (voiceId) => backend.downloadVoice(voiceId),
        backendDeleteVoice: (voiceId) => backend.deleteVoice(voiceId),
        backendIsVoiceDownloaded: (voiceId) => backend.isVoiceDownloaded(voiceId),
        backendSetProviderById: async (providerId) => backend.setProviderById(providerId),
        platformUpdateMetadata: (metadata) => platform.updateMetadata(metadata),
        platformUpdatePlaybackState: (status) => platform.updatePlaybackState(status),
        platformSetPositionState: (state) => platform.setPositionState(state),
        platformSetBackgroundAudioMode: (mode, isPlaying) => platform.setBackgroundAudioMode(mode, isPlaying),
        platformSetBackgroundVolume: (volume) => platform.setBackgroundVolume(volume),
        platformStop: () => platform.stop(),
        lexiconGetRules: (bookId, language) => LexiconService.getInstance().getRules(bookId, language),
        lexiconGetBiblePreference: (bookId) => LexiconService.getInstance().getBibleLexiconPreference(bookId),
        getContentAnalysis: async (bookId, sectionId) =>
            contentAnalysisRepository.getContentAnalysis(bookId, sectionId),
        getBookMetadata: (bookId) => bookRepository.getBookMetadata(bookId),
        genAIIsConfigured: async () => genAIService.isConfigured(),
        genAIConfigure: (apiKey, model) => genAIService.configure(apiKey, model),
        genAIDetectContentTypes: (nodes, hints, context) =>
            genAIService.detectContentTypes(nodes, hints, context),
        genAIGenerateTableAdaptations: (nodes, thinkingBudget, context) =>
            genAIService.generateTableAdaptations(nodes, thinkingBudget, context),
        applyHostCommand,
    };

    await withWorkerGuard('connect', engine.connect(Comlink.proxy(host)));

    // --- State replication, driven entirely by the declarative spec (replicationSpec.ts). ---
    // Boot snapshots are awaited before this function resolves, so by the time the handle
    // reports ready, every boot slice has been replicated at least once (the worker context
    // throws on reads of never-replicated slices — no silent defaults).
    let currentBookId: string | null = null;
    const slices = createReplicatedSlices({ getCurrentBookId: () => currentBookId });
    for (const slice of slices) {
        for (const update of slice.snapshot()) {
            await engine.applyStateUpdate(update);
        }
    }
    const sliceUnsubs = slices.map((slice) =>
        slice.subscribe((update) => { void engine.applyStateUpdate(update); }));

    // Readiness gate: refuse to hand out the engine unless every boot slice actually landed.
    const bootKinds = slices.filter((s) => s.replication === 'boot').map((s) => s.kind);
    if (!(await engine.hasReplicated(bootKinds))) {
        throw new Error(`TTS worker boot replication incomplete (expected: ${bootKinds.join(', ')})`);
    }

    const setBook = async (bookId: string | null) => {
        currentBookId = bookId;
        if (bookId) {
            // Pre-push the per-book reads the engine performs synchronously inside setBookId.
            for (const update of bookSnapshotUpdates(bookId)) {
                await engine.applyStateUpdate(update);
            }
        }
        engine.setBookId(bookId);
    };

    const subscribe = async (listener: StatusListener): Promise<() => void> => {
        const remoteUnsub = await engine.subscribe(Comlink.proxy(listener));
        return () => { void remoteUnsub(); };
    };

    const dispose = () => {
        try { sliceUnsubs.forEach((unsub) => unsub()); } catch (e) { logger.warn('dispose error', e); }
        worker.terminate();
    };

    return { engine, subscribe, setBook, dispose };
}
