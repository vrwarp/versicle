import { create } from 'zustand';
import type { NavigationItem } from 'epubjs';

interface ReaderState {
  isLoading: boolean;
  currentBookId: string | null;
  currentTheme: 'light' | 'dark' | 'sepia';
  fontSize: number; // percentage, e.g. 100
  currentCfi: string | null;
  currentChapterTitle: string | null;
  progress: number; // 0-100
  toc: NavigationItem[];

  setIsLoading: (isLoading: boolean) => void;
  setCurrentBookId: (id: string | null) => void;
  setTheme: (theme: 'light' | 'dark' | 'sepia') => void;
  setFontSize: (size: number) => void;
  updateLocation: (cfi: string, progress: number, chapterTitle?: string) => void;
  setToc: (toc: NavigationItem[]) => void;
  reset: () => void;
}

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
