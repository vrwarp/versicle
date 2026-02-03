import React, { useMemo } from 'react';
import { useBookProgress } from '../../store/useReadingStateStore';
import { parseCfiRange } from '../../lib/cfi-utils';
import type { Rendition } from 'epubjs';
import { BookOpen, Headphones, ScrollText } from 'lucide-react';
import type { ReadingEventType } from '../../types/db';

interface Props {
    bookId: string;
    rendition: Rendition | null;
    onNavigate: (cfi: string) => void;
    onClose?: () => void;
    trigger?: number;
}

interface HistoryItem {
    range: string;
    label: string;
    percentage: number;
    subLabel: string;
    timestamp: number;
    targetCfi: string;
    type: ReadingEventType;
}

export const ReadingHistoryPanel: React.FC<Props> = ({ bookId, rendition, onNavigate }) => {
    // Reactive progress from Yjs store
    const progress = useBookProgress(bookId);
    const completedRanges = useMemo(() => progress?.completedRanges || [], [progress]);

    const items = useMemo(() => {
        const loadedItems: HistoryItem[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const book = rendition ? (rendition as any).book : null;

        const processItem = (range: string, timestamp: number = 0, type: ReadingEventType = 'page', explicitLabel?: string) => {
            let label = explicitLabel || "Reading Segment";
            let percentage = 0;
            let subLabel = range;
            const targetCfi = range;

            const parsed = parseCfiRange(range);

            if (book) {
                if (parsed) {
                    if (book.locations && book.locations.length() > 0) {
                        percentage = book.locations.percentageFromCfi(parsed.fullStart);
                    }
                }

                if (!explicitLabel) {
                    let section;
                    try {
                        section = book.spine.get(range);
                    } catch (e) {
                        console.warn("Failed to get section from CFI", e);
                    }

                    if (section) {
                        let title = "";
                        if (section.href) {
                            const navItem = book.navigation.get(section.href);
                            if (navItem && navItem.label) {
                                title = navItem.label.trim();
                            }
                        }

                        if (title) {
                            label = title;
                        } else {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            const spinePos = (section as any).index ?? book.spine.items.indexOf(section);
                            label = spinePos >= 0 ? `Chapter ${spinePos + 1}` : 'Unknown Chapter';
                        }
                    } else {
                        label = `Segment at ${(percentage * 100).toFixed(1)}%`;
                    }
                }
            }

            const date = timestamp > 0 ? new Date(timestamp) : new Date();
            const dateStr = date.toLocaleDateString();
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            subLabel = `${dateStr} ${timeStr} • ${(percentage * 100).toFixed(0)}%`;

            return {
                range,
                label,
                percentage,
                subLabel,
                timestamp,
                targetCfi,
                type
            };
        };

        // Use completedRanges from Yjs store
        for (const range of completedRanges) {
            loadedItems.push(processItem(range));
        }
        // Sort DESC so latest (furthest) is at top
        loadedItems.sort((a, b) => b.percentage - a.percentage);

        return loadedItems;
    }, [completedRanges, rendition]);


    if (items.length === 0) {
        return <div className="p-4 text-sm text-muted-foreground text-center">No reading history recorded yet.</div>;
    }

    return (
        <div className="flex-1 overflow-y-auto flex flex-col">
            <div className="p-4 border-b border-border">
                <h2 className="text-lg font-bold text-foreground">Reading History</h2>
                <p className="text-xs text-muted-foreground mt-1">
                    Showing {items.length} read segments.
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
                            <div className="mt-0.5 shrink-0">
                                {item.type === 'tts' && <Headphones className="w-4 h-4 text-blue-500" />}
                                {item.type === 'page' && <BookOpen className="w-4 h-4 text-green-500" />}
                                {item.type === 'scroll' && <ScrollText className="w-4 h-4 text-orange-500" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-foreground block truncate">{item.label}</span>
                                <p className="text-xs text-muted-foreground truncate mt-0.5 opacity-70">
                                    {item.subLabel}
                                </p>
                            </div>
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
};
