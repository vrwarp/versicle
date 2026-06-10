/**
 * EngineContext — the single boundary between the TTS engine core and the host
 * environment (React/Zustand stores, native platform bridges).
 *
 * The engine core (AudioPlayerService, AudioContentPipeline, TableAdaptationProcessor)
 * must reach the outside world ONLY through this interface. It deliberately does NOT
 * abstract `dbService` (IndexedDB) or `genAIService` (fetch) — both are available in a
 * Web Worker, so the core may import them directly. What is abstracted here is exactly
 * the set of dependencies that are NOT worker-safe: the main-thread Zustand stores and
 * the Capacitor native bridge.
 *
 * Two implementations exist:
 *  - `createZustandEngineContext()` — the production wiring. Forwards every call to the
 *    real stores / Capacitor, so behavior is identical to the pre-refactor code and
 *    existing module-level store mocks in tests keep working unchanged.
 *  - `FakeEngineContext` — a deterministic in-memory implementation for unit tests.
 *
 * When the engine later moves into a worker (Phase 5), a third implementation backed by
 * a message port replaces the Zustand one; the engine code does not change because it
 * only ever sees this interface.
 *
 * All argument/return types are derived from the existing store signatures via `typeof`
 * type queries on type-only imports. These imports are erased at runtime and create no
 * runtime dependency, so the core stays worker-portable.
 */
import type { useTTSStore } from '../../../store/useTTSStore';
import type { useGenAIStore } from '../../../store/useGenAIStore';
import type { useReadingStateStore } from '../../../store/useReadingStateStore';
import type { SectionAnalysis, TableAdaptation } from '../../../store/useContentAnalysisStore';
import type { useAnnotationStore } from '../../../store/useAnnotationStore';
import type { useToastStore } from '../../../store/useToastStore';
import type { LexiconRule, ContentAnalysis, BookMetadata } from '../../../types/db';
import type { ContentType } from '../../../types/content-analysis';

// Re-exported so the engine core and helpers (e.g. FakeEngineContext) get all
// engine-boundary types from this one module without re-reaching into the stores.
export type { SectionAnalysis, TableAdaptation, LexiconRule, ContentAnalysis, BookMetadata };

// --- Snapshot / argument types reused verbatim from the existing store signatures ---

/** Full TTS settings snapshot (voice, speed, language, segmentation, lexicon flags). */
export type TTSSettingsSnapshot = ReturnType<typeof useTTSStore.getState>;

/** Full GenAI settings snapshot (enabled flags, skip types, api key, logging). */
export type GenAISettingsSnapshot = ReturnType<typeof useGenAIStore.getState>;

type ReadingStateSnapshot = ReturnType<typeof useReadingStateStore.getState>;
/** Persisted reading progress for a book (queue index, section index, …). */
export type Progress = ReturnType<ReadingStateSnapshot['getProgress']>;
/** The reading-event classification accepted by `addCompletedRange` (e.g. 'tts'). */
export type ReadingEventType = Parameters<ReadingStateSnapshot['addCompletedRange']>[2];

/** The annotation payload accepted by the annotation store's `add`. */
export type AnnotationInput = Parameters<ReturnType<typeof useAnnotationStore.getState>['add']>[0];

/** A single GenAI activity-log entry. */
export type GenAILogEntry = Parameters<GenAISettingsSnapshot['addLog']>[0];

/** Toast severity levels. */
export type ToastType = Parameters<ReturnType<typeof useToastStore.getState>['showToast']>[1];

// --- Ports (grouped by concern) ---

/** TTS user settings + the active language (read/write). */
export interface TTSConfigPort {
    /** The language currently driving voice/segmentation selection. */
    getActiveLanguage(): string;
    /** Update the active language (e.g. when the book's language changes). */
    setActiveLanguage(lang: string): void;
    /** A snapshot of the full TTS settings used by the content pipeline. */
    getSettings(): TTSSettingsSnapshot;
    /** Locale-aware default for minimum sentence length during segmentation. */
    getDefaultMinSentenceLength(lang: string): number;
}

/** The classification result for one content group, as returned by content-type detection. */
export interface ContentTypeDetectionResult {
    classifications: { id: string; type: ContentType }[];
    justification: string;
    agreedWithHeuristic: boolean;
}

/**
 * GenAI settings + activity log + change notifications, plus the model calls themselves.
 *
 * The model calls live on the port (not in the engine) so the GenAI SDK stays on the
 * main thread: the worker context bridges these to the host, which owns the SDK. All
 * arguments and results are structured-cloneable (Blobs included).
 */
