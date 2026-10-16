import { create } from 'zustand';
import { defineSyncedStore, type SyncedStoreDef } from './yjs-provider';
import { getDeviceId } from '@lib/device-id';

/**
 * Preferences store state.
 *
 * This store is wrapped with yjs() middleware (see PREFERENCES_STORE_DEF);
 * every device's preferences replicate under its own device-ID key.
 */
interface FontProfile {
    fontSize: number;
    lineHeight: number;
}

interface PreferencesState {
    // === SYNCED STATE (persisted to Yjs) ===
    currentTheme: 'light' | 'dark' | 'sepia';
    customTheme: { bg: string; fg: string };
    fontFamily: string;
    lineHeight: number;
    fontSize: number;
    shouldForceFont: boolean;
    readerViewMode: 'paginated' | 'scrolled';
    libraryLayout: 'grid' | 'list';
    libraryFilterMode: 'all' | 'downloaded';
    librarySortOrder: 'recent' | 'last_read' | 'author' | 'title';
    // There is no `activeContext` key: the library/notes switch is ROUTE
    // state (/ vs /notes). The Y.Map husk old clients keep writing is inert
    // here (absent from syncedKeys = never written, never hydrated) and is
    // pruned by the v9 husk-clear migration.

    // === LANGUAGE SCOPED FONT RENDERING ===
    fontProfiles: Record<string, FontProfile>;

    // === CHINESE READING ===
    forceTraditionalChinese: boolean;
    showPinyin: boolean;
    pinyinSize: number;

    // === PER-BOOK AI CONSENT ===
    /**
     * bookId → whether book content/derived data may be sent to GenAI by
     * NON-interactive flows (the NetworkGateway consent gate consults this
     * through the resolver wired in src/app/google/wireGoogle.ts; policy in
     * src/app/google/aiConsent.ts). Additive field — safe under
     * merge-defaults. Absent entries fall back to grandfathering (books with
     * existing contentAnalysis records) and are otherwise denied until the
     * user answers the per-book consent prompt
     * (src/app/google/aiConsentPrompt.ts) — except that the library-wide
     * pre-embed opt-in grants bulk background embedding.
     */
    aiConsent: Record<string, boolean>;

    // === ACTIONS (not synced to Yjs) ===
    setTheme: (theme: 'light' | 'dark' | 'sepia') => void;
    setCustomTheme: (theme: { bg: string; fg: string }) => void;
    setFontFamily: (font: string) => void;
    setLineHeight: (height: number) => void;
    setFontSize: (size: number) => void;
    setShouldForceFont: (force: boolean) => void;
    setReaderViewMode: (mode: 'paginated' | 'scrolled') => void;
    setLibraryLayout: (layout: 'grid' | 'list') => void;
    setLibraryFilterMode: (mode: 'all' | 'downloaded') => void;
    setLibrarySortOrder: (order: 'recent' | 'last_read' | 'author' | 'title') => void;

    setForceTraditionalChinese: (force: boolean) => void;
    setShowPinyin: (show: boolean) => void;
    setPinyinSize: (size: number) => void;

    setFontProfile: (lang: string, profile: Partial<FontProfile>) => void;

    setAiConsent: (bookId: string, granted: boolean) => void;
}

const defaultPreferences = {
    currentTheme: 'light' as const,
    customTheme: { bg: '#ffffff', fg: '#000000' },
    fontFamily: 'serif',
    lineHeight: 1.5,
    fontSize: 100,
    shouldForceFont: false,
    readerViewMode: 'paginated' as const,
    libraryLayout: 'grid' as const,
    libraryFilterMode: 'all' as const,
    librarySortOrder: 'last_read' as const,

    forceTraditionalChinese: false,
    showPinyin: false,
    pinyinSize: 100,

    fontProfiles: {
        en: { fontSize: 100, lineHeight: 1.5 },
        zh: { fontSize: 120, lineHeight: 1.8 }
    },

    aiConsent: {} as Record<string, boolean>
};

/**
 * Replication declaration (aggregated by src/store/registry.ts).
 * Bound to the keyed map: the flat PreferencesState lives in the nested Y.Map
 * `preferences.<deviceId>`, so consumers read plain store fields.
 * The legacy top-level `preferences/<deviceId>` shares are dead husks (the v6
 * migration copied them in without clearing; v9 empties them) and no new ones
 * are ever created (a new device starts from declared defaults and lazily
 * writes its sub-map). merge-defaults keeps newly added default fields (e.g.
 * fontProfiles) from being wiped when an older doc is hydrated.
 */
export const PREFERENCES_STORE_DEF: SyncedStoreDef<keyof typeof defaultPreferences> = {
    name: 'preferences',
    scope: { key: getDeviceId() },
    syncedKeys: [
        'currentTheme',
        'customTheme',
        'fontFamily',
        'lineHeight',
        'fontSize',
        'shouldForceFont',
        'readerViewMode',
        'libraryLayout',
        'libraryFilterMode',
        'librarySortOrder',
        'fontProfiles',
        'forceTraditionalChinese',
        'showPinyin',
        'pinyinSize',
        'aiConsent',
    ],
    hydration: 'merge-defaults',
    scopedDiff: true,
};

/**
 * Zustand store for user preferences (theme, font, etc.).
 * Wrapped with yjs() middleware for automatic CRDT synchronization.
 *
 * Keyed by device ID so each device maintains its own persistent preferences.
 */
export const usePreferencesStore = create<PreferencesState>()(
    defineSyncedStore(
        PREFERENCES_STORE_DEF,
        (set) => ({
            ...defaultPreferences,

            setTheme: (theme) => set({ currentTheme: theme }),
            setCustomTheme: (customTheme) => set({ customTheme }),
            setFontFamily: (fontFamily) => set({ fontFamily }),
            setLineHeight: (lineHeight) => set({ lineHeight }),
            setFontSize: (size) => set({ fontSize: size }),
            setShouldForceFont: (force) => set({ shouldForceFont: force }),
            setReaderViewMode: (mode) => set({ readerViewMode: mode }),
            setLibraryLayout: (layout) => set({ libraryLayout: layout }),
            setLibraryFilterMode: (mode) => set({ libraryFilterMode: mode }),
            setLibrarySortOrder: (order) => set({ librarySortOrder: order }),

            setForceTraditionalChinese: (force) => set({ forceTraditionalChinese: force }),
            setShowPinyin: (show) => set({ showPinyin: show }),
            setPinyinSize: (size) => set({ pinyinSize: size }),

            setFontProfile: (lang, profile) => set((state) => {
                const current = state.fontProfiles[lang] || { fontSize: state.fontSize, lineHeight: state.lineHeight };
                return {
                    fontProfiles: {
                        ...state.fontProfiles,
                        [lang]: { ...current, ...profile }
                    }
                };
            }),

            setAiConsent: (bookId, granted) => set((state) => ({
                aiConsent: { ...state.aiConsent, [bookId]: granted }
            })),
        })
    )
);
