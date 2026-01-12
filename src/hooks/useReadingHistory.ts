import { useState, useEffect, useCallback } from 'react';
import { dbService } from '../db/DBService';
import type { ReadingHistoryEntry } from '../types/db';

export function useReadingHistory(bookId: string, trigger: number = 0) {
    const [entry, setEntry] = useState<ReadingHistoryEntry | undefined>(undefined);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const loadHistory = useCallback(async () => {
        if (!bookId) return;
        setLoading(true);
        setError(null);
        try {
            const data = await dbService.getReadingHistoryEntry(bookId);
            setEntry(data);
        } catch (e) {
            console.error("Failed to load history", e);
            setError("Failed to load history");
        } finally {
            setLoading(false);
        }
    }, [bookId]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory, trigger]);

    return { entry, loading, error, refresh: loadHistory };
}
