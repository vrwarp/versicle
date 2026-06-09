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
import { WebSpeechProvider } from '../providers/WebSpeechProvider';
import { CapacitorTTSProvider } from '../providers/CapacitorTTSProvider';
import { GoogleTTSProvider } from '../providers/GoogleTTSProvider';
import { OpenAIProvider } from '../providers/OpenAIProvider';
import { LemonFoxProvider } from '../providers/LemonFoxProvider';
import { PiperProvider } from '../providers/PiperProvider';
import { useTTSStore } from '../../../store/useTTSStore';
import { useGenAIStore } from '../../../store/useGenAIStore';
import { useContentAnalysisStore } from '../../../store/useContentAnalysisStore';
import { useBookStore } from '../../../store/useBookStore';
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
 * Strip non-structured-cloneable values before crossing the worker boundary. Zustand
 * `getState()` snapshots carry action functions (and the selected voice carries a live
 * SpeechSynthesisVoice); a JSON round-trip drops those, leaving the plain data the engine reads.
 */
function plain<T>(value: T): T {
    return JSON.parse(JSON.stringify(value));
}

function buildProviderById(id: string) {
    switch (id) {
        case 'google': return new GoogleTTSProvider();
        case 'openai': return new OpenAIProvider();
        case 'lemonfox': return new LemonFoxProvider();
        case 'piper': return new PiperProvider();
        default: return Capacitor.isNativePlatform() ? new CapacitorTTSProvider() : new WebSpeechProvider();
    }
}

/** Apply a worker write command to the real Zustand stores (mirrors createZustandEngineContext). */
function applyHostCommand(command: EngineHostCommand): void {
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
    }
}

export interface WorkerEngineClient {
    /** Comlink proxy to the worker-resident engine. */
    engine: Comlink.Remote<WorkerTtsEngine>;
    /** Subscribe to playback updates. Wraps the listener as a Comlink proxy automatically. */
    subscribe(listener: StatusListener): Promise<() => void>;
    /** Replicate the current language + progress for a book, then set it on the engine. */
    setBook(bookId: string | null): Promise<void>;
    /** Switch the active provider by id (live provider objects can't cross the worker boundary). */
    setProviderById(providerId: string): void;
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
        onBoundary: (charIndex) => { void engine.dispatchBackendEvent({ type: 'boundary', charIndex }); },
        onMeta: (alignment) => { void engine.dispatchBackendEvent({ type: 'meta', alignment }); },
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
        // Drop `originalVoice` (a live SpeechSynthesisVoice) — it can't cross the worker
        // boundary, and the worker only needs the serializable voice metadata + id.
        backendGetVoices: async () =>
            (await backend.getVoices()).map((v) => ({ id: v.id, name: v.name, lang: v.lang, provider: v.provider })),
        backendSetLocale: async (locale) => backend.setLocale(locale),
        backendPlayEarcon: async (type) => backend.playEarcon(type),
        backendDownloadVoice: (voiceId) => backend.downloadVoice(voiceId),
        backendDeleteVoice: (voiceId) => backend.deleteVoice(voiceId),
        backendIsVoiceDownloaded: (voiceId) => backend.isVoiceDownloaded(voiceId),
        backendSetProviderById: async (providerId) => backend.setProvider(buildProviderById(providerId)),
        platformUpdateMetadata: (metadata) => platform.updateMetadata(metadata),
        platformUpdatePlaybackState: (status) => platform.updatePlaybackState(status),
        platformSetPositionState: (state) => platform.setPositionState(state),
        platformSetBackgroundAudioMode: (mode, isPlaying) => platform.setBackgroundAudioMode(mode, isPlaying),
        platformSetBackgroundVolume: (volume) => platform.setBackgroundVolume(volume),
        platformStop: () => platform.stop(),
        lexiconGetRules: (bookId, language) => LexiconService.getInstance().getRules(bookId, language),
        lexiconGetBiblePreference: (bookId) => LexiconService.getInstance().getBibleLexiconPreference(bookId),
        applyHostCommand,
    };

    await withWorkerGuard('connect', engine.connect(Comlink.proxy(host)));

    // --- State replication: push the current snapshots (plain data only), then keep them live. ---
    await engine.applyStateUpdate({ kind: 'settings', settings: plain(useTTSStore.getState()) });
    await engine.applyStateUpdate({ kind: 'genAI', settings: plain(useGenAIStore.getState()) });
    await engine.applyStateUpdate({ kind: 'activeLanguage', lang: useTTSStore.getState().activeLanguage });
    await engine.applyStateUpdate({ kind: 'analysis', snapshot: { sections: plain(useContentAnalysisStore.getState().sections) } });

    let lastActiveLanguage = useTTSStore.getState().activeLanguage;
    const unsubTTS = useTTSStore.subscribe((state) => {
        void engine.applyStateUpdate({ kind: 'settings', settings: plain(state) });
        if (state.activeLanguage !== lastActiveLanguage) {
            lastActiveLanguage = state.activeLanguage;
            void engine.applyStateUpdate({ kind: 'activeLanguage', lang: state.activeLanguage });
        }
    });
    const unsubGenAI = useGenAIStore.subscribe((state) => {
        void engine.applyStateUpdate({ kind: 'genAI', settings: plain(state) });
    });
    const unsubAnalysis = useContentAnalysisStore.subscribe((state) => {
        void engine.applyStateUpdate({ kind: 'analysis', snapshot: { sections: plain(state.sections) } });
    });
    const unsubBook = useBookStore.subscribe((state) => {
        for (const [bookId, book] of Object.entries(state.books)) {
            void engine.applyStateUpdate({ kind: 'bookLanguage', bookId, lang: book?.language || 'en' });
        }
    });

    const setBook = async (bookId: string | null) => {
        if (bookId) {
            // Pre-push the per-book reads the engine performs synchronously inside setBookId.
            const lang = useBookStore.getState().books[bookId]?.language || 'en';
            await engine.applyStateUpdate({ kind: 'bookLanguage', bookId, lang });
            const progress = useReadingStateStore.getState().getProgress(bookId);
            await engine.applyStateUpdate({ kind: 'progress', bookId, progress: plain(progress) });
        }
        engine.setBookId(bookId);
    };

    const subscribe = async (listener: StatusListener): Promise<() => void> => {
        const remoteUnsub = await engine.subscribe(Comlink.proxy(listener));
        return () => { void remoteUnsub(); };
    };

    const setProviderById = (providerId: string) => {
        // Stop the worker engine, then swap the real (main-thread) backend provider.
        engine.stop();
        backend.setProvider(buildProviderById(providerId));
    };

    const dispose = () => {
        try { unsubTTS(); unsubGenAI(); unsubAnalysis(); unsubBook(); } catch (e) { logger.warn('dispose error', e); }
        worker.terminate();
    };

    return { engine, subscribe, setBook, setProviderById, dispose };
}
