import { create } from 'zustand';
import type { NavigationItem } from '../types/db';

interface ReaderUIState {
    isLoading: boolean;
    toc: NavigationItem[];
    immersiveMode: boolean;
    currentSectionTitle: string | null;
    currentSectionId: string | null;
    currentBookId: string | null;
    /** Callback to initiate playback from a specific CFI (registered by ReaderView). */
    playFromSelection?: (cfi: string) => void;

    /** Callback to jump the reader to a specific location (registered by ReaderView). */
    jumpToLocation?: (cfi: string) => void;

    setIsLoading: (isLoading: boolean) => void;
    setToc: (toc: NavigationItem[]) => void;
    setImmersiveMode: (enabled: boolean) => void;
    setCurrentSection: (title: string | null, id: string | null) => void;
    setCurrentBookId: (id: string | null) => void;
    setPlayFromSelection: (callback?: (cfi: string) => void) => void;
    setJumpToLocation: (callback?: (cfi: string) => void) => void;

    reset: () => void;
}

export const useReaderUIStore = create<ReaderUIState>((set) => ({
    isLoading: false,
    toc: [],
    immersiveMode: false,
    currentSectionTitle: null,
    currentSectionId: null,
    currentBookId: null,
    playFromSelection: undefined,
    jumpToLocation: undefined,

    setIsLoading: (isLoading) => set({ isLoading }),
    setToc: (toc) => set({ toc }),
    setImmersiveMode: (enabled) => set({ immersiveMode: enabled }),
    setCurrentSection: (title, id) => set({ currentSectionTitle: title, currentSectionId: id }),
    setCurrentBookId: (id) => set({ currentBookId: id }),
    setPlayFromSelection: (callback) => set({ playFromSelection: callback }),
    setJumpToLocation: (callback) => set({ jumpToLocation: callback }),

    reset: () => set({
        isLoading: false,
        toc: [],
        immersiveMode: false,
        currentSectionTitle: null,
        currentSectionId: null,
        currentBookId: null,
        playFromSelection: undefined,
        jumpToLocation: undefined
    })
}));
