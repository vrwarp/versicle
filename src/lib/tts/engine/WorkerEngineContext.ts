/**
 * WorkerEngineContext — an {@link EngineContext} implementation for running the engine core
 * inside a Web Worker.
 *
 * ## Why this exists
 *
 * `EngineContext` exposes **synchronous** getters (`config.getSettings()`,
 * `config.getActiveLanguage()`, `readingState.getProgress()`, `contentAnalysis.getSnapshot()`,
 * `book.getBookLanguage()`). You cannot satisfy a synchronous getter with an on-demand call
 * across a worker boundary — postMessage is async. The standard fix is **state replication**:
 * the main thread pushes snapshots into the worker; the worker caches them and serves the
 * synchronous getters from the local cache. Writes and side effects flow the other way as
 * fire-and-forget commands.
 *
 * ```
 *  main thread                              worker
 *  ───────────                              ──────
 *  store.subscribe(push) ─ applyUpdate() ─▶ [cache] ─ getSettings()/getProgress()/… ─▶ engine
 *  dispatch(cmd) ◀─ post() ◀──────────────  writes (updateTTSProgress, addAnnotation, …)
 * ```
 *
 * This class is deliberately transport-agnostic and fully unit-testable: feed it
 * {@link EngineStateUpdate}s via {@link applyUpdate} (what the main thread would push) and
 * observe outbound {@link EngineHostCommand}s via the `post` callback (what the host would
 * apply to the real stores). The actual worker entry wires `applyUpdate`/`post` to a message
 * channel (Comlink or raw postMessage).
 */
import type {
    EngineContext,
    TTSSettingsSnapshot,
    GenAISettingsSnapshot,
    GenAILogEntry,
    AnnotationInput,
    Progress,
    ReadingEventType,
    ToastType,
    ContentAnalysisSnapshot,
    SectionAnalysis,
    LexiconRule,
    ContentAnalysis,
    BookMetadata,
} from './EngineContext';

/** Main-thread → worker state replication messages. */
export type EngineStateUpdate =
    | { kind: 'settings'; settings: TTSSettingsSnapshot }
    | { kind: 'genAI'; settings: GenAISettingsSnapshot }
    | { kind: 'activeLanguage'; lang: string }
    | { kind: 'bookLanguage'; bookId: string; lang: string }
    | { kind: 'analysis'; snapshot: ContentAnalysisSnapshot }
    | { kind: 'progress'; bookId: string; progress: Progress };

/** Worker → main-thread side-effect / write commands (fire-and-forget). */
export type EngineHostCommand =
    | { kind: 'setActiveLanguage'; lang: string }
    | { kind: 'updateTTSProgress'; bookId: string; queueIndex: number; sectionIndex: number }
    | { kind: 'addCompletedRange'; bookId: string; cfiRange: string; type?: ReadingEventType }
    | { kind: 'updatePlaybackPosition'; bookId: string; lastPlayedCfi: string }
    | { kind: 'addAnnotation'; annotation: AnnotationInput }
    | { kind: 'showToast'; message: string; type?: ToastType }
    | { kind: 'addGenAILog'; entry: GenAILogEntry }
    | { kind: 'setCurrentSection'; title: string; sectionId: string }
    | { kind: 'saveReferenceStartCfi'; bookId: string; sectionId: string; cfi: string | undefined }
    | { kind: 'markAnalysisLoading'; bookId: string; sectionId: string }
    | { kind: 'markAnalysisError'; bookId: string; sectionId: string; error: string }
    | { kind: 'saveTableAdaptations'; bookId: string; sectionId: string; adaptations: { rootCfi: string; text: string }[] };

