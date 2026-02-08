import React from 'react';
import { useDriveBrowser } from './useDriveBrowser';
import { Button } from '../ui/Button';
import { Loader2, Folder, ChevronRight, Home, FolderOpen, AlertCircle } from 'lucide-react';
import { ScrollArea } from '../ui/ScrollArea';
import { cn } from '../../lib/utils';
import { useToastStore } from '../../store/useToastStore';

interface DriveFolderPickerProps {
    onSelect: (folderId: string, folderName: string) => void;
    onCancel: () => void;
}

export const DriveFolderPicker: React.FC<DriveFolderPickerProps> = ({ onSelect, onCancel }) => {
    const {
        currentFolderId,
        breadcrumbs,
        items,
        isLoading,
        error,
        openFolder,
        navigateUp,
        refresh
    } = useDriveBrowser();

    const { showToast } = useToastStore();
    const [isSelecting, setIsSelecting] = React.useState(false);

    // Determine current folder name for display/selection
    const currentFolder = breadcrumbs[breadcrumbs.length - 1];

    const handleSelect = async () => {
        if (!currentFolderId || !currentFolder) return;

        setIsSelecting(true);
        try {
            // Simulate a brief delay for UX (or perform validation if needed eventually)
            await new Promise(resolve => setTimeout(resolve, 500));
            onSelect(currentFolderId, currentFolder.name);
            showToast(`Linked library to "${currentFolder.name}"`, 'success');
        } catch (error) {
            console.error("Selection failed", error);
            showToast("Failed to select folder", 'error');
            setIsSelecting(false);
        }
    };

    // Scroll breadcrumbs to end on update
    const breadcrumbsRef = React.useRef<HTMLDivElement>(null);
    React.useEffect(() => {
        if (breadcrumbsRef.current) {
            breadcrumbsRef.current.scrollLeft = breadcrumbsRef.current.scrollWidth;
        }
    }, [breadcrumbs]);

    return (
        <div className="flex flex-col h-full w-full bg-background overflow-hidden">
            {/* Header Area - Breadcrumbs only (Title handled by parent Modal) */}
            <div className="flex flex-col bg-background z-10 shrink-0">
                {/* Breadcrumb Bar */}
                <div className="px-6 pb-4 pt-4 border-b">
                    <div
                        ref={breadcrumbsRef}
                        className="flex items-center gap-1.5 overflow-x-auto no-scrollbar whitespace-nowrap text-sm scroll-smooth bg-muted/40 p-2 rounded-lg text-foreground"
                    >
                        <Home className="h-4 w-4 text-muted-foreground/70 shrink-0" />
                        <span className="text-muted-foreground/40">/</span>

                        {breadcrumbs.map((crumb, index) => {
                            const isLast = index === breadcrumbs.length - 1;
                            return (
                                <React.Fragment key={crumb.id}>
                                    {index > 0 && (
                                        <ChevronRight className="h-3 w-3 text-muted-foreground/40 shrink-0" />
                                    )}
                                    <button
                                        onClick={() => !isLast && navigateUp()}
                                        disabled={isLast}
                                        className={cn(
                                            "hover:underline transition-colors shrink-0 text-sm",
                                            isLast ? "font-semibold text-foreground pointer-events-none" : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        {crumb.name}
                                    </button>
                                </React.Fragment>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Scrollable List Content */}
            <ScrollArea className="flex-1 bg-background">
                <div className="p-2 space-y-0.5">
                    {/* Loading State: Skeleton List */}
                    {isLoading && items.length === 0 ? (
                        Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="flex items-center p-2 rounded-md animate-pulse">
                                <div className="h-9 w-9 bg-muted rounded-md mr-3" /> {/* Icon placeholder */}
                                <div className="h-4 bg-muted rounded w-2/3" /> {/* Text placeholder */}
                            </div>
                        ))
                    ) : error ? (
                        /* Error State */
                        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                            <div className="p-3 bg-destructive/10 rounded-full mb-3">
                                <AlertCircle className="h-6 w-6 text-destructive" />
                            </div>
                            <p className="font-medium text-foreground">Could not load folder</p>
                            <p className="text-sm mb-4">{error.message}</p>
                            <Button variant="outline" onClick={refresh}>Try Again</Button>
                        </div>
                    ) : items.length === 0 ? (
                        /* Empty State */
                        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                            <FolderOpen className="h-12 w-12 text-muted-foreground/20 mb-3" />
                            <p className="text-sm font-medium text-muted-foreground/60">No folders here</p>
                        </div>
                    ) : (
                        /* Loaded Items */
                        items.map((folder) => (
                            <button
                                key={folder.id}
                                onClick={() => openFolder(folder.id, folder.name)}
                                className="w-full flex items-center p-2 rounded-lg hover:bg-accent transition-colors text-left group focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary/20"
                            >
                                {/* Folder Icon */}
                                <div className="mr-3 shrink-0">
                                    <Folder className="h-5 w-5 text-blue-500 fill-blue-500/20" />
                                </div>

                                {/* Folder Name */}
                                <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium truncate block text-foreground">{folder.name}</span>
                                </div>

                                {/* Action Indicator */}
                                <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                            </button>
                        ))
                    )}
                </div>
            </ScrollArea>


            {/* Fixed Action Footer */}
            <div className="p-6 border-t bg-background shrink-0 flex items-center justify-end gap-3">
                <Button variant="ghost" onClick={onCancel} disabled={isSelecting}>
                    Cancel
                </Button>
                <Button
                    onClick={handleSelect}
                    disabled={isLoading || !!error || isSelecting}
                    className="min-w-[140px] shadow-sm"
                >
                    {isSelecting ? (
                        <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Selecting...
                        </>
                    ) : (
                        "Select This Folder"
                    )}
                </Button>
            </div>
        </div>
    );
};
