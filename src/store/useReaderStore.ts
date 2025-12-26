import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { NavigationItem } from 'epubjs';

/**
 * State interface for the Reader store.
 */
interface ReaderState {
  /** Flag indicating if the book content is loading. */
  isLoading: boolean;
  /** The ID of the currently open book. */
  currentBookId: string | null;
  /** The active visual theme of the reader. */
  currentTheme: 'light' | 'dark' | 'sepia' | 'custom';
  /** Custom theme colors. */
  customTheme: { bg: string; fg: string };
  /** Font family (e.g., 'serif', 'sans-serif'). */
  fontFamily: string;
  /** Line height (e.g., 1.5). */
  lineHeight: number;
  /** Font size percentage (e.g., 100). */
  fontSize: number;
  /** Current Canonical Fragment Identifier (CFI) representing the reading position. */
  currentCfi: string | null;
  /** Title of the current section being read. */
  currentSectionTitle: string | null;
  /** ID (href) of the current chapter being read. */
  currentSectionId: string | null;
  /** Reading progress percentage (0-100). */
  progress: number;
  /** Table of Contents for the current book. */
  toc: NavigationItem[];
  /** The viewing mode of the reader. */
  viewMode: 'paginated' | 'scrolled';
  /** Flag for Immersive Mode */
  immersiveMode: boolean;
  /** Whether to force the theme font and ignore book styles. */
  shouldForceFont: boolean;

  /** Callback to initiate playback from a specific CFI (registered by ReaderView). */
  playFromSelection?: (cfi: string) => void;
  /** Registers the playFromSelection callback. */
  setPlayFromSelection: (callback?: (cfi: string) => void) => void;

  /** Sets the loading state. */
  setIsLoading: (isLoading: boolean) => void;
  /** Sets the ID of the current book. */
  setCurrentBookId: (id: string | null) => void;
  /** Sets the visual theme. */
  setTheme: (theme: 'light' | 'dark' | 'sepia' | 'custom') => void;
  /** Sets the custom theme colors. */
  setCustomTheme: (theme: { bg: string; fg: string }) => void;
  /** Sets the font family. */
  setFontFamily: (font: string) => void;
  /** Sets the line height. */
  setLineHeight: (height: number) => void;
  /** Sets the font size. */
  setFontSize: (size: number) => void;
  /**
   * Updates the current reading location.
   * @param cfi - The new CFI location.
   * @param progress - The new progress percentage.
   * @param sectionTitle - Optional title of the new section.
   * @param sectionId - Optional ID (href) of the new chapter.
   */
  updateLocation: (cfi: string, progress: number, sectionTitle?: string, sectionId?: string) => void;
  /** Sets the Table of Contents. */
  setToc: (toc: NavigationItem[]) => void;
  /** Sets the viewing mode. */
  setViewMode: (mode: 'paginated' | 'scrolled') => void;
  /** Sets immersive mode state */
  setImmersiveMode: (enabled: boolean) => void;
  /** Sets whether to force the theme font. */
  setShouldForceFont: (force: boolean) => void;
  /** Resets the reader state to default values. */
  reset: () => void;
}

/**
 * Zustand store for managing the state of the book reader.
 * Controls settings like theme and font size, as well as tracking reading progress and location.
 */
export const useReaderStore = create<ReaderState>()(
  persist(
    (set) => ({
      isLoading: false,
      currentBookId: null,
      currentTheme: 'light',
      customTheme: { bg: '#ffffff', fg: '#000000' },
      fontFamily: 'serif',
      lineHeight: 1.5,
      fontSize: 100,
      currentCfi: null,
      currentSectionTitle: null,
      currentSectionId: null,
      progress: 0,
      toc: [],
      viewMode: 'paginated',
      immersiveMode: false,
      shouldForceFont: false,

      setIsLoading: (isLoading) => set({ isLoading }),
      setCurrentBookId: (id) => set({ currentBookId: id }),
      setTheme: (theme) => set({ currentTheme: theme }),
      setCustomTheme: (customTheme) => set({ customTheme }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      setLineHeight: (lineHeight) => set({ lineHeight }),
      setFontSize: (size) => set({ fontSize: size }),
      updateLocation: (cfi, progress, sectionTitle, sectionId) =>
        set((state) => ({
          currentCfi: cfi,
          progress,
          currentSectionTitle: sectionTitle ?? state.currentSectionTitle,
          currentSectionId: sectionId ?? state.currentSectionId
        })),
      setToc: (toc) => set({ toc }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setImmersiveMode: (enabled) => set({ immersiveMode: enabled }),
      setShouldForceFont: (force) => set({ shouldForceFont: force }),
      setPlayFromSelection: (callback) => set({ playFromSelection: callback }),
      reset: () => set({
        isLoading: false,
        currentBookId: null,
        currentCfi: null,
        currentSectionTitle: null,
        currentSectionId: null,
        progress: 0,
        toc: [],
        immersiveMode: false
      })
    }),
    {
      name: 'reader-storage', // unique name
      storage: createJSONStorage(() => localStorage), // (optional) by default, 'localStorage' is used
      partialize: (state) => ({
        currentTheme: state.currentTheme,
        customTheme: state.customTheme,
        fontFamily: state.fontFamily,
        lineHeight: state.lineHeight,
        fontSize: state.fontSize,
        viewMode: state.viewMode,
        shouldForceFont: state.shouldForceFont,
      }),
    }
  )
);
