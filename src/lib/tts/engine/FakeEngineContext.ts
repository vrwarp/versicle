/**
 * FakeEngineContext — a deterministic, dependency-free EngineContext for unit tests.
 *
 * Lets a test drive the engine core without jsdom, Zustand, or module mocks: configure
 * settings via the public fields, push analysis/book changes via `emit*`, and inspect
 * what the engine wrote via the public log arrays.
 *
 * It is intentionally permissive (sensible defaults, every method a no-op unless it
 * records something) so tests opt into only the surface they care about.
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
    SectionAnalysis,
    LexiconRule,
    ContentAnalysis,
    BookMetadata,
} from './EngineContext';

type AnalysisListener = (state: { sections: Record<string, SectionAnalysis> }) => void;

export class FakeEngineContext implements EngineContext {
    // --- Configurable inputs ---
    activeLanguage = 'en';
    ttsSettings: Partial<TTSSettingsSnapshot> = {};
    genAISettings: Partial<GenAISettingsSnapshot> = {};
    /** keyed by `${bookId}` → raw book language. */
    bookLanguages: Record<string, string> = {};
    /** keyed by `${bookId}/${sectionId}` → analysis. */
    analyses: Record<string, SectionAnalysis> = {};
    progress: Record<string, Progress> = {};
    platformName = 'web';
    batteryOptimizationEnabled = false;
    minSentenceLengthByLang: (lang: string) => number = (lang) => (lang.startsWith('zh') ? 6 : 36);

    // --- Recorded outputs (assert against these) ---
    readonly toasts: Array<{ message: string; type?: ToastType }> = [];
    readonly addedAnnotations: AnnotationInput[] = [];
    readonly genAILogs: GenAILogEntry[] = [];
    readonly ttsProgressWrites: Array<{ bookId: string; queueIndex: number; sectionIndex: number }> = [];
    readonly completedRanges: Array<{ bookId: string; cfiRange: string; type?: ReadingEventType }> = [];
    readonly playbackPositions: Array<{ bookId: string; lastPlayedCfi: string }> = [];
    readonly sectionTitles: Array<{ title: string; sectionId: string }> = [];
    readonly openedBatterySettings: number[] = [];

    private genAIListeners = new Set<() => void>();
    private analysisListeners = new Set<AnalysisListener>();
    private bookListeners = new Set<() => void>();

    config = {
        getActiveLanguage: () => this.activeLanguage,
        setActiveLanguage: (lang: string) => {
            this.activeLanguage = lang;
        },
        getSettings: () => this.ttsSettings as TTSSettingsSnapshot,
        getDefaultMinSentenceLength: (lang: string) => this.minSentenceLengthByLang(lang),
    };

    genAI = {
        getSettings: () => this.genAISettings as GenAISettingsSnapshot,
        addLog: (entry: GenAILogEntry) => {
            this.genAILogs.push(entry);
        },
        subscribe: (listener: () => void) => {
            this.genAIListeners.add(listener);
            return () => this.genAIListeners.delete(listener);
        },
    };

    readingState = {
        getProgress: (bookId: string) => this.progress[bookId] ?? null,
        updateTTSProgress: (bookId: string, queueIndex: number, sectionIndex: number) => {
            this.ttsProgressWrites.push({ bookId, queueIndex, sectionIndex });
        },
        addCompletedRange: (bookId: string, cfiRange: string, type?: ReadingEventType) => {
            this.completedRanges.push({ bookId, cfiRange, type });
        },
        updatePlaybackPosition: (bookId: string, lastPlayedCfi: string) => {
            this.playbackPositions.push({ bookId, lastPlayedCfi });
        },
    };

    /** keyed by `${bookId}/${sectionId}` → persisted ContentAnalysis (the getContentAnalysis result). */
    contentAnalyses: Record<string, ContentAnalysis> = {};
    readonly savedReferenceCfis: Array<{ bookId: string; sectionId: string; cfi: string | undefined }> = [];
    readonly savedTableAdaptations: Array<{ bookId: string; sectionId: string; adaptations: { rootCfi: string; text: string }[] }> = [];

    contentAnalysis = {
        getAnalysis: (bookId: string, sectionId: string) => this.analyses[`${bookId}/${sectionId}`],
        getSnapshot: () => ({ sections: this.analyses }),
        subscribe: (listener: AnalysisListener) => {
            this.analysisListeners.add(listener);
            return () => this.analysisListeners.delete(listener);
        },
        getContentAnalysis: async (bookId: string, sectionId: string) => this.contentAnalyses[`${bookId}/${sectionId}`],
        saveReferenceStartCfi: (bookId: string, sectionId: string, cfi: string | undefined) => {
            this.savedReferenceCfis.push({ bookId, sectionId, cfi });
        },
        markAnalysisLoading: () => {},
        markAnalysisError: () => {},
        saveTableAdaptations: (bookId: string, sectionId: string, adaptations: { rootCfi: string; text: string }[]) => {
            this.savedTableAdaptations.push({ bookId, sectionId, adaptations });
        },
    };

    /** keyed by bookId → full BookMetadata (the getMetadata result). */
    bookMetadata: Record<string, BookMetadata> = {};
    book = {
        getBookLanguage: (bookId: string) => this.bookLanguages[bookId] || 'en',
        getMetadata: async (bookId: string) => this.bookMetadata[bookId],
        subscribe: (listener: () => void) => {
            this.bookListeners.add(listener);
            return () => this.bookListeners.delete(listener);
        },
    };

    annotations = {
        add: (annotation: AnnotationInput) => {
            this.addedAnnotations.push(annotation);
        },
    };

    notifications = {
        showToast: (message: string, type?: ToastType) => {
            this.toasts.push({ message, type });
        },
    };

    readerUI = {
        setCurrentSection: (title: string, sectionId: string) => {
            this.sectionTitles.push({ title, sectionId });
        },
    };

    lexiconRules: LexiconRule[] = [];
    biblePreference: 'on' | 'off' | 'default' = 'default';
    lexicon = {
        getRules: async () => this.lexiconRules,
        getBibleLexiconPreference: async () => this.biblePreference,
    };

    platform = {
        getPlatform: () => this.platformName,
        isNativePlatform: () => this.platformName !== 'web',
        isBatteryOptimizationEnabled: async () => this.batteryOptimizationEnabled,
        openBatteryOptimizationSettings: async () => {
            this.openedBatterySettings.push(Date.now());
        },
    };

    // --- Test-side triggers for the subscription ports ---
    emitGenAIChange() {
        this.genAIListeners.forEach((l) => l());
    }
    emitAnalysisChange() {
        this.analysisListeners.forEach((l) => l({ sections: this.analyses }));
    }
    emitBookChange() {
        this.bookListeners.forEach((l) => l());
    }
}
