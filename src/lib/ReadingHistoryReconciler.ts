import type { ReadingHistoryEntry } from '../types/db';
import { parseCfiRange } from './cfi-utils';

export class ReadingHistoryReconciler {
    /**
     * Resolves the best start location based on reading history.
     * Prefers chronological sessions over spatial ranges (legacy).
     * @param entry The reading history entry.
     * @returns The resolved start CFI or undefined.
     */
    static resolveStartLocation(entry: ReadingHistoryEntry | undefined): string | undefined {
        if (!entry) return undefined;

        // Prefer chronological sessions
        if (entry.sessions && entry.sessions.length > 0) {
            const lastSession = entry.sessions[entry.sessions.length - 1];
            const parsed = parseCfiRange(lastSession.cfiRange);
            // Use fullStart to resume AT the location
            if (parsed && parsed.fullStart) {
                return parsed.fullStart;
            }
        } else if (entry.readRanges && entry.readRanges.length > 0) {
             // Fallback to spatial end (legacy behavior)
             const lastRange = entry.readRanges[entry.readRanges.length - 1];
             const parsed = parseCfiRange(lastRange);
             if (parsed && parsed.fullEnd) {
                 return parsed.fullEnd;
             }
        }
        return undefined;
    }
}
