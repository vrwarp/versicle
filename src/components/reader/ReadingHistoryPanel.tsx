import React, { useMemo } from 'react';
import { useBookProgress } from '../../store/useReadingStateStore';
import { parseCfiRange } from '../../lib/cfi-utils';
import type { Rendition } from 'epubjs';
import { BookOpen, Headphones, ScrollText } from 'lucide-react';
import type { ReadingEventType, ReadingSession } from '../../types/db';

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
    sessionCount: number;
}

/**
 * Resolve a section label from a CFI using the epub.js book instance.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveSectionLabel(cfi: string, book: any): string | null {
    let section;
    try {
        section = book.spine.get(cfi);
    } catch {
        return null;
    }
    if (!section) return null;

    if (section.href) {
        const navItem = book.navigation.get(section.href);
        if (navItem?.label && navItem.label.trim() !== 'Chapter') {
            return navItem.label.trim();
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const spinePos = (section as any).index ?? book.spine.items.indexOf(section);

    // Try to find nav item by checking all nav items for matching spine index
    // This handles cases where href lookup fails or is mismatched
    if (spinePos >= 0 && book.navigation) {
        let foundLabel = null;
        book.navigation.forEach((item: any) => {
            // Check if nav item's href points to our spine item
            const itemHref = item.href ? item.href.split('#')[0] : null;
            const itemSection = itemHref ? book.spine.get(itemHref) : null;
            if (itemSection && itemSection.index === spinePos) {
                foundLabel = item.label;
            }
        });
        if (foundLabel && (typeof foundLabel === 'string') && (foundLabel as string).trim() !== 'Chapter') {
            return (foundLabel as string).trim();
        }
    }

    return spinePos >= 0 ? `Chapter ${spinePos + 1}` : null;
}


/**
 * Pick the dominant type from a list of session types.
 * Priority: tts > scroll > page
 */
function dominantType(types: ReadingEventType[]): ReadingEventType {
    if (types.includes('tts')) return 'tts';
    if (types.includes('scroll')) return 'scroll';
    return 'page';
}

export const ReadingHistoryPanel: React.FC<Props> = ({ bookId, rendition, onNavigate }) => {
    // Reactive progress from Yjs store
    const progress = useBookProgress(bookId);
    const readingSessions = useMemo(() => progress?.readingSessions || [], [progress]);
    const completedRanges = useMemo(() => progress?.completedRanges || [], [progress]);

    const items = useMemo(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const book = rendition ? (rendition as any).book : null;

        const processSession = (session: ReadingSession): HistoryItem => {
            const cfi = session.cfiRange;
            let label = session.label || 'Reading Segment';
            let percentage = 0;
            const targetCfi = cfi;

            const parsed = parseCfiRange(cfi);

            if (book) {
                if (parsed && book.locations && book.locations.length() > 0) {
                    percentage = book.locations.percentageFromCfi(parsed.fullStart);
                }

                // Always prefer resolved label if available to ensure consistency for merging
                // Use session.label as fallback if resolution fails or book not available
                const resolved = resolveSectionLabel(cfi, book);
                if (resolved) {
                    label = resolved;
                } else if (session.label && session.label.trim() !== 'Chapter' && session.label.trim() !== '') {
                    label = session.label.trim();
                } else {
                    label = `Segment at ${(percentage * 100).toFixed(1)}%`;
                }
            }

            const date = new Date(session.timestamp);
            const dateStr = date.toLocaleDateString();
            const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const subLabel = `${dateStr} ${timeStr} • ${(percentage * 100).toFixed(0)}%`;

            return {
                range: cfi,
                label,
                percentage,
                subLabel,
                timestamp: session.timestamp,
                targetCfi,
                type: session.type,
                sessionCount: 1
            };
        };

        // Legacy fallback: if no sessions recorded yet, use completedRanges
        const processLegacyRange = (range: string): HistoryItem => {
            let label = 'Reading Segment';
            let percentage = 0;
            const targetCfi = range;

            const parsed = parseCfiRange(range);

            if (book) {
                if (parsed && book.locations && book.locations.length() > 0) {
                    percentage = book.locations.percentageFromCfi(parsed.fullStart);
                }

                const resolved = resolveSectionLabel(range, book);
                if (resolved) {
                    label = resolved;
                } else {
                    label = `Segment at ${(percentage * 100).toFixed(1)}%`;
                }
            }

            const subLabel = `${(percentage * 100).toFixed(0)}%`;

            return {
                range,
                label,
                percentage,
                subLabel,
                timestamp: 0,
                targetCfi,
                type: 'page',
                sessionCount: 1
            };
        };

        // Build raw items
        let rawItems: HistoryItem[];

        if (readingSessions.length > 0) {
            rawItems = readingSessions.map(processSession);
        } else if (completedRanges.length > 0) {
            // Legacy fallback: deduplicate by label
            rawItems = completedRanges.map(processLegacyRange);
        } else {
            return [];
        }

        // Group consecutive sessions by section (same label = same section)
        const grouped: HistoryItem[] = [];
        for (let i = rawItems.length - 1; i >= 0; i--) {
            const item = rawItems[i];
            const last = grouped.length > 0 ? grouped[grouped.length - 1] : null;

            if (last && last.label === item.label) {
                // Merge: keep the most recent timestamp (last is newer since we iterate in reverse)
                last.sessionCount += 1;
                last.type = dominantType([last.type, item.type]);
                // Extend the target to the earliest range in the group
                last.range = item.range;
            } else {
                grouped.push({ ...item });
            }
        }

        return grouped;
    }, [readingSessions, completedRanges, rendition]);


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
            <ul className="divide-y divide-border" data-testid="history-list">
                {items.map((item, idx) => (
                    <li
                        key={idx}
                        className="p-3 hover:bg-muted cursor-pointer transition-colors"
                        onClick={() => onNavigate(item.targetCfi)}
                        role="button"
                        aria-label={`Jump to ${item.label}`}
                        data-testid={`history-item-${idx}`}
                    >
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 shrink-0" data-testid={`history-icon-${item.type}`}>
                                {item.type === 'tts' && <Headphones className="w-4 h-4 text-blue-500" />}
                                {item.type === 'page' && <BookOpen className="w-4 h-4 text-green-500" />}
                                {item.type === 'scroll' && <ScrollText className="w-4 h-4 text-orange-500" />}
                            </div>
                            <div className="flex-1 min-w-0">
                                <span className="text-sm font-medium text-foreground block truncate" data-testid="history-label">{item.label}</span>
                                <p className="text-xs text-muted-foreground truncate mt-0.5 opacity-70" data-testid="history-sublabel">
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
