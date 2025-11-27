import { create } from 'zustand';

interface ReaderState {
  currentBookId: string | null;
  isLoading: boolean;
  setCurrentBookId: (id: string | null) => void;
}

export const useReaderStore = create<ReaderState>((set) => ({
  currentBookId: null,
  isLoading: false,
  setCurrentBookId: (id) => set({ currentBookId: id }),
}));
