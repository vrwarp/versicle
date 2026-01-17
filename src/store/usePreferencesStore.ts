import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';

/**
 * Preferences store state.
 * 
 * Phase 2 (Yjs Migration): This store is wrapped with yjs() middleware.
 * All preferences are synced across devices automatically.
 */
interface PreferencesState {
    // === SYNCED STATE (persisted to Yjs) ===
    fontFamily: string;
    lineHeight: number;
    fontSize: number;
    shouldForceFont: boolean;
    readerViewMode: 'paginated' | 'scrolled';
    libraryLayout: 'grid' | 'list';

    // === ACTIONS (not synced to Yjs) ===
    setFontFamily: (font: string) => void;
    setLineHeight: (height: number) => void;
    setFontSize: (size: number) => void;
    setShouldForceFont: (force: boolean) => void;
    setReaderViewMode: (mode: 'paginated' | 'scrolled') => void;
    setLibraryLayout: (layout: 'grid' | 'list') => void;
}

const defaultPreferences = {
    fontFamily: 'serif',
    lineHeight: 1.5,
    fontSize: 100,
    shouldForceFont: false,
    readerViewMode: 'paginated' as const,
    libraryLayout: 'grid' as const
};

/**
 * Zustand store for user preferences (theme, font, etc.).
 * Wrapped with yjs() middleware for automatic CRDT synchronization.
 */
export const usePreferencesStore = create<PreferencesState>()(
    yjs(
        yDoc,
        'preferences',
        (set) => ({
            ...defaultPreferences,

            setFontFamily: (fontFamily) => set({ fontFamily }),
            setLineHeight: (lineHeight) => set({ lineHeight }),
            setFontSize: (size) => set({ fontSize: size }),
            setShouldForceFont: (force) => set({ shouldForceFont: force }),
            setReaderViewMode: (mode) => set({ readerViewMode: mode }),
            setLibraryLayout: (layout) => set({ libraryLayout: layout }),
        })
    )
);
