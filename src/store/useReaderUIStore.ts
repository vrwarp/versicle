import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { NavigationItem } from 'epubjs';

/**
 * State interface for the Reader UI store (Transient).
 * Handles ephemeral state like loading status, view mode, and active book.
 */
interface ReaderUIState {
    /** Flag indicating if the book content is loading. */
    isLoading: boolean;
    /** The ID of the currently open book. */
    currentBookId: string | null;
    /** Title of the current section being read. */
    currentSectionTitle: string | null;
    /** ID (href) of the current chapter being read. */
    currentSectionId: string | null;
    /** Current Canonical Fragment Identifier (CFI) representing the reading position (Transient). */
    currentCfi: string | null;
    /** Reading progress percentage (0-100) (Transient). */
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
    /**
    * Updates the current section info.
    */
    updateSection: (title: string | null, id: string | null) => void;
    /**
     * Updates the current reading location (Transient).
     */
    updateLocation: (cfi: string, progress: number) => void;

    /** Sets the Table of Contents. */
    setToc: (toc: NavigationItem[]) => void;
    /** Sets the viewing mode. */
    setViewMode: (mode: 'paginated' | 'scrolled') => void;
    /** Sets immersive mode state */
    setImmersiveMode: (enabled: boolean) => void;
    /** Sets whether to force the theme font. */
    setShouldForceFont: (force: boolean) => void;

    // --- Popover (Annotation UI) ---
    popover: {
        visible: boolean;
        x: number;
        y: number;
        cfiRange: string;
        text: string;
    };
    showPopover: (x: number, y: number, cfiRange: string, text: string) => void;
    hidePopover: () => void;

    /** Resets the reader state to default values. */
    reset: () => void;
}

export const useReaderUIStore = create<ReaderUIState>()(
    persist(
        (set) => ({
            isLoading: false,
            currentBookId: null,
            currentSectionTitle: null,
            currentSectionId: null,
            currentCfi: null,
            progress: 0,
            toc: [],
            viewMode: 'paginated',
            immersiveMode: false,
            shouldForceFont: false,
            popover: { visible: false, x: 0, y: 0, cfiRange: '', text: '' },

            setIsLoading: (isLoading) => set({ isLoading }),
            setCurrentBookId: (id) => set({ currentBookId: id }),
            updateSection: (title, id) => set((state) => ({
                currentSectionTitle: title ?? state.currentSectionTitle,
                currentSectionId: id ?? state.currentSectionId
            })),
            updateLocation: (cfi, progress) => set({ currentCfi: cfi, progress }),
            setToc: (toc) => set({ toc }),
            setViewMode: (mode) => set({ viewMode: mode }),
            setImmersiveMode: (enabled) => set({ immersiveMode: enabled }),
            setShouldForceFont: (force) => set({ shouldForceFont: force }),
            setPlayFromSelection: (callback) => set({ playFromSelection: callback }),

            showPopover: (x, y, cfiRange, text) => set({ popover: { visible: true, x, y, cfiRange, text } }),
            hidePopover: () => set((state) => ({ popover: { ...state.popover, visible: false } })),

            reset: () => set({
                isLoading: false,
                currentBookId: null,
                currentSectionTitle: null,
                currentSectionId: null,
                currentCfi: null,
                progress: 0,
                toc: [],
                immersiveMode: false,
                popover: { visible: false, x: 0, y: 0, cfiRange: '', text: '' }
            })
        }),
        {
            name: 'reader-ui-storage',
            storage: createJSONStorage(() => localStorage),
            partialize: (state) => ({
                viewMode: state.viewMode,
                shouldForceFont: state.shouldForceFont,
            }),
        }
    )
);
