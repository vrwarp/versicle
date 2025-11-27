import { create } from 'zustand';
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
  currentTheme: 'light' | 'dark' | 'sepia';
  /** Font size percentage (e.g., 100). */
  fontSize: number;
  /** Current Canonical Fragment Identifier (CFI) representing the reading position. */
  currentCfi: string | null;
  /** Title of the current chapter being read. */
  currentChapterTitle: string | null;
  /** Reading progress percentage (0-100). */
  progress: number;
  /** Table of Contents for the current book. */
  toc: NavigationItem[];

  /** Sets the loading state. */
  setIsLoading: (isLoading: boolean) => void;
  /** Sets the ID of the current book. */
  setCurrentBookId: (id: string | null) => void;
  /** Sets the visual theme. */
  setTheme: (theme: 'light' | 'dark' | 'sepia') => void;
  /** Sets the font size. */
  setFontSize: (size: number) => void;
  /**
   * Updates the current reading location.
   * @param cfi - The new CFI location.
   * @param progress - The new progress percentage.
   * @param chapterTitle - Optional title of the new chapter.
   */
  updateLocation: (cfi: string, progress: number, chapterTitle?: string) => void;
  /** Sets the Table of Contents. */
  setToc: (toc: NavigationItem[]) => void;
  /** Resets the reader state to default values. */
  reset: () => void;
}

/**
 * Zustand store for managing the state of the book reader.
 * Controls settings like theme and font size, as well as tracking reading progress and location.
 */
export const useReaderStore = create<ReaderState>((set) => ({
  isLoading: false,
  currentBookId: null,
  currentTheme: 'light',
  fontSize: 100,
  currentCfi: null,
  currentChapterTitle: null,
  progress: 0,
  toc: [],

  setIsLoading: (isLoading) => set({ isLoading }),
  setCurrentBookId: (id) => set({ currentBookId: id }),
  setTheme: (theme) => set({ currentTheme: theme }),
  setFontSize: (size) => set({ fontSize: size }),
  updateLocation: (cfi, progress, chapterTitle) =>
    set((state) => ({
      currentCfi: cfi,
      progress,
      currentChapterTitle: chapterTitle ?? state.currentChapterTitle
    })),
  setToc: (toc) => set({ toc }),
  reset: () => set({
    isLoading: false,
    currentBookId: null,
    currentCfi: null,
    currentChapterTitle: null,
    progress: 0,
    toc: []
  })
}));
