import React, { useState, useMemo } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useDriveStore } from '../../store/useDriveStore';
import { GoogleDriveService } from '../../lib/drive/GoogleDriveService';
import { useLibraryStore } from '../../store/useLibraryStore';
import { Loader2, Download, Search, AlertCircle, RefreshCw } from 'lucide-react';
import { Input } from '../ui/Input';
import { useToastStore } from '../../store/useToastStore';
import { useShallow } from 'zustand/react/shallow';
import { createLogger } from '../../lib/logger';

const logger = createLogger('DriveImportDialog');

interface DriveImportDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

export const DriveImportDialog: React.FC<DriveImportDialogProps> = ({ open, onOpenChange }) => {
    const {
        files,
        accessToken,
        folderId,
        setFiles
    } = useDriveStore(useShallow(state => ({
        files: state.files,
        accessToken: state.accessToken,
        folderId: state.folderId,
        setFiles: state.setFiles
    })));

    const addBook = useLibraryStore(state => state.addBook);
    const showToast = useToastStore(state => state.showToast);

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');
    const [isImporting, setIsImporting] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Filter files
    const filteredFiles = useMemo(() => {
        if (!searchQuery) return files;
        const lower = searchQuery.toLowerCase();
        return files.filter(f => f.name.toLowerCase().includes(lower));
    }, [files, searchQuery]);

    const handleSelect = (id: string) => {
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const handleRefresh = async () => {
        if (!accessToken || !folderId) return;
        setIsRefreshing(true);
        try {
            const list = await GoogleDriveService.listFiles(folderId, accessToken);
            setFiles(list);
            showToast(`Refreshed: ${list.length} files found`, 'success');
        } catch (error) {
            logger.error('Refresh failed', error);
            showToast('Failed to refresh list. Check connection.', 'error');
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleImport = async () => {
        if (selectedIds.size === 0) return;
        if (!accessToken) {
            showToast('Drive not connected', 'error');
            return;
        }

        setIsImporting(true);
        let successCount = 0;
        let failCount = 0;

        try {
            const filesToImport = files.filter(f => selectedIds.has(f.id));

            for (const fileMeta of filesToImport) {
                try {
                    // Download Blob
                    const blob = await GoogleDriveService.getFile(fileMeta.id, accessToken);
                    // Create File object
                    const file = new File([blob], fileMeta.name, { type: 'application/epub+zip' });
                    // Import
                    await addBook(file);
                    successCount++;
                } catch (error) {
                    logger.error(`Failed to import ${fileMeta.name}`, error);
                    failCount++;
                }
            }

            if (successCount > 0) {
                showToast(`Imported ${successCount} books successfully`, 'success');
                onOpenChange(false);
                setSelectedIds(new Set());
            }
            if (failCount > 0) {
                showToast(`Failed to import ${failCount} books`, 'error');
            }

        } catch (error) {
            logger.error('Batch import failed', error);
            showToast('Import process interrupted', 'error');
        } finally {
            setIsImporting(false);
        }
    };

    // Render logic
    const canRefresh = !!accessToken && !!folderId;

    return (
        <Dialog
            isOpen={open}
            onClose={() => onOpenChange(false)}
            title="Import from Google Drive"
            description={folderId ? "Select books to import from your shared folder." : "No folder connected."}
            footer={
                <div className="flex justify-between w-full">
                    <Button
                        variant="ghost"
                        onClick={handleRefresh}
                        disabled={!canRefresh || isRefreshing || isImporting}
                    >
                        {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                        Refresh
                    </Button>

                    <div className="flex gap-2">
                        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isImporting}>
                            Cancel
                        </Button>
                        <Button onClick={handleImport} disabled={selectedIds.size === 0 || isImporting}>
                            {isImporting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Importing...
                                </>
                            ) : (
                                <>
                                    <Download className="mr-2 h-4 w-4" />
                                    Import ({selectedIds.size})
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="space-y-4">
                {!folderId ? (
                    <div className="flex flex-col items-center justify-center p-8 text-center text-muted-foreground bg-muted/20 rounded-lg border border-dashed">
                        <AlertCircle className="h-10 w-10 mb-2" />
                        <p>No Google Drive folder connected.</p>
                        <p className="text-sm">Please go to Settings &gt; Sync & Cloud to set up a shared folder.</p>
                    </div>
                ) : (
                    <>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Search files..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pl-9"
                            />
                        </div>

                        <div className="h-[300px] overflow-y-auto border rounded-md divide-y">
                            {filteredFiles.length === 0 ? (
                                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                    <p>No files found.</p>
                                </div>
                            ) : (
                                filteredFiles.map(file => {
                                    const isSelected = selectedIds.has(file.id);
                                    return (
                                        <div
                                            key={file.id}
                                            className={`flex items-center p-3 hover:bg-muted/50 cursor-pointer ${isSelected ? 'bg-primary/10' : ''}`}
                                            onClick={() => handleSelect(file.id)}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isSelected}
                                                onChange={() => {}} // Handled by div click
                                                className="mr-3 h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-medium text-sm truncate" title={file.name}>{file.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {file.size ? `${(parseInt(file.size) / 1024 / 1024).toFixed(2)} MB` : 'Unknown size'}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        <div className="flex justify-between text-xs text-muted-foreground px-1">
                            <span>{selectedIds.size} selected</span>
                            <span>{filteredFiles.length} available</span>
                        </div>
                    </>
                )}
            </div>
        </Dialog>
    );
};
