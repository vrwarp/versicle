import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc, getYjsOptions } from './yjs-provider';
import { getDeviceId } from '../lib/device-id';

/**
 * Preferences store state.
 * 
 * Phase 2 (Yjs Migration): This store is wrapped with yjs() middleware.
 * All preferences are synced across devices automatically.
 */
export interface FontProfile {
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
    activeContext: 'library' | 'notes';

    // === LANGUAGE SCOPED FONT RENDERING ===
    fontProfiles: Record<string, FontProfile>;

    // === CHINESE READING ===
    forceTraditionalChinese: boolean;
    showPinyin: boolean;
    pinyinSize: number;

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
    setActiveContext: (context: 'library' | 'notes') => void;

    setForceTraditionalChinese: (force: boolean) => void;
    setShowPinyin: (show: boolean) => void;
    setPinyinSize: (size: number) => void;

    setFontProfile: (lang: string, profile: Partial<FontProfile>) => void;
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
    activeContext: 'library' as const,

    forceTraditionalChinese: false,
    showPinyin: false,
    pinyinSize: 100,

    fontProfiles: {
        en: { fontSize: 100, lineHeight: 1.5 },
        zh: { fontSize: 110, lineHeight: 1.8 }
    }
};

/**
 * Zustand store for user preferences (theme, font, etc.).
 * Wrapped with yjs() middleware for automatic CRDT synchronization.
 *
 * Keyed by device ID so each device maintains its own persistent preferences.
 */
export const usePreferencesStore = create<PreferencesState>()(
    yjs(
        yDoc,
        `preferences/${getDeviceId()}`,
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
            setActiveContext: (context) => set({ activeContext: context }),

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
        }),
        getYjsOptions()
    )
);
