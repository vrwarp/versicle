import { create } from 'zustand';
import yjs from 'zustand-middleware-yjs';
import { yDoc } from './yjs-provider';

/**
 * State interface for the Reader Sync store (Shared).
 * Handles user preferences like theme, font, and size.
 */
interface ReaderSyncState {
    /** The active visual theme of the reader. */
    currentTheme: 'light' | 'dark' | 'sepia';
    /** Custom theme colors. */
    customTheme: { bg: string; fg: string };
    /** Font family (e.g., 'serif', 'sans-serif'). */
    fontFamily: string;
    /** Line height (e.g., 1.5). */
    lineHeight: number;
    /** Font size percentage (e.g., 100). */
    fontSize: number;

    /** Sets the visual theme. */
    setTheme: (theme: 'light' | 'dark' | 'sepia') => void;
    /** Sets the custom theme colors. */
    setCustomTheme: (theme: { bg: string; fg: string }) => void;
    /** Sets the font family. */
    setFontFamily: (font: string) => void;
    /** Sets the line height. */
    setLineHeight: (height: number) => void;
    /** Sets the font size. */
    setFontSize: (size: number) => void;
}

export const useReaderSyncStore = create<ReaderSyncState>()(
    yjs(
        yDoc,
        'settings', // Map name
        (set) => ({
            currentTheme: 'light',
            customTheme: { bg: '#ffffff', fg: '#000000' },
            fontFamily: 'serif',
            lineHeight: 1.5,
            fontSize: 100,

            setTheme: (theme: 'light' | 'dark' | 'sepia') => set({ currentTheme: theme }),
            setCustomTheme: (customTheme: { bg: string; fg: string }) => set({ customTheme }),
            setFontFamily: (fontFamily: string) => set({ fontFamily }),
            setLineHeight: (lineHeight: number) => set({ lineHeight }),
            setFontSize: (size: number) => set({ fontSize: size }),
        })
    )
);

