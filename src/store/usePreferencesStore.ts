import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface PreferencesState {
    currentTheme: 'light' | 'dark' | 'sepia';
    customTheme: { bg: string; fg: string };
    fontFamily: string;
    lineHeight: number;
    fontSize: number;
    shouldForceFont: boolean;

    setTheme: (theme: 'light' | 'dark' | 'sepia') => void;
    setCustomTheme: (theme: { bg: string; fg: string }) => void;
    setFontFamily: (font: string) => void;
    setLineHeight: (height: number) => void;
    setFontSize: (size: number) => void;
    setShouldForceFont: (force: boolean) => void;
}

export const usePreferencesStore = create<PreferencesState>()(
    persist(
        (set) => ({
            currentTheme: 'light',
            customTheme: { bg: '#ffffff', fg: '#000000' },
            fontFamily: 'serif',
            lineHeight: 1.5,
            fontSize: 100,
            shouldForceFont: false,

            setTheme: (theme) => set({ currentTheme: theme }),
            setCustomTheme: (customTheme) => set({ customTheme }),
            setFontFamily: (fontFamily) => set({ fontFamily }),
            setLineHeight: (lineHeight) => set({ lineHeight }),
            setFontSize: (size) => set({ fontSize: size }),
            setShouldForceFont: (force) => set({ shouldForceFont: force }),
        }),
        {
            name: 'reader-preferences',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                currentTheme: state.currentTheme,
                customTheme: state.customTheme,
                fontFamily: state.fontFamily,
                lineHeight: state.lineHeight,
                fontSize: state.fontSize,
                shouldForceFont: state.shouldForceFont,
            }),
        }
    )
);
