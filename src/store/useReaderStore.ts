import { create } from 'zustand';
import type { NavItem } from 'epubjs';

interface ReaderState {
  currentBookId: string | null;
  isLoading: boolean;
  currentCfi: string | null;
  toc: NavItem[];
  currentChapterTitle: string | null;
  progress: number; // 0 to 1

  actions: {
    setCurrentBookId: (id: string | null) => void;
    setIsLoading: (loading: boolean) => void;
    setCurrentCfi: (cfi: string | null) => void;
    setToc: (toc: NavItem[]) => void;
    setCurrentChapterTitle: (title: string | null) => void;
    setProgress: (progress: number) => void;
    reset: () => void;
  };
}

export const useReaderStore = create<ReaderState>((set) => ({
  currentBookId: null,
  isLoading: false,
  currentCfi: null,
  toc: [],
  currentChapterTitle: null,
  progress: 0,

  actions: {
    setCurrentBookId: (id) => set({ currentBookId: id }),
    setIsLoading: (loading) => set({ isLoading: loading }),
    setCurrentCfi: (cfi) => set({ currentCfi: cfi }),
    setToc: (toc) => set({ toc }),
    setCurrentChapterTitle: (title) => set({ currentChapterTitle: title }),
    setProgress: (progress) => set({ progress }),
    reset: () =>
      set({
        currentBookId: null,
        isLoading: false,
        currentCfi: null,
        toc: [],
        currentChapterTitle: null,
        progress: 0,
      }),
  },
}));
