import { useReadingStateStore } from '../store/useReadingStateStore';
import { useReaderUIStore } from '../store/useReaderUIStore';
import { dbService } from '../db/DBService';

// Actually, looking at the project, I don't see react-query. I'll stick to a simple hook given the constraints.
import { useState, useEffect, useMemo } from 'react';
import type { UserProgress } from '../types/db';

import { useShallow } from 'zustand/react/shallow';

export function useBookProgress(bookId: string) {
    const currentBookId = useReaderUIStore(state => state.currentBookId);

    // Select the derived progress directly to ensure full reactivity without anti-patterns
    // We pass the entire calculation into the selector so it only re-renders when the final derived value changes.
    const resolvedProgress = useReadingStateStore(
        useShallow(state => {
            const p = state.getProgress(bookId);
            return {
                percentage: p?.percentage || 0,
                currentCfi: p?.currentCfi || ''
            };
        })
    );

    // If the requested book is the active one, return state from store
    const isCurrent = bookId === currentBookId;

    // Local state for non-active books
    const [storedProgress, setStoredProgress] = useState<UserProgress | null>(null);

    useEffect(() => {
        let ignore = false;

        if (!isCurrent && bookId) {
            dbService.getBookMetadata(bookId).then(meta => {
                if (!ignore) {
                    if (meta) {
                        setStoredProgress({
                            bookId,
                            percentage: meta.progress || 0,
                            currentCfi: meta.currentCfi || '',
                            lastRead: meta.lastRead || 0,
                            completedRanges: [] // We don't have this in BookMetadata, but it's fine for now
                        });
                    } else {
                        // Null out progress if metadata not found
                        setStoredProgress(null);
                    }
                }
            });
        }

        return () => {
            ignore = true;
        };
    }, [bookId, isCurrent]);

    return useMemo(() => {
        if (isCurrent) {
            return resolvedProgress;
        }

        return {
            percentage: storedProgress?.percentage || 0,
            currentCfi: storedProgress?.currentCfi || ''
        };
    }, [isCurrent, resolvedProgress, storedProgress?.percentage, storedProgress?.currentCfi]);
}
