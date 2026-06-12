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
    TTSSettingsData,
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
    GenAIPort,
} from './EngineContext';

/** Main-thread → worker state replication messages. */
export type EngineStateUpdate =
    | { kind: 'settings'; settings: TTSSettingsData }
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
    /** GenAI model calls, proxied to the main thread (which owns the SDK). */
    genAIIsConfigured?: () => Promise<boolean>;
    genAIConfigure?: (apiKey: string, model: string) => void;
    genAIDetectContentTypes?: GenAIPort['detectContentTypes'];
    genAIGenerateTableAdaptations?: GenAIPort['generateTableAdaptations'];
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
    private readonly genAIIsConfiguredFn: () => Promise<boolean>;
    private readonly genAIConfigureFn: (apiKey: string, model: string) => void;
    private readonly genAIDetectFn: GenAIPort['detectContentTypes'];
    private readonly genAIAdaptFn: GenAIPort['generateTableAdaptations'];
    private readonly minSentenceLength: (lang: string) => number;

    // Replicated state (populated by applyUpdate). Boot slices start as `null` — "never
    // replicated" — and their getters THROW rather than serve a silent default, so a missing
    // pusher is a loud bug, not stale data. Per-book slices are keyed caches; the client
    // pre-pushes the active book's entries before setBookId.
    private settings: TTSSettingsData | null = null;
    private genAISettings: GenAISettingsSnapshot | null = null;
    private activeLanguage: string | null = null;
    private bookLanguages: Record<string, string> = {};
    private analysisSnapshot: ContentAnalysisSnapshot | null = null;
    private progressByBook: Record<string, Progress> = {};
    /** Which update kinds have been replicated at least once (diagnostics + readiness). */
    readonly receivedKinds = new Set<EngineStateUpdate['kind']>();

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
        this.genAIIsConfiguredFn = opts.genAIIsConfigured ?? (async () => false);
        this.genAIConfigureFn = opts.genAIConfigure ?? (() => {});
        this.genAIDetectFn = opts.genAIDetectContentTypes ??
            (async () => ({ classifications: [], justification: '', agreedWithHeuristic: false }));
        this.genAIAdaptFn = opts.genAIGenerateTableAdaptations ?? (async () => []);
        this.minSentenceLength = opts.defaultMinSentenceLength ?? ((lang) => (lang.startsWith('zh') ? 6 : 36));
    }

    /** Apply a state snapshot pushed by the main thread, firing the relevant subscribers. */
    applyUpdate(update: EngineStateUpdate): void {
        this.receivedKinds.add(update.kind);
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
                this.analysisListeners.forEach((l) => l(update.snapshot));
                break;
            case 'progress':
                this.progressByBook[update.bookId] = update.progress;
                break;
            default: {
                // Compile-time exhaustiveness: a new EngineStateUpdate kind without a handler
                // here fails to typecheck instead of being silently dropped.
                const unhandled: never = update;
                throw new Error(`WorkerEngineContext: unhandled state update ${JSON.stringify(unhandled)}`);
            }
        }
    }

    /** Loud accessor for a boot-replicated slice: throwing beats serving a silent default. */
    private replicated<T>(value: T | null, kind: EngineStateUpdate['kind']): T {
        if (value === null) {
            throw new Error(
                `WorkerEngineContext: '${kind}' was never replicated — the host must push it before the engine reads it (see replicationSpec.ts)`,
            );
        }
        return value;
    }

    config = {
        getActiveLanguage: () => this.replicated(this.activeLanguage, 'activeLanguage'),
        setActiveLanguage: (lang: string) => {
            // Optimistically update the local cache so subsequent sync reads are consistent,
            // and tell the host to update the real store.
            this.activeLanguage = lang;
            this.post({ kind: 'setActiveLanguage', lang });
        },
        getSettings: () => this.replicated(this.settings, 'settings'),
        getDefaultMinSentenceLength: (lang: string) => this.minSentenceLength(lang),
    };

    genAI = {
        getSettings: () => this.replicated(this.genAISettings, 'genAI'),
        addLog: (entry: GenAILogEntry) => this.post({ kind: 'addGenAILog', entry }),
        subscribe: (listener: () => void) => {
            this.genAIListeners.add(listener);
            return () => this.genAIListeners.delete(listener);
        },
        // Model calls bridge to the main thread, which owns the GenAI SDK.
        isConfigured: () => this.genAIIsConfiguredFn(),
        configure: (apiKey: string, model: string) => this.genAIConfigureFn(apiKey, model),
        detectContentTypes: (
            nodes: { id: string; sampleText: string; leadsWithMarker?: boolean }[],
            hints: { enumeratorCandidate: number },
            context?: { bookTitle?: string; sectionTitle?: string },
        ) => this.genAIDetectFn(nodes, hints, context),
        generateTableAdaptations: (
            nodes: { rootCfi: string; imageBlob: Blob }[],
            thinkingBudget: number,
            context?: { bookTitle?: string; sectionTitle?: string },
        ) => this.genAIAdaptFn(nodes, thinkingBudget, context),
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
            this.replicated(this.analysisSnapshot, 'analysis').sections[`${bookId}/${sectionId}`],
        getSnapshot: () => this.replicated(this.analysisSnapshot, 'analysis'),
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
        getBookLanguage: (bookId: string) => {
            const lang = this.bookLanguages[bookId];
            if (lang === undefined) {
                // Per-book slice: the client pre-pushes the active book before setBookId, so a
                // miss means a replication gap — be loud about it, then fall back.
                console.warn(`WorkerEngineContext: no replicated language for book ${bookId}; defaulting to 'en'`);
                return 'en';
            }
            return lang;
        },
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
