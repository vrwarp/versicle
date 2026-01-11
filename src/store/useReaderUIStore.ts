import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { NavigationItem } from 'epubjs';

/**
 * State interface for the Reader UI store (Transient).
 * Manages strictly local, ephemeral state like loading status,
 * current book ID for the session, and TOC.
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
   * Updates the current reading location metadata (Title/ID).
   * Note: Actual CFI progress is synced via Yjs in useReaderSyncStore/useLibraryStore.
   */
  updateLocationMetadata: (sectionTitle?: string, sectionId?: string) => void;
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

export const useReaderUIStore = create<ReaderUIState>()(
  persist(
    (set) => ({
      isLoading: false,
      currentBookId: null,
      currentSectionTitle: null,
      currentSectionId: null,
      toc: [],
      viewMode: 'paginated',
      immersiveMode: false,
      shouldForceFont: false,

      setIsLoading: (isLoading) => set({ isLoading }),
      setCurrentBookId: (id) => set({ currentBookId: id }),
      updateLocationMetadata: (sectionTitle, sectionId) => {
        set((state) => ({
          currentSectionTitle: sectionTitle ?? state.currentSectionTitle,
          currentSectionId: sectionId ?? state.currentSectionId
        }));
      },
      setToc: (toc) => set({ toc }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setImmersiveMode: (enabled) => set({ immersiveMode: enabled }),
      setShouldForceFont: (force) => set({ shouldForceFont: force }),
      setPlayFromSelection: (callback) => set({ playFromSelection: callback }),
      reset: () => set({
        isLoading: false,
        currentBookId: null,
        currentSectionTitle: null,
        currentSectionId: null,
        toc: [],
        immersiveMode: false
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
