import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Search, Download, Loader2, Cloud, X, Book } from 'lucide-react';
import { cn } from '@lib/utils';
import { useDriveStore, type DriveFileIndex } from '@store/useDriveStore';
import { getDriveLibrarySync } from '@domains/google';
import { useToastStore } from '@store/useToastStore';
import { useDebounce } from '@hooks/useDebounce';
import { formatBytes, formatDate, formatRelativeTime } from '@kernel/locale/format';
import { useDrivePreview } from './useDrivePreview';
import { DrivePreviewSheet } from './DrivePreviewSheet';

/** Fires once the element scrolls into view — the R4 lazy-hydration trigger. */
function useInView<T extends Element>(): [React.RefObject<T | null>, boolean] {
    const ref = useRef<T | null>(null);
    const [inView, setInView] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el || inView) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((e) => e.isIntersecting)) setInView(true);
        }, { rootMargin: '200px' });
        observer.observe(el);
        return () => observer.disconnect();
    }, [inView]);
    return [ref, inView];
}

interface DriveFileRowProps {
    file: DriveFileIndex;
    importing: boolean;
    disabled: boolean;
    onImport: (file: DriveFileIndex) => void;
    onOpenPreview: (file: DriveFileIndex) => void;
}

/**
 * One Drive file row (R4). Hydrates its cover + verified title/author lazily
 * once scrolled into view (cache-first; the fetch is cancelled on scroll-out
 * via the hook's AbortSignal). Falls back to exactly the old filename+size row
 * when no preview is available — never a broken card.
 */