export interface WorkerEngineContextOptions {
    /** Outbound channel: deliver a write/side-effect command to the main-thread host. */
    post: (command: EngineHostCommand) => void;
    /** Static platform identity (the worker is told this once at startup). */
    platformName?: string;
    /** Async platform capability checks, proxied to the main thread (e.g. via Comlink). */
    isBatteryOptimizationEnabled?: () => Promise<boolean>;
    openBatteryOptimizationSettings?: () => Promise<void>;
    /** Lexicon rule fetching, proxied to the main thread (which owns the yjs-backed store). */
    getRules?: (bookId: string | undefined, language: string) => Promise<LexiconRule[]>;
    getBibleLexiconPreference?: (bookId: string) => Promise<'on' | 'off' | 'default'>;
    /** Async reads proxied to the main thread (content-analysis + book metadata live in yjs stores). */
    getContentAnalysis?: (bookId: string, sectionId: string) => Promise<ContentAnalysis | undefined>;
    getBookMetadata?: (bookId: string) => Promise<BookMetadata | undefined>;
    /** Locale-aware default; pure, computed locally. Override only for tests. */
    defaultMinSentenceLength?: (lang: string) => number;
}

export class WorkerEngineContext implements EngineContext {
    private readonly post: (command: EngineHostCommand) => void;
    private readonly platformName: string;
    private readonly batteryCheck: () => Promise<boolean>;
    private readonly batteryOpen: () => Promise<void>;
    private readonly fetchRules: (bookId: string | undefined, language: string) => Promise<LexiconRule[]>;
    private readonly fetchBiblePref: (bookId: string) => Promise<'on' | 'off' | 'default'>;
    private readonly fetchContentAnalysis: (bookId: string, sectionId: string) => Promise<ContentAnalysis | undefined>;
    private readonly fetchBookMetadata: (bookId: string) => Promise<BookMetadata | undefined>;
    private readonly minSentenceLength: (lang: string) => number;

    // Replicated state (populated by applyUpdate).
    private settings: TTSSettingsSnapshot | null = null;
    private genAISettings: GenAISettingsSnapshot | null = null;
    private activeLanguage = 'en';
    private bookLanguages: Record<string, string> = {};
    private analysisSnapshot: ContentAnalysisSnapshot = { sections: {} };
    private progressByBook: Record<string, Progress> = {};

    private genAIListeners = new Set<() => void>();
    private bookListeners = new Set<() => void>();
    private analysisListeners = new Set<(s: ContentAnalysisSnapshot) => void>();

    constructor(opts: WorkerEngineContextOptions) {
        this.post = opts.post;
        this.platformName = opts.platformName ?? 'web';
        this.batteryCheck = opts.isBatteryOptimizationEnabled ?? (async () => false);
        this.batteryOpen = opts.openBatteryOptimizationSettings ?? (async () => {});
        this.fetchRules = opts.getRules ?? (async () => []);
        this.fetchBiblePref = opts.getBibleLexiconPreference ?? (async () => 'default');
        this.fetchContentAnalysis = opts.getContentAnalysis ?? (async () => undefined);
        this.fetchBookMetadata = opts.getBookMetadata ?? (async () => undefined);
        this.minSentenceLength = opts.defaultMinSentenceLength ?? ((lang) => (lang.startsWith('zh') ? 6 : 36));
    }

    /** Apply a state snapshot pushed by the main thread, firing the relevant subscribers. */
    applyUpdate(update: EngineStateUpdate): void {
        switch (update.kind) {
            case 'settings':
                this.settings = update.settings;
                break;
            case 'genAI':
                this.genAISettings = update.settings;
                this.genAIListeners.forEach((l) => l());
                break;
            case 'activeLanguage':
                this.activeLanguage = update.lang;
                break;
            case 'bookLanguage':
                this.bookLanguages[update.bookId] = update.lang;
                this.bookListeners.forEach((l) => l());
                break;
            case 'analysis':
                this.analysisSnapshot = update.snapshot;
                this.analysisListeners.forEach((l) => l(this.analysisSnapshot));
                break;
            case 'progress':
                this.progressByBook[update.bookId] = update.progress;
                break;
        }
    }

