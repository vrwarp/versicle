import React, { useMemo, useState } from 'react';
import { useContentAnalysisStore } from '../../store/useContentAnalysisStore';
import { useReaderUIStore } from '../../store/useReaderUIStore';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { TYPE_COLORS, type ContentType } from '../../types/content-analysis';
import type { Rendition } from 'epubjs';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { NavigationItem } from '../../types/db';

interface ContentAnalysisReportProps {
    isOpen: boolean;
    onClose: () => void;
    rendition?: Rendition | null;
}

export const ContentAnalysisReport: React.FC<ContentAnalysisReportProps> = ({ isOpen, onClose, rendition }) => {
    const { sections } = useContentAnalysisStore();
    const { currentBookId, toc } = useReaderUIStore();

    const [filterType, setFilterType] = useState<ContentType | 'all'>('all');
    const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

    const analysisData = useMemo(() => {
        if (!currentBookId) return [];

        const prefix = `${currentBookId}/`;
        const result = Object.entries(sections)
            .filter(([key]) => key.startsWith(prefix))
            .map(([key, analysis]) => {
                const sectionId = key.substring(prefix.length);
                return {
                    sectionId,
                    ...analysis
                };
            });

        // Sort by something? Maybe section index if we can figure it out.
        // Or just alphabetical for now, or rely on insert order (not reliable).
        // Since we don't have playOrder here easily without fetching structure,
        // we can try to sort by finding index in TOC.

        return result;
    }, [sections, currentBookId]);

    // Resolve titles and sort
    const sortedSections = useMemo(() => {
        const findTitleAndOrder = (id: string, items: NavigationItem[]): { title: string, order: number } | null => {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                // Check if href matches id (ignoring hash if id has none, or exact match)
                const itemPath = item.href.split('#')[0];
                const sectionPath = id.split('#')[0];

                if (item.href === id || itemPath === sectionPath) {
                     return { title: item.label, order: i };
                }

                if (item.subitems) {
                    const found = findTitleAndOrder(id, item.subitems);
                    if (found) return { title: found.title, order: i }; // Use parent index for rough sorting
                }
            }
            return null;
        };

        const enriched = analysisData.map(section => {
             const found = findTitleAndOrder(section.sectionId, toc);
             return {
                 ...section,
                 displayTitle: section.title || found?.title || section.sectionId,
                 order: found?.order ?? 9999
             };
        });

        // Sort by order, then by ID
        return enriched.sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            return a.sectionId.localeCompare(b.sectionId);
        });
    }, [analysisData, toc]);

    const filteredSections = useMemo(() => {
        return sortedSections.map(section => {
            const filteredMap = section.semanticMap?.filter(item =>
                filterType === 'all' || item.type === filterType
            ) || [];

            return {
                ...section,
                filteredMap,
                hasMatches: filteredMap.length > 0
            };
        }).filter(s => s.hasMatches);
    }, [sortedSections, filterType]);

    const totalCount = useMemo(() => {
        return filteredSections.reduce((acc, s) => acc + s.filteredMap.length, 0);
    }, [filteredSections]);

    const toggleSection = (sectionId: string) => {
        const newSet = new Set(expandedSections);
        if (newSet.has(sectionId)) {
            newSet.delete(sectionId);
        } else {
            newSet.add(sectionId);
        }
        setExpandedSections(newSet);
    };

    const handleJump = (cfi: string) => {
        if (rendition) {
            rendition.display(cfi);
            onClose();
        }
    };

    return (
        <Dialog
            isOpen={isOpen}
            onClose={onClose}
            title="Content Analysis Report"
            className="max-w-3xl h-[80vh] flex flex-col"
            description="Overview of detected content types for the entire book."
        >
            <div className="flex flex-col h-full gap-4 overflow-hidden">
                {/* Header Stats & Filters */}
                <div className="flex flex-col gap-2 shrink-0">
                    <div className="text-sm text-muted-foreground">
                        Found <span className="font-bold text-foreground">{totalCount}</span> items in <span className="font-bold text-foreground">{filteredSections.length}</span> sections.
                    </div>

                    <div className="flex flex-wrap gap-2">
                        <Button
                            variant={filterType === 'all' ? "default" : "outline"}
                            size="sm"
                            onClick={() => setFilterType('all')}
                        >
                            All
                        </Button>
                        {(Object.keys(TYPE_COLORS) as ContentType[]).map(type => (
                             <Button
                                key={type}
                                variant={filterType === type ? "default" : "outline"}
                                size="sm"
                                onClick={() => setFilterType(type)}
                                className="capitalize"
                                style={filterType === type ? { backgroundColor: TYPE_COLORS[type], color: '#000' } : { borderColor: TYPE_COLORS[type] }}
                            >
                                {type}
                            </Button>
                        ))}
                    </div>
                </div>

                {/* Content List */}
                <div className="flex-1 overflow-y-auto border rounded-md bg-muted/20 p-2 space-y-2">
                    {filteredSections.length === 0 ? (
                        <div className="flex items-center justify-center h-full text-muted-foreground">
                            No content detected matching current filter.
                        </div>
                    ) : (
                        filteredSections.map(section => (
                            <div key={section.sectionId} className="border rounded bg-card overflow-hidden">
                                <button
                                    onClick={() => toggleSection(section.sectionId)}
                                    className="w-full flex items-center justify-between p-3 hover:bg-accent/50 transition-colors text-left"
                                >
                                    <div className="flex items-center gap-2 font-medium">
                                        {expandedSections.has(section.sectionId) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                        <span className="truncate">{section.displayTitle}</span>
                                    </div>
                                    <span className="text-xs bg-muted px-2 py-1 rounded-full text-muted-foreground shrink-0">
                                        {section.filteredMap.length} items
                                    </span>
                                </button>

                                {expandedSections.has(section.sectionId) && (
                                    <div className="border-t divide-y bg-background/50">
                                        {section.filteredMap.map((item, idx) => (
                                            <button
                                                key={`${section.sectionId}-${idx}`}
                                                onClick={() => handleJump(item.rootCfi)}
                                                className="w-full flex items-center justify-between p-2 pl-8 hover:bg-accent transition-colors text-xs group"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <div
                                                        className="w-2 h-2 rounded-full shrink-0"
                                                        style={{ backgroundColor: TYPE_COLORS[item.type] }}
                                                    />
                                                    <span className="capitalize font-mono text-muted-foreground">{item.type}</span>
                                                </div>
                                                <span className="font-mono text-[10px] text-muted-foreground/50 truncate max-w-[200px] group-hover:text-foreground">
                                                    {item.rootCfi}
                                                </span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>
        </Dialog>
    );
};
