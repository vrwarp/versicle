import { useState, useEffect } from 'react';
import type { HighlightLayerManager } from '@domains/reader/engine/HighlightLayerManager';

/**
 * Hook to manage reading history highlights.
 * Highlights ONLY the last sentence read by TTS (to avoid visual clutter).
 * Ensures highlights are not updated live during TTS playback,
 * but only on viewer updates (page turns) or when idle (initial load/sync).
 *
 * Phase 6: epub.js calls go through the HighlightLayerManager's 'history'
 * layer (the registry carries the gray style verbatim); the update-gating
 * state machine below is unchanged.
 */
export const useHistoryHighlights = (
    highlights: HighlightLayerManager | null,
    isRenditionReady: boolean,
    bookId: string | null,
    currentCfi: string | undefined,
    isPlaying: boolean,
    lastPlayedCfi?: string
) => {
    // Initialize displayedRanges with current lastPlayedCfi to match behavior on mount
    const [displayedRanges, setDisplayedRanges] = useState<string[]>(() =>
        lastPlayedCfi ? [lastPlayedCfi] : []
    );

    // State to track previous props for render-time updates
    const [prevProps, setPrevProps] = useState({
        bookId,
        currentCfi,
        lastPlayedCfi,
        isPlaying
    });

    // derived state logic: update displayedRanges based on props
    // We do this during render to avoid cascading renders from useEffect
    if (
        prevProps.bookId !== bookId ||
        prevProps.currentCfi !== currentCfi ||
        prevProps.lastPlayedCfi !== lastPlayedCfi ||
        prevProps.isPlaying !== isPlaying
    ) {
        let shouldUpdate = false;

        const pageChanged = prevProps.bookId !== bookId || prevProps.currentCfi !== currentCfi;

        if (pageChanged) {
            // Always update on page turn
            shouldUpdate = true;
        } else if (!isPlaying) {
            // If not playing, we track updates (data changes or stop event)
            shouldUpdate = true;
        }

        if (shouldUpdate) {
            const targetRanges = lastPlayedCfi ? [lastPlayedCfi] : [];
            const isSame = displayedRanges.length === targetRanges.length &&
                           displayedRanges.every((val, index) => val === targetRanges[index]);

            if (!isSame) {
                setDisplayedRanges(targetRanges);
            }
        }

        setPrevProps({ bookId, currentCfi, lastPlayedCfi, isPlaying });
    }

    // Apply annotations based on displayedRanges
    useEffect(() => {
        const addedRanges: string[] = [];

        if (highlights && isRenditionReady && bookId && displayedRanges.length > 0) {
            displayedRanges.forEach(range => {
                // "Last read" highlight — gray style from the layer registry.
                highlights.add('history', range, { onClick: null });
                addedRanges.push(range);
            });
        }

        return () => {
            if (highlights && addedRanges.length > 0) {
                addedRanges.forEach(range => {
                    highlights.remove('history', range);
                });
            }
        };
    }, [highlights, isRenditionReady, bookId, displayedRanges]);
};
