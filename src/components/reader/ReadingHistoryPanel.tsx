import React from 'react';
import type { ReadingHistoryEntry } from '../../types/db';
import { Clock, ArrowRight } from 'lucide-react';

interface ReadingHistoryPanelProps {
    history: ReadingHistoryEntry[];
    onNavigate: (cfi: string) => void;
    onClose: () => void;
    getChapterTitle?: (cfi: string) => string;
}

export const ReadingHistoryPanel: React.FC<ReadingHistoryPanelProps> = ({ history, onNavigate, getChapterTitle }) => {

    const getEndCfi = (rangeCfi: string): string | null => {
        try {
            // Expected format: parent!start,end)
            // Example: /6/2!/4/2,/4/6)
            if (!rangeCfi) return null;

            const parts = rangeCfi.split('!');
            if (parts.length !== 2) return null;

            const parent = parts[0];
            const ranges = parts[1].split(',');
            if (ranges.length !== 2) return null;

            let endPath = ranges[1];
            if (endPath.endsWith(')')) {
                endPath = endPath.slice(0, -1);
            }

            return `${parent}!${endPath}`;
        } catch (e) {
            console.error("Failed to parse CFI range:", rangeCfi, e);
            return null;
        }
    };

    // Sort by timestamp desc
    const sortedHistory = [...history].sort((a, b) => b.timestamp - a.timestamp);

    return (
        <div className="flex flex-col h-full bg-surface">
            <div className="p-4 border-b border-border flex items-center gap-2">
                <Clock className="w-5 h-5 text-muted-foreground" />
                <h2 className="text-lg font-bold text-foreground">History</h2>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {sortedHistory.length === 0 && (
                    <div className="text-center text-muted-foreground text-sm">No history yet.</div>
                )}
                {sortedHistory.map((entry) => {
                    const date = new Date(entry.timestamp);
                    const endCfi = getEndCfi(entry.cfi_range);
                    const title = getChapterTitle ? getChapterTitle(entry.cfi_range) : 'Segment read';

                    return (
                        <button
                            key={entry.id}
                            onClick={() => endCfi && onNavigate(endCfi)}
                            className="w-full text-left border border-border rounded-lg p-3 hover:bg-accent/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                        >
                            <div className="flex justify-between items-start mb-2">
                                <span className="text-xs text-muted-foreground">
                                    {date.toLocaleDateString()} {date.toLocaleTimeString()}
                                </span>
                                <ArrowRight className="w-3 h-3 text-muted-foreground" />
                            </div>
                            <div className="text-sm text-foreground truncate font-medium">
                                {title}
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
};
