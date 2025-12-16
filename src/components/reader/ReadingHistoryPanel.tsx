import React, { useEffect, useState } from 'react';
import { dbService } from '../../db/DBService';
import { parseCfiRange, getSpinePosFromCfi } from '../../lib/cfi-utils';
import type { Rendition } from 'epubjs';

interface Props {
  bookId: string;
  rendition: Rendition | null;
  onNavigate: (cfi: string) => void;
  onClose?: () => void;
}

interface HistoryItem {
    range: string;
    label: string;
    percentage: number;
    subLabel: string;
}

export const ReadingHistoryPanel: React.FC<Props> = ({ bookId, rendition, onNavigate }) => {
    const [items, setItems] = useState<HistoryItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadHistory();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bookId]);

    const loadHistory = async () => {
        setLoading(true);
        try {
            const ranges = await dbService.getReadingHistory(bookId);
            const loadedItems: HistoryItem[] = [];

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const book = rendition ? (rendition as any).book : null;

            for (const range of ranges) {
                let label = "Reading Segment";
                let percentage = 0;
                let subLabel = range;

                if (book) {
                    // Try to get percentage
                    const parsed = parseCfiRange(range);
                    if (parsed) {
                        // Use start of range for percentage
                        // Check if locations are available
                        if (book.locations && book.locations.length() > 0) {
                             percentage = book.locations.percentageFromCfi(parsed.fullStart);
                        }
                    }

                    // Try to get Chapter Title
                    const spinePos = getSpinePosFromCfi(range);
                    if (spinePos >= 0) {
                        const section = book.spine.get(spinePos);
                        if (section) {
                             let title = "";
                             // Try to find label in TOC
                             if (section.href) {
                                  // book.navigation.get() expects the href as it appears in the TOC
                                  const navItem = book.navigation.get(section.href);
                                  if (navItem && navItem.label) {
                                      title = navItem.label.trim();
                                  }
                             }

                             if (title) {
                                 label = title;
                             } else {
                                 // Fallback to generic Chapter label
                                 label = `Chapter ${spinePos + 1}`;
                             }
                             subLabel = `${(percentage * 100).toFixed(1)}% completed`;
                        } else {
                             label = `Segment at ${(percentage * 100).toFixed(1)}%`;
                             subLabel = range;
                        }
                    } else {
                        label = `Segment at ${(percentage * 100).toFixed(1)}%`;
                        subLabel = range;
                    }
                }

                loadedItems.push({
                    range,
                    label,
                    percentage,
                    subLabel
                });
            }

            // Sort by percentage/location
            loadedItems.sort((a, b) => a.percentage - b.percentage);

            setItems(loadedItems);
        } catch (e) {
            console.error("Failed to load history", e);
        } finally {
            setLoading(false);
        }
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
                     Showing {items.length} read segments.
                 </p>
             </div>
             <ul className="divide-y divide-border">
                {items.map((item, idx) => (
                    <li
                        key={idx}
                        className="p-3 hover:bg-muted cursor-pointer transition-colors"
                        onClick={() => onNavigate(item.range)}
                        role="button"
                        aria-label={`Jump to ${item.label}`}
                    >
                        <div className="flex justify-between items-center">
                            <span className="text-sm font-medium text-foreground">{item.label}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-1 font-mono opacity-70">
                            {item.subLabel}
                        </p>
                    </li>
                ))}
             </ul>
        </div>
    );
};
