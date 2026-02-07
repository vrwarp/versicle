import React, { useState, useMemo } from 'react';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription } from '../ui/Modal';
import { Input } from '../ui/Input';
import { Button } from '../ui/Button';
import { Search, Download, Loader2, Cloud } from 'lucide-react';
import { useDriveStore, type DriveFileIndex } from '../../store/useDriveStore';
import { DriveScannerService } from '../../lib/drive/DriveScannerService';
import { useToastStore } from '../../store/useToastStore';

function formatRelativeTime(timestamp: number | null): string {
    if (!timestamp) return 'Never';
    const now = Date.now();
    const diff = now - timestamp;

    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

interface DriveImportDialogProps {
    isOpen: boolean;
    onClose: () => void;
}

export const DriveImportDialog: React.FC<DriveImportDialogProps> = ({ isOpen, onClose }) => {
    const [searchQuery, setSearchQuery] = useState('');
    const [importingId, setImportingId] = useState<string | null>(null);

    const { index, lastScanTime, isScanning } = useDriveStore();
    const showToast = useToastStore(state => state.showToast);

    // Client-side search (instant)
    const filteredFiles = useMemo(() => {
        if (!index) return [];
        if (!searchQuery.trim()) return index.slice(0, 50); // Show recent/top 50 empty
        const lowerQuery = searchQuery.toLowerCase();
        return index.filter(file => file.name.toLowerCase().includes(lowerQuery));
    }, [index, searchQuery]);

    const handleImport = async (file: DriveFileIndex) => {
        if (importingId) return; // Prevent multiple
        setImportingId(file.id);
        try {
            await DriveScannerService.importFile(file.id, file.name);
            showToast(`Imported "${file.name}"`, 'success');
        } catch (error) {
            console.error(error);
            showToast(`Failed to import "${file.name}"`, 'error');
        } finally {
            setImportingId(null);
        }
    };

    const handleRefresh = async () => {
        try {
            await DriveScannerService.scanAndIndex();
        } catch (err) {
            showToast('Failed to refresh index', 'error');
        }
    };

    return (
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
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-9"
                            autoFocus
                        />
                    </div>
                    <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                        <span>
                            {index?.length || 0} files indexed • Last scan: {formatRelativeTime(lastScanTime)}
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
                                    <Loader2 className="w-3 h-3 animate-spin" />
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
                            {filteredFiles.map((file) => (
                                <div
                                    key={file.id}
                                    className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 group transition-colors border border-transparent hover:border-border"
                                >
                                    <div className="flex-1 min-w-0 pr-4">
                                        <p className="font-medium truncate text-sm text-foreground">{file.name}</p>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {(file.size / 1024 / 1024).toFixed(2)} MB • {new Date(file.modifiedTime).toLocaleDateString()}
                                        </p>
                                    </div>
                                    <Button
                                        size="sm"
                                        variant={importingId === file.id ? "ghost" : "secondary"}
                                        onClick={() => handleImport(file)}
                                        disabled={!!importingId}
                                        className="shrink-0"
                                    >
                                        {importingId === file.id ? (
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                        ) : (
                                            <>
                                                <Download className="w-4 h-4 mr-2" />
                                                Import
                                            </>
                                        )}
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className="p-4 border-t bg-background flex justify-end gap-2">
                    <Button variant="outline" onClick={onClose}>Close</Button>
                </div>
            </ModalContent>
        </Modal>
    );
};
