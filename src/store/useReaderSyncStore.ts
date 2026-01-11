import { create } from 'zustand';
import { yjsMiddleware } from './middleware/yjs';
import { yDoc, persistence } from './yjs-provider';
import * as Y from 'yjs';

/**
 * State interface for the Reader Sync store.
 * Manages global persistent settings like theme and font.
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

/**
 * Zustand store for managing the synced state of the book reader.
 * Uses Yjs to sync settings across devices.
 */
export const useReaderSyncStore = create<ReaderSyncState>()(
  yjsMiddleware(yDoc, 'reader-settings', (set) => ({
    currentTheme: 'light',
    customTheme: { bg: '#ffffff', fg: '#000000' },
    fontFamily: 'serif',
    lineHeight: 1.5,
    fontSize: 100,

    setTheme: (theme) => set({ currentTheme: theme }),
    setCustomTheme: (customTheme) => set({ customTheme }),
    setFontFamily: (fontFamily) => set({ fontFamily }),
    setLineHeight: (lineHeight) => set({ lineHeight }),
    setFontSize: (size) => set({ fontSize: size }),
  }))
);
