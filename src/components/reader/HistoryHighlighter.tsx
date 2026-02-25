import React from 'react';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { useHistoryHighlights } from './useHistoryHighlights';
import { useShallow } from 'zustand/react/shallow';

interface HistoryHighlighterProps {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rendition: any;
    isRenditionReady: boolean;
    bookId: string | null;
    isPlaying: boolean;
}

/**
 * Component that manages history highlights by subscribing to reading state updates.
 * Isolates high-frequency progress updates from the main ReaderView to prevent re-renders.
 */
export const HistoryHighlighter: React.FC<HistoryHighlighterProps> = ({
    rendition,
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
        rendition,
        isRenditionReady,
        bookId,
        currentCfi,
        isPlaying,
        lastPlayedCfi
    );

    return null;
};
