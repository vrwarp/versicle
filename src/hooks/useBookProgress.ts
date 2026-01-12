import { useReadingStateStore } from '../store/useReadingStateStore';
import { dbService } from '../db/DBService';

// Actually, looking at the project, I don't see react-query. I'll stick to a simple hook given the constraints.
import { useState, useEffect } from 'react';
import type { UserProgress } from '../types/db';

export function useBookProgress(bookId: string) {
    const currentBookId = useReadingStateStore(state => state.currentBookId);
    const currentProgress = useReadingStateStore(state => state.progress);
    const currentCfi = useReadingStateStore(state => state.currentCfi);

    // If the requested book is the active one, return state from store
    const isCurrent = bookId === currentBookId;

    // Local state for non-active books
    const [storedProgress, setStoredProgress] = useState<UserProgress | null>(null);

    useEffect(() => {
        if (!isCurrent && bookId) {
            dbService.getBookMetadata(bookId).then(meta => {
                if (meta) {
                    setStoredProgress({
                        bookId,
                        percentage: meta.progress || 0,
                        currentCfi: meta.currentCfi || '',
                        lastRead: meta.lastRead || 0,
                        completedRanges: [] // We don't have this in BookMetadata, but it's fine for now
                    });
                }
            });
        }
    }, [bookId, isCurrent]);

    if (isCurrent) {
        return {
            percentage: currentProgress,
            currentCfi: currentCfi || ''
        };
    }

    return {
        percentage: storedProgress?.percentage || 0,
        currentCfi: storedProgress?.currentCfi || ''
    };
}
