import { useState, useEffect, useCallback } from 'react';
import { dbService } from '../db/DBService';
import type { ReadingHistoryEntry } from '../types/db';

export function useReadingHistory(bookId: string | undefined) {
    const [history, setHistory] = useState<ReadingHistoryEntry[]>([]);

    const loadHistory = useCallback(async () => {
        if (!bookId) return;
        const entries = await dbService.getReadingHistory(bookId);
        setHistory(entries);
    }, [bookId]);

    useEffect(() => {
        loadHistory();
    }, [loadHistory]);

    return {
        history,
        refreshHistory: loadHistory
    };
}
