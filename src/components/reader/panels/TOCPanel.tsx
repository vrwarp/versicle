import React from 'react';
import type { NavigationItem } from 'epubjs';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/Tabs';
import { Switch } from '../../ui/Switch';
import { Label } from '../../ui/Label';
import { Button } from '../../ui/Button';
import { Wand2 } from 'lucide-react';
import { cn } from '../../../lib/utils';
import { ReadingHistoryPanel } from '../ReadingHistoryPanel';
import { DeviceIcon } from '../DeviceIcon';
import type { Rendition } from 'epubjs';

export interface DeviceMarker {
    id: string;
    name: string;
    platform: string;
}

export interface TOCPanelProps {
    toc: NavigationItem[];
    syntheticToc: NavigationItem[];
    useSyntheticToc: boolean;
    onUseSyntheticTocChange: (value: boolean) => void;
    activeTocId: string | undefined;
    deviceMarkers: Record<string, DeviceMarker[]>;
    onNavigate: (href: string) => void;
    // Smart TOC enhancement
    isEnhancing: boolean;
    tocProgress: { current: number; total: number } | null;
    onEnhanceTOC: () => void;
    // History tab
    bookId: string;
    rendition?: Rendition;
    historyTick: number;
    onHistoryNavigate: (cfi: string) => void;
}

export const TOCPanel: React.FC<TOCPanelProps> = ({
    toc,
    syntheticToc,
    useSyntheticToc,
    onUseSyntheticTocChange,
    activeTocId,
    deviceMarkers,
    onNavigate,
    isEnhancing,
    tocProgress,
    onEnhanceTOC,
    bookId,
    rendition,
    historyTick,
    onHistoryNavigate
}) => {
    const renderTOCItem = (item: NavigationItem, index: number, level: number = 0, parentId: string = 'toc-item') => {
        const hasSubitems = item.subitems && item.subitems.length > 0;
        const showSubitems = hasSubitems && level < 2;

        const currentId = `${parentId}-${index}`;
        const isActive = item.id === activeTocId;

        const itemHref = item.href.split('#')[0];
        const markers = deviceMarkers[itemHref] || deviceMarkers[item.href];

        return (
            <li key={item.id}>
                <button
                    data-testid={currentId}
                    className={cn(
                        "text-left w-full text-sm py-1 block truncate transition-colors flex items-center justify-between group",
                        isActive ? "text-primary font-medium bg-accent/50 rounded-md px-2 -ml-2" : "text-muted-foreground hover:text-primary"
                    )}
                    style={{ paddingLeft: `${level * 1.0 + (isActive ? 0.5 : 0)}rem` }}
                    onClick={() => onNavigate(item.href)}
                >
                    <span className="truncate">{item.label.trim()}</span>
                    {markers && markers.length > 0 && (
                        <div className="flex -space-x-1 ml-2 flex-shrink-0" title={`Read by: ${markers.map(m => m.name).join(', ')}`}>
                            {markers.map(m => (
                                <div key={m.id} className="bg-background rounded-full p-0.5 border border-border shadow-sm ring-1 ring-background z-10">
                                    <DeviceIcon platform={m.platform} className="w-3 h-3 text-primary/70" />
                                </div>
                            ))}
                        </div>
                    )}
                </button>
                {showSubitems && (
                    <ul className="space-y-1 mt-1">
                        {item.subitems!.map((subitem, subIndex) => renderTOCItem(subitem, subIndex, level + 1, currentId))}
                    </ul>
                )}
            </li>
        );
    };

    return (
        <div data-testid="reader-toc-sidebar" className="w-64 shrink-0 bg-surface border-r border-border z-50 absolute inset-y-0 left-0 md:static flex flex-col">
            <Tabs defaultValue="chapters" className="w-full h-full flex flex-col">
                <div className="p-4 pb-0">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="chapters" data-testid="tab-chapters">Chapters</TabsTrigger>
                        <TabsTrigger value="history" data-testid="tab-history">History</TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="chapters" className="flex-1 overflow-y-auto mt-2 min-h-0">
                    <div className="p-4 pt-0">
                        <div className="flex flex-col gap-3 mb-4 mt-2">
                            <div className="flex items-center space-x-2">
                                <Switch
                                    id="synthetic-toc-mode"
                                    checked={useSyntheticToc}
                                    onCheckedChange={onUseSyntheticTocChange}
                                />
                                <Label htmlFor="synthetic-toc-mode" className="text-sm font-medium">Generated Titles</Label>
                            </div>

                            {useSyntheticToc && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    className="w-full text-xs"
                                    onClick={onEnhanceTOC}
                                    disabled={isEnhancing}
                                >
                                    {isEnhancing ? (
                                        <span>Enhancing... {tocProgress ? `(${tocProgress.current}/${tocProgress.total})` : ''}</span>
                                    ) : (
                                        <>
                                            <Wand2 className="w-3 h-3 mr-2" />
                                            Enhance Titles with AI
                                        </>
                                    )}
                                </Button>
                            )}
                        </div>

                        <ul className="space-y-2">
                            {(useSyntheticToc ? syntheticToc : toc).map((item, index) => renderTOCItem(item, index))}
                            {useSyntheticToc && syntheticToc.length === 0 && (
                                <li className="text-sm text-muted-foreground">No generated titles available.</li>
                            )}
                        </ul>
                    </div>
                </TabsContent>

                <TabsContent value="history" className="flex-1 overflow-y-auto mt-0 min-h-0 data-[state=active]:flex data-[state=active]:flex-col">
                    <ReadingHistoryPanel
                        bookId={bookId}
                        rendition={rendition ?? null}
                        trigger={historyTick}
                        onNavigate={onHistoryNavigate}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
};
