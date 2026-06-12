import React, { useMemo } from 'react';
import { useBookProgress } from '@store/useReadingStateStore';
import { parseCfiRange } from '@lib/cfi-utils';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import { BookOpen, Headphones, ScrollText } from 'lucide-react';
import type { ReadingEventType, ReadingSession } from '~types/db';

interface Props {
    bookId: string;
    engine: ReaderEngine | null;
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
 * Pick the dominant type from a list of session types.
 * Priority: tts > scroll > page
 */
function dominantType(types: ReadingEventType[]): ReadingEventType {
    if (types.includes('tts')) return 'tts';
    if (types.includes('scroll')) return 'scroll';
    return 'page';
}

export const ReadingHistoryPanel: React.FC<Props> = ({ bookId, engine, onNavigate }) => {
    // Reactive progress from Yjs store
    const progress = useBookProgress(bookId);
    const readingSessions = useMemo(() => progress?.readingSessions || [], [progress]);
    const completedRanges = useMemo(() => progress?.completedRanges || [], [progress]);

    const items = useMemo(() => {
        const processSession = (session: ReadingSession): HistoryItem => {
            const cfi = session.cfiRange;
            let label = session.label || 'Reading Segment';
            let percentage = 0;
            const targetCfi = cfi;

            const parsed = parseCfiRange(cfi);

            if (engine) {
                if (parsed && engine.locations.length() > 0) {
                    percentage = engine.locations.percentageFromCfi(parsed.fullStart);
                }

                // Always prefer resolved label if available to ensure consistency for merging
                // Use session.label as fallback if resolution fails or engine not available
                const resolved = engine.getNavLabel(cfi);
                if (resolved) {
                    label = resolved;
                } else if (session.label && session.label.trim() !== 'Chapter' && session.label.trim() !== '') {
                    label = session.label.trim();
                } else {
                    label = `Segment at ${(percentage * 100).toFixed(1)}%`;
                }
            }

            let subLabel = `${(percentage * 100).toFixed(0)}%`;
            if (session.startTime) {
                const date = new Date(session.startTime);
                if (!isNaN(date.getTime())) {
                    const dateStr = date.toLocaleDateString();
                    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    subLabel = `${dateStr} ${timeStr} • ${subLabel}`;
                }
            }

            return {
                range: cfi,
                label,
                percentage,
                subLabel,
                timestamp: session.startTime,
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

            if (engine) {
                if (parsed && engine.locations.length() > 0) {
                    percentage = engine.locations.percentageFromCfi(parsed.fullStart);
                }

                const resolved = engine.getNavLabel(range);
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
    }, [readingSessions, completedRanges, engine]);


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
