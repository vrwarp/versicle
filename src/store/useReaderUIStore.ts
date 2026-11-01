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
    /**
     * The TOC fragment (`chp12` of `chap03.html#chp12`) inside the current
     * section that the reader has reached — lets the TOC highlight follow
     * sub-sections of a long single-file chapter. Null when the section has
     * no TOC anchors before the reading position.
     */
    currentSectionAnchor: string | null;
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
    // (This store keeps DATA state only: reader commands such as
    // playFromSelection/jumpToLocation live in the ReaderCommands
    // context/registry.)

    setIsLoading: (isLoading: boolean) => void;
    setToc: (toc: NavigationItem[]) => void;
    setImmersiveMode: (enabled: boolean) => void;
    /**
     * `anchor` omitted keeps the current anchor while the section is
     * unchanged (TTS section updates carry none) and clears it otherwise.
     */
    setCurrentSection: (title: string | null, id: string | null, anchor?: string | null) => void;
    setCurrentBookId: (id: string | null) => void;
    setFollowingAudio: (following: boolean) => void;

    /**
     * The compass pill's interaction state (see compassMachine.ts). Ephemeral,
     * device-local — never synced via Yjs (its selection payload carries
     * screen coordinates, which must not replicate to other devices).
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
    currentSectionAnchor: null,
    currentBookId: null,
    followingAudio: true,

    compass: COMPASS_IDLE,

    setIsLoading: (isLoading) => set({ isLoading }),
    setToc: (toc) => set({ toc }),
    setImmersiveMode: (enabled) => set({ immersiveMode: enabled }),
    setCurrentSection: (title, id, anchor) =>
        set((state) => ({
            currentSectionTitle: title,
            currentSectionId: id,
            currentSectionAnchor:
                anchor !== undefined ? anchor : id === state.currentSectionId ? state.currentSectionAnchor : null,
        })),
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
        currentSectionAnchor: null,
        currentBookId: null,
        followingAudio: true,
        compass: COMPASS_IDLE
    })
}));
