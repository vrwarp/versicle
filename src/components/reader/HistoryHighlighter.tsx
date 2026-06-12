import type React from 'react';
import { useReadingStateStore } from '@store/useReadingStateStore';
import { useHistoryHighlights } from './useHistoryHighlights';
import { useShallow } from 'zustand/react/shallow';
import type { HighlightLayerManager } from '@domains/reader/engine/HighlightLayerManager';

interface HistoryHighlighterProps {
    /** The shared highlight manager — the ONLY path to epub.js annotations. */
    highlights: HighlightLayerManager | null;
    isRenditionReady: boolean;
    bookId: string | null;
    isPlaying: boolean;
}

/**
 * Component that manages history highlights by subscribing to reading state updates.
 * Isolates high-frequency progress updates from the main ReaderView to prevent re-renders.
 */
export const HistoryHighlighter: React.FC<HistoryHighlighterProps> = ({
    highlights,
    isRenditionReady,
    bookId,
    isPlaying
}) => {
    const { currentCfi, lastPlayedCfi } = useReadingStateStore(useShallow(state => {
        if (!bookId) return { currentCfi: undefined, lastPlayedCfi: undefined };
        const progress = state.getProgress(bookId);
        return {
            currentCfi: progress?.currentCfi,
            lastPlayedCfi: progress?.lastPlayedCfi
        };
    }));

    useHistoryHighlights(
        highlights,
        isRenditionReady,
        bookId,
        currentCfi,
        isPlaying,
        lastPlayedCfi
    );

    return null;
};
