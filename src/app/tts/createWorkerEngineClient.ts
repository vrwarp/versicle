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
 * `createWorkerEngineClient()` once at startup and routing the TtsController through the returned
 * proxy (fire-and-forget calls work unchanged; `subscribe` already returns a Comlink proxy
 * unsubscribe). See PORTING-TO-WORKER.md.
 */
import * as Comlink from 'comlink';
import { Capacitor } from '@capacitor/core';
import { TTSProviderManager } from '@lib/tts/TTSProviderManager';
import { storeProviderBuildContext } from './providerBuildContext';
import { PlatformIntegration } from '@lib/tts/PlatformIntegration';
import { LexiconService } from '@lib/tts/LexiconService';
import { bookRepository } from '../repositories/BookRepository';
import { contentAnalysisRepository } from '../repositories/ContentAnalysisRepository';
import {
    genAIIsConfigured,
    genAIConfigure,
    genAIDetectContentTypes,
    genAIGenerateTableAdaptations,
} from './genaiPort';
import { createReplicatedSlices, bookSnapshotUpdates } from './replicationSpec';
import { useTTSSettingsStore } from '@store/useTTSSettingsStore';
import { useGenAIStore } from '@store/useGenAIStore';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { useAnnotationStore } from '@store/useAnnotationStore';
import { useToastStore } from '@store/useToastStore';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { createLogger } from '@lib/logger';
import type { WorkerTtsEngine, EngineHost } from '@lib/tts/engine/WorkerTtsEngine';
import type { EngineHostCommand } from '@lib/tts/engine/WorkerEngineContext';
import type { SnapshotListener } from '@lib/tts/engine/TtsEngine';

const logger = createLogger('WorkerEngineClient');

/**
 * Apply a worker write command to the real Zustand stores (mirrors createZustandEngineContext).
 * Exported for unit tests — every EngineHostCommand kind must map to the right store/repository
 * call (createWorkerEngineClient.hostCommands.test.ts).
 */
export function applyHostCommand(command: EngineHostCommand): void {
    switch (command.kind) {
        case 'setActiveLanguage': useTTSSettingsStore.getState().setActiveLanguage(command.lang); break;
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
    /** Subscribe to playback snapshots. Wraps the listener as a Comlink proxy automatically. */
    subscribe(listener: SnapshotListener): Promise<() => void>;
    /** Replicate the current language + progress for a book, then set it on the engine. */
    setBook(bookId: string | null): Promise<void>;
    /** Tear down the worker and store subscriptions. */
    dispose(): void;
}

/**
 * Spin up the TTS engine in a Worker and wire it to the main-thread backend + stores.
 */
export async function createWorkerEngineClient(): Promise<WorkerEngineClient> {
    const worker = new Worker(new URL('../../workers/tts.worker.ts', import.meta.url), { type: 'module' });

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

    // The real audio backend lives on the main thread; its events are forwarded into the
    // worker. The build-context source is injected HERE (the composition root) — the
    // manager itself never reads a store (5a-PR3 ctx-passing flip).
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
    }, undefined, storeProviderBuildContext);

    // The real media platform (lock screen / background audio) on the main thread.
    // These logs are the FINAL hop of an OS transport command (notification / lock screen /
    // Bluetooth -> native -> MediaSessionManager -> here -> worker engine). If a control does
    // nothing, check whether the matching line appears (and compare against the native
    // "onMediaAction" emit + the MediaSessionManager "OS->JS onMediaAction" line).
    const platform = new PlatformIntegration({
        onPlay: () => { logger.info('transport play -> engine.play()'); void engine.play(); },
        onPause: () => { logger.info('transport pause -> engine.pause()'); engine.pause(); },
        onStop: () => { logger.info('transport stop -> engine.stop()'); engine.stop(); },
        onPrev: () => { logger.info('transport prev -> engine.skipToPreviousSection()'); void engine.skipToPreviousSection(); },
        onNext: () => { logger.info('transport next -> engine.skipToNextSection()'); void engine.skipToNextSection(); },
        onSeek: (offset) => { logger.info('transport seek -> engine.seek(' + offset + ')'); engine.seek(offset); },
        // Absolute scrubber drag on the OS media notification / lock screen: the native
        // layer emits `seekto` with an absolute time (seconds) in the section-queue domain
        // we publish via setPositionState. Route it to the engine's absolute seek — NOT
        // engine.seek(), whose offset only carries a sign (sentence-step navigation).
        onSeekTo: (time) => { logger.info('transport seekTo -> engine.seekTo(' + time + ')'); engine.seekTo(time); },
        // "Bookmark" custom action on the Android media notification (plugin
        // v4.1.0). Routes to the worker engine, which captures an audio-bookmark
        // at the current location (the same capture the pause→play Dragnet uses).
        onBookmark: () => { logger.info('transport bookmark -> engine.captureBookmark()'); void engine.captureBookmark(); },
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
        lexiconGetCompiled: (bookId, language) => LexiconService.getInstance().getCompiled(bookId, language),
        lexiconGetBiblePreference: (bookId) => LexiconService.getInstance().getBibleLexiconPreference(bookId),
        getContentAnalysis: async (bookId, sectionId) =>
            contentAnalysisRepository.getContentAnalysis(bookId, sectionId),
        getBookMetadata: (bookId) => bookRepository.getBookMetadata(bookId),
        genAIIsConfigured: async () => genAIIsConfigured(),
        genAIConfigure: (apiKey, model) => genAIConfigure(apiKey, model),
        genAIDetectContentTypes: (nodes, hints, context) =>
            genAIDetectContentTypes(nodes, hints, context),
        genAIGenerateTableAdaptations: (nodes, thinkingBudget, context) =>
            genAIGenerateTableAdaptations(nodes, thinkingBudget, context),
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

    const subscribe = async (listener: SnapshotListener): Promise<() => void> => {
        const remoteUnsub = await engine.subscribe(Comlink.proxy(listener));
        return () => { void remoteUnsub(); };
    };

    const dispose = () => {
        try { sliceUnsubs.forEach((unsub) => unsub()); } catch (e) { logger.warn('dispose error', e); }
        worker.terminate();
    };

    return { engine, subscribe, setBook, dispose };
}
