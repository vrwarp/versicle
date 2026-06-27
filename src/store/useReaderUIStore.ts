import { create } from 'zustand';
import type { NavigationItem } from '~types/book';

import type { Annotation } from '~types/user-data';

interface CompassState {
    variant?: 'active' | 'summary' | 'compact' | 'annotation' | 'sync-alert' | 'audio-triage' | 'vocab-triage';
    targetAnnotation?: Annotation;
}

/**
 * UI state for the annotation selection popover.
 * Ephemeral, device-local state: it lives in this non-synced, non-persisted store
 * so that opening/closing the popover never writes to the Yjs CRDT
 * (it previously lived in the synced useAnnotationStore and leaked screen
 * coordinates to other devices).
 */
interface AnnotationPopoverState {
    visible: boolean;
    x: number;
    y: number;
    cfiRange: string;
    text: string;
    id?: string;
}

const INITIAL_POPOVER_STATE: AnnotationPopoverState = {
    visible: false,
    x: 0,
    y: 0,
    cfiRange: '',
    text: '',
};

interface ReaderUIState {
    isLoading: boolean;
    toc: NavigationItem[];
    immersiveMode: boolean;
    currentSectionTitle: string | null;
    currentSectionId: string | null;
    currentBookId: string | null;
    /**
     * Whether the reader auto-follows the spoken sentence during TTS playback
     * (the "navigation" behavior). Like a maps app: ON by default, it
     * re-centers the page on each sentence; the moment the user manually
     * scrolls away it flips OFF, and the AudioPill's re-center button turns it
     * back ON (snapping to the current sentence). Reset to ON when a fresh
     * playback session starts. Ephemeral, device-local — never synced.
     */
    followingAudio: boolean;
    // (The playFromSelection/jumpToLocation callback fields died with
    // Phase 6 §5a: commands live in the ReaderCommands context/registry —
    // this store keeps DATA state only.)

    setIsLoading: (isLoading: boolean) => void;
    setToc: (toc: NavigationItem[]) => void;
    setImmersiveMode: (enabled: boolean) => void;
    setCurrentSection: (title: string | null, id: string | null) => void;
    setCurrentBookId: (id: string | null) => void;
    setFollowingAudio: (following: boolean) => void;

    compassState: CompassState;
    setCompassState: (state: CompassState) => void;
    resetCompassState: () => void;

    /** Annotation popover state (ephemeral, never synced). */
    popover: AnnotationPopoverState;
    /** Shows the annotation popover at the given screen coordinates. */
    showPopover: (x: number, y: number, cfiRange: string, text: string, id?: string) => void;
    /** Hides the annotation popover. */
    hidePopover: () => void;

    reset: () => void;
}

export const useReaderUIStore = create<ReaderUIState>((set) => ({
    isLoading: false,
    toc: [],
    immersiveMode: false,
    currentSectionTitle: null,
    currentSectionId: null,
    currentBookId: null,
    followingAudio: true,

    compassState: {},

    setIsLoading: (isLoading) => set({ isLoading }),
    setToc: (toc) => set({ toc }),
    setImmersiveMode: (enabled) => set({ immersiveMode: enabled }),
    setCurrentSection: (title, id) => set({ currentSectionTitle: title, currentSectionId: id }),
    setCurrentBookId: (id) => set({ currentBookId: id }),
    setFollowingAudio: (following) => set({ followingAudio: following }),

    setCompassState: (state) => set({ compassState: state }),
    resetCompassState: () => set({ compassState: {} }),

    popover: INITIAL_POPOVER_STATE,
    showPopover: (x, y, cfiRange, text, id) => set({
        popover: { visible: true, x, y, cfiRange, text, id }
    }),
    hidePopover: () => set((state) => ({
        popover: { ...state.popover, visible: false, id: undefined }
    })),

    reset: () => set({
        isLoading: false,
        toc: [],
        immersiveMode: false,
        currentSectionTitle: null,
        currentSectionId: null,
        currentBookId: null,
        followingAudio: true,
        compassState: {},
        popover: INITIAL_POPOVER_STATE
    })
}));
