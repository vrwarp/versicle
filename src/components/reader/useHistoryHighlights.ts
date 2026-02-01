import { useState, useEffect } from 'react';
import { createLogger } from '../../lib/logger';

const logger = createLogger('useHistoryHighlights');

/**
 * Hook to manage reading history highlights.
 * Highlights ONLY the last sentence read by TTS (to avoid visual clutter).
 * Ensures highlights are not updated live during TTS playback,
 * but only on viewer updates (page turns) or when idle (initial load/sync).
 */
export const useHistoryHighlights = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rendition: any,
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

        if (rendition && isRenditionReady && bookId && displayedRanges.length > 0) {
            displayedRanges.forEach(range => {
                try {
                    // Check if annotations API exists (it might not in limited mocks)
                    if (rendition.annotations && typeof rendition.annotations.add === 'function') {
                        // Apply highlight annotation
                        // We use a custom style for "last read" highlight
                        rendition.annotations.add(
                            'highlight',
                            range,
                            {},
                            null,
                            'reading-history-highlight',
                            { fill: 'gray', fillOpacity: '0.1', mixBlendMode: 'multiply' }
                        );
                        addedRanges.push(range);
                    }
                } catch (e) {
                    logger.warn("Failed to add history highlight", e);
                }
            });
        }

        return () => {
            if (rendition && addedRanges.length > 0) {
                addedRanges.forEach(range => {
                    try {
                        if (rendition.annotations && typeof rendition.annotations.remove === 'function') {
                            rendition.annotations.remove(range, 'highlight');
                        }
                    } catch (e) {
                        logger.warn("Failed to remove history highlight", e);
                    }
                });
            }
        };
    }, [rendition, isRenditionReady, bookId, displayedRanges]);
};