export interface GenAIPort {
    getSettings(): GenAISettingsSnapshot;
    addLog(entry: GenAILogEntry): void;
    /** Subscribe to settings changes; returns an unsubscribe function. */
    subscribe(listener: () => void): () => void;
    /** Whether the underlying GenAI client currently holds a usable configuration. */
    isConfigured(): Promise<boolean> | boolean;
    /** Configure the underlying GenAI client (no-op if the host rejects the key). */
    configure(apiKey: string, model: string): void;
    /** Classify content groups (main text vs references/footnotes…) via the model. */
    detectContentTypes(
        nodes: { id: string; sampleText: string; leadsWithMarker?: boolean }[],
        hints: { enumeratorCandidate: number },
        context?: { bookTitle?: string; sectionTitle?: string },
    ): Promise<ContentTypeDetectionResult>;
    /** Generate TTS-friendly narrative adaptations for table images via the model. */
    generateTableAdaptations(
        nodes: { rootCfi: string; imageBlob: Blob }[],
        thinkingBudget: number,
        context?: { bookTitle?: string; sectionTitle?: string },
    ): Promise<{ cfi: string; adaptation: string }[]>;
}

/** Per-book reading progress and completed-range history. */
export interface ReadingStatePort {
    getProgress(bookId: string): Progress;
    updateTTSProgress(bookId: string, queueIndex: number, sectionIndex: number): void;
    addCompletedRange(bookId: string, cfiRange: string, type?: ReadingEventType): void;
    updatePlaybackPosition(bookId: string, lastPlayedCfi: string): void;
}

/** A snapshot of all cached section analyses, keyed by `${bookId}/${sectionId}`. */
export type ContentAnalysisSnapshot = { sections: Record<string, SectionAnalysis> };

/** Cached GenAI content analysis (skip masks, table adaptations) + change stream. */
export interface ContentAnalysisPort {
    getAnalysis(bookId: string, sectionId: string): SectionAnalysis | undefined;
    /**
     * The current snapshot of all analyses. The engine reads from snapshots (pushed via
     * `subscribe` or pulled here) rather than per-key queries, which keeps the data flow
     * serializable and worker-friendly.
     */
    getSnapshot(): ContentAnalysisSnapshot;
    /** Subscribe to analysis updates; the listener receives the new snapshot. Returns an unsubscribe function. */
    subscribe(listener: (state: ContentAnalysisSnapshot) => void): () => void;

    // --- Per-section read/writes (persisted analysis). Async so they work across the worker
    // boundary; the main thread backs these with the content-analysis store via DBService. ---
    /** The fully-resolved persisted analysis for a section (title, refStartCfi, adaptations, status). */
    getContentAnalysis(bookId: string, sectionId: string): Promise<ContentAnalysis | undefined>;
    saveReferenceStartCfi(bookId: string, sectionId: string, referenceStartCfi: string | undefined): void;
    markAnalysisLoading(bookId: string, sectionId: string): void;
    markAnalysisError(bookId: string, sectionId: string, error: string): void;
    saveTableAdaptations(bookId: string, sectionId: string, adaptations: { rootCfi: string; text: string }[]): void;
}

/** Book inventory metadata the engine needs + change stream. */
export interface BookInfoPort {
    getBookLanguage(bookId: string): string;
    /** Full book metadata (title, author, palette, cover, language). Async (worker-boundary-safe). */
    getMetadata(bookId: string): Promise<BookMetadata | undefined>;
    /** Subscribe to book inventory changes; returns an unsubscribe function. */
    subscribe(listener: () => void): () => void;
}

/** Sink for audio-bookmark annotations (the pause→play "Dragnet" capture). */
export interface AnnotationPort {
    add(annotation: AnnotationInput): void;
}

/** User-facing transient notifications. */
export interface NotificationPort {
    showToast(message: string, type?: ToastType): void;
}

/** Reader UI coordination (highlighting the active section as it plays). */
export interface ReaderUIPort {
    setCurrentSection(title: string, sectionId: string): void;
}

/**
 * Pronunciation-lexicon *reads*. The rules are stored in a yjs-backed store on the main thread;
 * this port lets the engine fetch them (async, so it works across the worker boundary) without
 * importing the store. Applying rules to text is done locally via the yjs-free LexiconApplier.
 */
export interface LexiconPort {
    getRules(bookId: string | undefined, language: string): Promise<LexiconRule[]>;
    getBibleLexiconPreference(bookId: string): Promise<'on' | 'off' | 'default'>;
}

/**
 * Native platform detection and capability requests. NOTE: this is distinct from the
 * audio-output `PlatformPort` introduced in Phase 3 — this port is only about *which*
 * platform we're on and one-shot native capability prompts.
 */
export interface PlatformInfoPort {
    /** 'web' | 'ios' | 'android'. */
    getPlatform(): string;
    isNativePlatform(): boolean;
    /** Whether the OS is currently battery-optimizing this app (Android). */
    isBatteryOptimizationEnabled(): Promise<boolean>;
    /** Open the OS battery-optimization settings screen (Android). */
    openBatteryOptimizationSettings(): Promise<void>;
}

/**
 * The aggregate context handed to the engine core. One object, injected at the
 * composition root, carrying every non-worker-safe capability the core needs.
 */
export interface EngineContext {
    config: TTSConfigPort;
    genAI: GenAIPort;
    readingState: ReadingStatePort;
    contentAnalysis: ContentAnalysisPort;
    book: BookInfoPort;
    annotations: AnnotationPort;
    notifications: NotificationPort;
    readerUI: ReaderUIPort;
    lexicon: LexiconPort;
    platform: PlatformInfoPort;
}
