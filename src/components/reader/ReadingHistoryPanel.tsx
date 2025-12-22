import React, { useEffect, useState } from 'react';
import { dbService } from '../../db/DBService';
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

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const book = rendition ? (rendition as any).book : null;

            if (entry) {
                const processItem = (range: string, timestamp: number = 0, type: ReadingEventType = 'page', explicitLabel?: string) => {
                    let label = explicitLabel || "Reading Segment";
                    let percentage = 0;
                    let subLabel = range;
                    let targetCfi = range;

                    // Parse CFI to get start point for jumping
                    const parsed = parseCfiRange(range);
                    if (parsed) {
                        targetCfi = parsed.fullStart;
                    }

                    if (book) {
                        // Try to get percentage
                        if (parsed) {
                            if (book.locations && book.locations.length() > 0) {
                                percentage = book.locations.percentageFromCfi(parsed.fullStart);
                            }
                        }

                        // If no explicit label, try to generate one
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

                    // Format subLabel
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

                // Prefer sessions if available
                if (entry.sessions && entry.sessions.length > 0) {
                    for (const session of entry.sessions) {
                        loadedItems.push(processItem(session.cfiRange, session.timestamp, session.type, session.label));
                    }
                    loadedItems.sort((a, b) => b.timestamp - a.timestamp);
                } else if (entry.readRanges && entry.readRanges.length > 0) {
                    // Fallback to legacy ranges
                    for (const range of entry.readRanges) {
                        loadedItems.push(processItem(range));
                    }
                    loadedItems.sort((a, b) => a.percentage - b.percentage);
                }
            }

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
