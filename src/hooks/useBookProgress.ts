import { useReadingStateStore } from '../store/useReadingStateStore';
import { useReaderUIStore } from '../store/useReaderUIStore';
import { dbService } from '../db/DBService';

// Actually, looking at the project, I don't see react-query. I'll stick to a simple hook given the constraints.
import { useState, useEffect } from 'react';
import type { UserProgress } from '../types/db';

export function useBookProgress(bookId: string) {
    const currentBookId = useReaderUIStore(state => state.currentBookId);
    const allProgress = useReadingStateStore(state => state.progress);

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
        const bookProgress = allProgress[bookId];
        return {
            percentage: bookProgress?.percentage || 0,
            currentCfi: bookProgress?.currentCfi || ''
        };
    }

    return {
        percentage: storedProgress?.percentage || 0,
        currentCfi: storedProgress?.currentCfi || ''
    };
}