const DriveFileRow: React.FC<DriveFileRowProps> = React.memo(({ file, importing, disabled, onImport, onOpenPreview }) => {
    const [ref, inView] = useInView<HTMLDivElement>();
    const preview = useDrivePreview(file.id, { enabled: inView, priority: 'viewport' });
    const title = preview.title || file.name;

    return (
        <div
            ref={ref}
            className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 group transition-colors border border-transparent hover:border-border cursor-pointer"
            onClick={() => onOpenPreview(file)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter') onOpenPreview(file); }}
        >
            <div className="w-10 h-14 shrink-0 rounded overflow-hidden bg-muted flex items-center justify-center border">
                {preview.coverUrl ? (
                    <img src={preview.coverUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                    <Book className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
                )}
            </div>
            <div className="flex-1 min-w-0 pr-2">
                <p className="font-medium truncate text-sm text-foreground">{title}</p>
                {preview.author && (
                    <p className="text-xs text-muted-foreground truncate">{preview.author}</p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                    {formatBytes(file.size)} • {formatDate(file.modifiedTime)}
                </p>
            </div>
            <Button
                size="sm"
                variant={importing ? 'ghost' : 'secondary'}
                onClick={(e) => { e.stopPropagation(); onImport(file); }}
                disabled={disabled}
                className="shrink-0"
            >
                {importing ? (
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                ) : (
                    <>
                        <Download className="w-4 h-4 mr-2" />
                        Import
                    </>
                )}
            </Button>
        </div>
    );
});
DriveFileRow.displayName = 'DriveFileRow';

interface DriveImportDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export const DriveImportDialog: React.FC<DriveImportDialogProps> = ({ isOpen, onClose }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearchQuery = useDebounce(searchQuery, 300);
    const [importingId, setImportingId] = useState<string | null>(null);
    const [previewFile, setPreviewFile] = useState<DriveFileIndex | null>(null);

    const { index, lastScanTime, isScanning } = useDriveStore();
    const showToast = useToastStore(state => state.showToast);

    // Client-side search (instant)
    const filteredFiles = useMemo(() => {
        if (!index) return [];
        if (!debouncedSearchQuery.trim()) return index.slice(0, 50); // Show recent/top 50 empty
        const lowerQuery = debouncedSearchQuery.toLowerCase();
        return index.filter(file => file.name.toLowerCase().includes(lowerQuery));
    }, [index, debouncedSearchQuery]);

    const handleImport = useCallback(async (file: DriveFileIndex) => {
        if (importingId) return; // Prevent multiple
        setImportingId(file.id);
        try {
            // User gesture: interactive token acquisition (the deleted façade's default).
            await getDriveLibrarySync().importFile(file.id, file.name, undefined, { interactive: true });
            showToast(`Imported "${file.name}"`, 'success');
        } catch (error) {
            console.error(error);
            showToast(`Failed to import "${file.name}"`, 'error');
        } finally {
            setImportingId(null);
        }
    }, [importingId, showToast]);

    const handleRefresh = async () => {
        try {
            await getDriveLibrarySync().scanAndIndex();
        } catch {
            showToast('Failed to refresh index', 'error');
        }
    };

    const renderedFiles = useMemo(() => filteredFiles.map((file) => (
        <DriveFileRow
            key={file.id}
            file={file}
            importing={importingId === file.id}
            disabled={!!importingId}
            onImport={handleImport}
            onOpenPreview={setPreviewFile}
        />
    )), [filteredFiles, importingId, handleImport]);

    return (
        <>
        <Modal open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <ModalContent className="max-w-2xl h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
                <ModalHeader className="p-6 pb-2 border-b">
                    <ModalTitle className="flex items-center gap-2">
                        <Cloud className="w-5 h-5 text-primary" />
                        Import from Drive
                    </ModalTitle>
                    <ModalDescription>
                        Search your indexed Google Drive library instantly.
                    </ModalDescription>
                </ModalHeader>

                <div className="p-4 border-b bg-muted/30 space-y-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                            placeholder="Search by filename..."
                            aria-label="Search by filename"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className={cn("pl-9", searchQuery && "pr-9")}
                            autoFocus
                        />
                        {searchQuery && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
                                onClick={() => setSearchQuery('')}
                                aria-label="Clear search"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                    {/* Live region for screen readers */}
                    <div role="status" aria-live="polite" className="sr-only">
                        {debouncedSearchQuery ? (
                            filteredFiles.length === 0
                                ? 'No matching files found'
                                : `${filteredFiles.length} files found`
                        ) : ''}
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                        <span>
                            {index?.length || 0} files indexed • Last scan: {lastScanTime ? formatRelativeTime(lastScanTime) : 'Never'}
                        </span>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto p-0 text-xs hover:bg-transparent hover:underline"
                            onClick={handleRefresh}
                            disabled={isScanning}
                        >
                            {isScanning ? (
                                <div className="flex items-center gap-1">
                                    <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                                    Scanning...
                                </div>
                            ) : "Refresh Index"}
                        </Button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-2 scrollbar-thin">
                    {filteredFiles.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-40 text-muted-foreground text-sm">
                            <p>No matching files found.</p>
                            {index?.length === 0 && <p className="mt-2 text-xs">Try refreshing the index.</p>}
                        </div>
                    ) : (
                        <div className="space-y-1">
                            {/* OPTIMIZATION: Memoize mapped output and debounce search to prevent O(N) filtering and VDOM allocation on every keystroke. */}
                            {renderedFiles}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t bg-background flex justify-between gap-2">
                    <Button
                        variant="secondary"
                        onClick={handleRefresh}
                        disabled={isScanning}
                    >
                        {isScanning ? (
                            <div className="flex items-center gap-2">
                                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                Syncing...
                            </div>
                        ) : "Manual Sync"}
                    </Button>
                    <Button variant="outline" onClick={onClose}>Close</Button>
                </div>
            </ModalContent>
        </Modal>
        <DrivePreviewSheet
            file={previewFile}
            importing={!!previewFile && importingId === previewFile.id}
            onClose={() => setPreviewFile(null)}
            onImport={(file) => { setPreviewFile(null); handleImport(file); }}
        />
        </>
    );
};