    config = {
        getActiveLanguage: () => this.activeLanguage,
        setActiveLanguage: (lang: string) => {
            // Optimistically update the local cache so subsequent sync reads are consistent,
            // and tell the host to update the real store.
            this.activeLanguage = lang;
            this.post({ kind: 'setActiveLanguage', lang });
        },
        getSettings: () => {
            if (!this.settings) throw new Error('WorkerEngineContext: settings snapshot not yet replicated');
            return this.settings;
        },
        getDefaultMinSentenceLength: (lang: string) => this.minSentenceLength(lang),
    };

    genAI = {
        getSettings: () => {
            if (!this.genAISettings) throw new Error('WorkerEngineContext: genAI snapshot not yet replicated');
            return this.genAISettings;
        },
        addLog: (entry: GenAILogEntry) => this.post({ kind: 'addGenAILog', entry }),
        subscribe: (listener: () => void) => {
            this.genAIListeners.add(listener);
            return () => this.genAIListeners.delete(listener);
        },
    };

    readingState = {
        getProgress: (bookId: string): Progress => this.progressByBook[bookId] ?? null,
        updateTTSProgress: (bookId: string, queueIndex: number, sectionIndex: number) =>
            this.post({ kind: 'updateTTSProgress', bookId, queueIndex, sectionIndex }),
        addCompletedRange: (bookId: string, cfiRange: string, type?: ReadingEventType) =>
            this.post({ kind: 'addCompletedRange', bookId, cfiRange, type }),
        updatePlaybackPosition: (bookId: string, lastPlayedCfi: string) =>
            this.post({ kind: 'updatePlaybackPosition', bookId, lastPlayedCfi }),
    };

    contentAnalysis = {
        getAnalysis: (bookId: string, sectionId: string): SectionAnalysis | undefined =>
            this.analysisSnapshot.sections[`${bookId}/${sectionId}`],
        getSnapshot: () => this.analysisSnapshot,
        subscribe: (listener: (s: ContentAnalysisSnapshot) => void) => {
            this.analysisListeners.add(listener);
            return () => this.analysisListeners.delete(listener);
        },
        getContentAnalysis: (bookId: string, sectionId: string) => this.fetchContentAnalysis(bookId, sectionId),
        saveReferenceStartCfi: (bookId: string, sectionId: string, cfi: string | undefined) =>
            this.post({ kind: 'saveReferenceStartCfi', bookId, sectionId, cfi }),
        markAnalysisLoading: (bookId: string, sectionId: string) =>
            this.post({ kind: 'markAnalysisLoading', bookId, sectionId }),
        markAnalysisError: (bookId: string, sectionId: string, error: string) =>
            this.post({ kind: 'markAnalysisError', bookId, sectionId, error }),
        saveTableAdaptations: (bookId: string, sectionId: string, adaptations: { rootCfi: string; text: string }[]) =>
            this.post({ kind: 'saveTableAdaptations', bookId, sectionId, adaptations }),
    };

    book = {
        getBookLanguage: (bookId: string) => this.bookLanguages[bookId] || 'en',
        getMetadata: (bookId: string) => this.fetchBookMetadata(bookId),
        subscribe: (listener: () => void) => {
            this.bookListeners.add(listener);
            return () => this.bookListeners.delete(listener);
        },
    };

    annotations = {
        add: (annotation: AnnotationInput) => this.post({ kind: 'addAnnotation', annotation }),
    };

    notifications = {
        showToast: (message: string, type?: ToastType) => this.post({ kind: 'showToast', message, type }),
    };

    readerUI = {
        setCurrentSection: (title: string, sectionId: string) =>
            this.post({ kind: 'setCurrentSection', title, sectionId }),
    };

    lexicon = {
        getRules: (bookId: string | undefined, language: string) => this.fetchRules(bookId, language),
        getBibleLexiconPreference: (bookId: string) => this.fetchBiblePref(bookId),
    };

    platform = {
        getPlatform: () => this.platformName,
        isNativePlatform: () => this.platformName !== 'web',
        isBatteryOptimizationEnabled: () => this.batteryCheck(),
        openBatteryOptimizationSettings: () => this.batteryOpen(),
    };
}
