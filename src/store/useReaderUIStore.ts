import { create } from 'zustand';
import type { NavigationItem } from '~types/book';

import {
    COMPASS_IDLE,
    transitionCompass,
    type CompassEvent,
    type CompassInteraction,
} from './compassMachine';
import { createLogger } from '@lib/logger';

const log = createLogger('compass');

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

    /**
     * The compass pill's interaction state (see compassMachine.ts). Ephemeral,
     * device-local — never synced via Yjs (its selection payload carries
     * screen coordinates; the popover-desync hotfix moved that data here).
     * Mutated exclusively through `dispatchCompass`.
     */
    compass: CompassInteraction;
    /**
     * Routes an event through the compass transition table. The ONLY way to
     * change `compass` — events not meaningful in the current mode are
     * ignored by the table, so callers never need to check state first.
     */
    dispatchCompass: (event: CompassEvent) => void;

    reset: () => void;
}

export const useReaderUIStore = create<ReaderUIState>((set, get) => ({
    isLoading: false,
    toc: [],
    immersiveMode: false,
    currentSectionTitle: null,
    currentSectionId: null,
    currentBookId: null,
    followingAudio: true,

    compass: COMPASS_IDLE,

    setIsLoading: (isLoading) => set({ isLoading }),
    setToc: (toc) => set({ toc }),
    setImmersiveMode: (enabled) => set({ immersiveMode: enabled }),
    setCurrentSection: (title, id) => set({ currentSectionTitle: title, currentSectionId: id }),
    setCurrentBookId: (id) => set({ currentBookId: id }),
    setFollowingAudio: (following) => set({ followingAudio: following }),

    dispatchCompass: (event) => {
        const prev = get().compass;
        const next = transitionCompass(prev, event);
        if (next === prev) return; // Event not meaningful in this mode.
        log.debug(`${prev.mode} --${event.type}--> ${next.mode}`);
        set({ compass: next });
    },

    reset: () => set({
        isLoading: false,
        toc: [],
        immersiveMode: false,
        currentSectionTitle: null,
        currentSectionId: null,
        currentBookId: null,
        followingAudio: true,
        compass: COMPASS_IDLE
    })
}));
