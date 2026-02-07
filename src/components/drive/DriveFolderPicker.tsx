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
        <div className="flex flex-col h-[600px] w-full max-w-2xl bg-background border rounded-lg shadow-lg overflow-hidden">
            {/* Header Area */}
            <div className="flex flex-col border-b bg-background z-10 shrink-0">
                {/* Top Bar */}
                <div className="p-4 flex items-center justify-between">
                    <h2 className="text-lg font-semibold">Select Library Folder</h2>
                    {/* Close button is handled by Dialog usually, but we can add one if needed or rely on onCancel */}
                </div>

                {/* Breadcrumb Bar */}
                <div
                    ref={breadcrumbsRef}
                    className="px-4 pb-3 flex items-center gap-1 overflow-x-auto no-scrollbar whitespace-nowrap text-sm scroll-smooth"
                >
                    <Home className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-muted-foreground">/</span>

                    {breadcrumbs.map((crumb, index) => {
                        const isLast = index === breadcrumbs.length - 1;
                        return (
                            <React.Fragment key={crumb.id}>
                                {index > 0 && (
                                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                                )}
                                <button
                                    onClick={() => !isLast && navigateUp()} // Simple navigate up for now, recursive back later
                                    disabled={isLast}
                                    className={cn(
                                        "hover:underline transition-colors shrink-0",
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

            {/* Scrollable List Content */}
            <ScrollArea className="flex-1 bg-background/50">
                <div className="p-2 space-y-1">
                    {/* Loading State: Skeleton List */}
                    {isLoading && items.length === 0 ? (
                        Array.from({ length: 8 }).map((_, i) => (
                            <div key={i} className="flex items-center p-3 rounded-md animate-pulse">
                                <div className="h-10 w-10 bg-muted rounded-md mr-3" /> {/* Icon placeholder */}
                                <div className="h-4 bg-muted rounded w-2/3" /> {/* Text placeholder */}
                            </div>
                        ))
                    ) : error ? (
                        /* Error State */
                        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                            <div className="p-3 bg-red-100 dark:bg-red-900/20 rounded-full mb-3">
                                <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
                            </div>
                            <p className="font-medium text-foreground">Could not load folder</p>
                            <p className="text-sm mb-4">{error.message}</p>
                            <Button variant="outline" onClick={refresh}>Try Again</Button>
                        </div>
                    ) : items.length === 0 ? (
                        /* Empty State */
                        <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
                            <FolderOpen className="h-12 w-12 text-muted-foreground/30 mb-3" />
                            <p>No folders here.</p>
                        </div>
                    ) : (
                        /* Loaded Items */
                        items.map((folder) => (
                            <button
                                key={folder.id}
                                onClick={() => openFolder(folder.id, folder.name)}
                                className="w-full flex items-center p-3 rounded-md hover:bg-accent transition-colors text-left group focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
                            >
                                {/* Folder Icon */}
                                <div className="mr-3">
                                    <Folder className="h-6 w-6 text-blue-500 fill-blue-500/10" />
                                </div>

                                {/* Folder Name */}
                                <div className="flex-1 min-w-0">
                                    <span className="text-sm font-medium truncate block">{folder.name}</span>
                                </div>

                                {/* Action Indicator */}
                                <ChevronRight className="h-4 w-4 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
                            </button>
                        ))
                    )}
                </div>
            </ScrollArea>

            {/* Fixed Action Footer */}
            <div className="p-4 border-t bg-background shrink-0 flex items-center justify-between gap-4">
                <div className="flex flex-col min-w-0">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Current Selection</span>
                    <span className="text-sm font-medium truncate text-foreground" title={currentFolder?.name}>
                        {currentFolder?.name || 'Loading...'}
                    </span>
                </div>

                <div className="flex items-center gap-3">
                    <Button variant="ghost" onClick={onCancel} disabled={isSelecting}>
                        Cancel
                    </Button>
                    <Button
                        onClick={handleSelect}
                        disabled={isLoading || !!error || isSelecting}
                        className="min-w-[140px]"
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
        </div>
    );
};
