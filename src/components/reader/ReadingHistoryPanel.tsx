import React, { useEffect, useState } from 'react';
import { dbService } from '../../db/DBService';
import { parseCfiRange } from '../../lib/cfi-utils';
import type { Rendition } from 'epubjs';
import { Headphones, BookOpen, ScrollText, Clock } from 'lucide-react';
import type { ReadingEventType } from '../../types/db';

interface Props {
  bookId: string;
  rendition: Rendition | null;
  onNavigate: (cfi: string) => void;
  trigger?: number;
}

interface HistoryItem {
    range: string;
    label: string;
    timestamp: number;
    type: ReadingEventType;
    targetCfi: string;
}

export const ReadingHistoryPanel: React.FC<Props> = ({ bookId, rendition, onNavigate, trigger = 0 }) => {
    const [items, setItems] = useState<HistoryItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadHistory();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookId, trigger]);

    const loadHistory = async () => {
        setLoading(true);
        try {
            const entry = await dbService.getReadingHistoryEntry(bookId);
            const loadedItems: HistoryItem[] = [];

            if (entry && entry.sessions) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const book = rendition ? (rendition as any).book : null;

                for (const session of entry.sessions) {
                    let label = session.label;
                    let targetCfi = session.cfiRange;

                    // Parse CFI to get start point for navigation if it's a range
                    const parsed = parseCfiRange(session.cfiRange);
                    if (parsed) {
                        targetCfi = parsed.fullStart;
                    }

                    if (!label && book) {
                        // Fallback: Generate label from CFI
                        try {
                             // eslint-disable-next-line @typescript-eslint/no-explicit-any
                             const item = book.spine.get(targetCfi) as any;

                             if (item) {
                                 label = item.label ? item.label.trim() : undefined;
                                 if (!label && item.href && book.navigation) {
                                     const navItem = book.navigation.get(item.href);
                                     if (navItem) label = navItem.label.trim();
                                 }
                             }

                             if (!label) label = 'Unknown Chapter';

                             // Add percentage?
                             if (book.locations && book.locations.length() > 0) {
                                 const p = book.locations.percentageFromCfi(targetCfi);
                                 label += ` (${(p * 100).toFixed(0)}%)`;
                             }
                        } catch (e) {
                             label = 'Reading Session';
                        }
                    }

                    loadedItems.push({
                        range: session.cfiRange,
                        label: label || 'Reading Session',
                        timestamp: session.timestamp,
                        type: session.type,
                        targetCfi
                    });
                }

                // Sort descending
                loadedItems.sort((a, b) => b.timestamp - a.timestamp);
            }

            setItems(loadedItems);
        } catch (e) {
            console.error("Failed to load history", e);
        } finally {
            setLoading(false);
        }
    };

    const getIcon = (type: ReadingEventType) => {
        switch (type) {
            case 'tts': return <Headphones className="w-4 h-4 text-blue-500" />;
            case 'scroll': return <ScrollText className="w-4 h-4 text-orange-500" />;
            case 'page': return <BookOpen className="w-4 h-4 text-green-500" />;
            default: return <BookOpen className="w-4 h-4" />;
        }
    };

    const formatTime = (ts: number) => {
        const diff = Date.now() - ts;
        if (diff < 60000) return 'Just now';
        if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
        if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
        return new Date(ts).toLocaleDateString();
    };

    if (loading) return <div className="p-4 text-sm text-foreground">Loading history...</div>;

    if (items.length === 0) {
        return <div className="p-4 text-sm text-muted-foreground text-center">No reading history recorded yet.</div>;
    }

    return (
        <div className="flex-1 overflow-y-auto flex flex-col">
             <div className="p-4 border-b border-border">
                 <h2 className="text-lg font-bold text-foreground">Reading History</h2>
                 <p className="text-xs text-muted-foreground mt-1">
                     {items.length} sessions recorded.
                 </p>
             </div>
             <ul className="divide-y divide-border">
                {items.map((item, idx) => (
                    <li
                        key={idx}
                        className="p-3 hover:bg-muted cursor-pointer transition-colors"
                        onClick={() => onNavigate(item.targetCfi)}
                        role="button"
                        aria-label={`Jump to ${item.label}`}
                    >
                        <div className="flex items-start gap-3">
                            <div className="mt-1">
                                {getIcon(item.type)}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium text-foreground truncate">
                                    {item.label}
                                </p>
                                <div className="flex items-center gap-2 mt-1">
                                    <Clock className="w-3 h-3 text-muted-foreground" />
                                    <span className="text-xs text-muted-foreground">
                                        {formatTime(item.timestamp)}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </li>
                ))}
             </ul>
        </div>
    );
};
