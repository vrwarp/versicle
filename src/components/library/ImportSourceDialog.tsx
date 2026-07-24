import React, { useMemo } from 'react';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Cloud, HardDrive } from 'lucide-react';
import { useDriveStore } from '@store/useDriveStore';
import { useBookStore } from '@store/useBookStore';
import { formatRelativeTime } from '@kernel/locale/format';

interface ImportSourceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onImportFromDevice: () => void;
    onImportFromDrive: () => void;
}

export const ImportSourceDialog: React.FC<ImportSourceDialogProps> = ({
    open,
    onOpenChange,
    onImportFromDevice,
    onImportFromDrive,
}) => {
    // R6: "new on Drive" awareness — count files in the PERSISTED index that
    // aren't already in the library. Read-only: this never triggers a scan
    // (the empty-index auto-scan lives in checkForNewFiles, which we don't call).
    const driveIndex = useDriveStore((s) => s.index);
    const linkedFolderId = useDriveStore((s) => s.linkedFolderId);
    const lastScanTime = useDriveStore((s) => s.lastScanTime);
    const books = useBookStore((s) => s.books);
    const newCount = useMemo(() => {
        if (!linkedFolderId || driveIndex.length === 0) return 0;
        const have = new Set(Object.values(books).map((b) => b.sourceFilename));
        return driveIndex.filter((f) => !have.has(f.name)).length;
    }, [driveIndex, linkedFolderId, books]);

    return (
        <Modal open={open} onOpenChange={onOpenChange}>
            <ModalContent className="sm:max-w-md">
                <ModalHeader>
                    <ModalTitle>Import Books</ModalTitle>
                    <ModalDescription>
                        Choose where you want to import EPUB files from.
                    </ModalDescription>
                </ModalHeader>
                <div className="grid grid-cols-2 gap-4 py-4">
                    <Button
                        variant="outline"
                        className="h-32 flex flex-col items-center justify-center gap-4 hover:bg-accent hover:text-accent-foreground"
                        onClick={() => {
                            onImportFromDevice();
                            onOpenChange(false);
                        }}
                    >
                        <div className="p-3 rounded-full bg-primary/10 text-primary">
                            <HardDrive className="h-8 w-8" />
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <span className="font-semibold text-lg">My Device</span>
                            <span className="text-xs text-muted-foreground text-center">Local files</span>
                        </div>
                    </Button>

                    <Button
                        variant="outline"
                        className="h-32 flex flex-col items-center justify-center gap-4 hover:bg-accent hover:text-accent-foreground"
                        onClick={() => {
                            onImportFromDrive();
                            onOpenChange(false);
                        }}
                    >
                        <div className="relative p-3 rounded-full bg-primary/10 text-primary">
                            <Cloud className="h-8 w-8" />
                            {newCount > 0 && (
                                <span
                                    className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-primary text-primary-foreground text-xs font-semibold flex items-center justify-center"
                                    aria-label={`${newCount} new on Drive`}
                                >
                                    {newCount > 99 ? '99+' : newCount}
                                </span>
                            )}
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <span className="font-semibold text-lg">Google Drive</span>
                            <span className="text-xs text-muted-foreground text-center">
                                {newCount > 0
                                    ? `${newCount} new`
                                    : linkedFolderId
                                        ? `Last scan ${lastScanTime ? formatRelativeTime(lastScanTime) : 'never'}`
                                        : 'Cloud storage'}
                            </span>
                        </div>
                    </Button>
                </div>
                <div className="flex justify-end">
                    <Button variant="ghost" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                </div>
            </ModalContent>
        </Modal>
    );
};
