import { useState, useEffect } from 'react';
import { createLogger } from '../../lib/logger';

const logger = createLogger('useHistoryHighlights');

/**
 * Hook to manage reading history highlights.
 * Ensures highlights are not updated live during TTS playback,
 * but only on viewer updates (page turns) or when idle (initial load/sync).
 */
export const useHistoryHighlights = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rendition: any,
    isRenditionReady: boolean,
    bookId: string | null,
    completedRanges: string[] | undefined,
    currentCfi: string | undefined,
    isPlaying: boolean
) => {
    const [displayedRanges, setDisplayedRanges] = useState<string[]>([]);

    // Logic to control WHEN we update the displayed highlights.
    // We want to avoid live updates while TTS is playing (distraction),
    // but ensure updates happen on page turns (viewer updates)
    // or when not playing (to capture initial load or sync).
    useEffect(() => {
        // If we have ranges...
        if (completedRanges) {
            setDisplayedRanges(completedRanges);
        }
    }, [
        bookId,
        currentCfi, // Update triggers on page flip/scroll
        // If playing, we ignore live updates to completedRanges (by returning null).
        // If not playing, we respect updates (e.g. initial load or sync).
        isPlaying ? null : completedRanges
    ]);

    // Apply annotations based on displayedRanges
    useEffect(() => {
        const addedRanges: string[] = [];

        if (rendition && isRenditionReady && bookId && displayedRanges.length > 0) {
            displayedRanges.forEach(range => {
                try {
                    rendition.annotations.add(
                        'highlight',
                        range,
                        {},
                        null,
                        'reading-history-highlight',
                        { fill: 'gray', fillOpacity: '0.1', mixBlendMode: 'multiply' }
                    );
                    addedRanges.push(range);
                } catch (e) {
                    logger.warn("Failed to add history highlight", e);
                }
            });
        }

        return () => {
            if (rendition && addedRanges.length > 0) {
                addedRanges.forEach(range => {
                    try {
                        rendition.annotations.remove(range, 'highlight');
                    } catch (e) {
                        logger.warn("Failed to remove history highlight", e);
                    }
                });
            }
        };
    }, [rendition, isRenditionReady, bookId, displayedRanges]);
};
