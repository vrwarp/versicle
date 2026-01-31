import { useState, useEffect, useRef, useCallback } from 'react';
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
    const [displayedRanges, setDisplayedRanges] = useState<string[]>([]);

    // Store latest data in ref to access it in effects/callbacks
    const latestLastPlayedCfi = useRef(lastPlayedCfi);

    useEffect(() => {
        latestLastPlayedCfi.current = lastPlayedCfi;
    }, [lastPlayedCfi]);

    const updateDisplayedRanges = useCallback(() => {
        const targetRanges: string[] = latestLastPlayedCfi.current ? [latestLastPlayedCfi.current] : [];

        setDisplayedRanges(prev => {
            // Prevent infinite update loops if the array reference changes but content is same.
            if (prev === targetRanges) return prev;
            if (prev.length === targetRanges.length && prev.every((val, index) => val === targetRanges[index])) {
                return prev;
            }
            return targetRanges;
        });
    }, []);

    // 1. Update when bookId or currentCfi changes (page turns)
    useEffect(() => {
         updateDisplayedRanges();
    }, [bookId, currentCfi, updateDisplayedRanges]);

    // 2. Update when data (lastPlayedCfi) changes, BUT only if not playing
    useEffect(() => {
        if (!isPlaying) {
            updateDisplayedRanges();
        }
    }, [lastPlayedCfi, isPlaying, updateDisplayedRanges]);

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
