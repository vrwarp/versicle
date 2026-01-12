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
    currentTheme: 'light' | 'dark' | 'sepia';
    customTheme: { bg: string; fg: string };
    fontFamily: string;
    lineHeight: number;
    fontSize: number;
    shouldForceFont: boolean;

    // === ACTIONS (not synced to Yjs) ===
    setTheme: (theme: 'light' | 'dark' | 'sepia') => void;
    setCustomTheme: (theme: { bg: string; fg: string }) => void;
    setFontFamily: (font: string) => void;
    setLineHeight: (height: number) => void;
    setFontSize: (size: number) => void;
    setShouldForceFont: (force: boolean) => void;
}

const defaultPreferences = {
    currentTheme: 'light' as const,
    customTheme: { bg: '#ffffff', fg: '#000000' },
    fontFamily: 'serif',
    lineHeight: 1.5,
    fontSize: 100,
    shouldForceFont: false
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

            setTheme: (theme) => set({ currentTheme: theme }),
            setCustomTheme: (customTheme) => set({ customTheme }),
            setFontFamily: (fontFamily) => set({ fontFamily }),
            setLineHeight: (lineHeight) => set({ lineHeight }),
            setFontSize: (size) => set({ fontSize: size }),
            setShouldForceFont: (force) => set({ shouldForceFont: force }),
        })
    )
);
