import React, { useRef, useMemo, useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { CloudOff, Loader2, Download, CloudDownload } from 'lucide-react';
import type { BookMetadata } from '../../types/db';
import { useDriveStore } from '../../store/useDriveStore';
import { GoogleDriveService } from '../../lib/drive/GoogleDriveService';
import { useToastStore } from '../../store/useToastStore';
import { createLogger } from '../../lib/logger';
import { useShallow } from 'zustand/react/shallow';

const logger = createLogger('ContentMissingDialog');

interface ContentMissingDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    book: BookMetadata;
    onRestore: (file: File) => Promise<void>;
    isRestoring?: boolean;
}

export const ContentMissingDialog: React.FC<ContentMissingDialogProps> = ({
    open,
    onOpenChange,
    book,
    onRestore,
    isRestoring = false,
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { files: driveFiles, accessToken } = useDriveStore(useShallow(state => ({
        files: state.files,
        accessToken: state.accessToken
    })));
    const showToast = useToastStore(state => state.showToast);
    const [isDriveRestoring, setIsDriveRestoring] = useState(false);

    // Find match in Drive
    const driveMatch = useMemo(() => {
        if (!driveFiles || !book) return null;
        const normalize = (s: string) => s?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
        const targetTitle = normalize(book.title);

        // Find file that contains the title
        return driveFiles.find(f => {
            const fName = normalize(f.name);
            return fName.includes(targetTitle);
        });
    }, [driveFiles, book]);

    const handleRestoreClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            await onRestore(file);
        }
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleDriveRestore = async () => {
        if (!driveMatch || !accessToken) return;

        setIsDriveRestoring(true);
        try {
            const blob = await GoogleDriveService.getFile(driveMatch.id, accessToken);
            const file = new File([blob], driveMatch.name, { type: 'application/epub+zip' });
            await onRestore(file);
            showToast('Restored from Drive', 'success');
        } catch (error) {
            logger.error('Drive restore failed', error);
            showToast('Failed to restore from Drive', 'error');
        } finally {
            setIsDriveRestoring(false);
        }
    };

    const isLoading = isRestoring || isDriveRestoring;

    return (
        <Dialog
            isOpen={open}
            onClose={() => !isLoading && onOpenChange(false)}
            title="Content Missing"
            description={`The content for "${book?.title}" is not on your device.`}
            footer={
                <div className="flex justify-between w-full">
                    <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isLoading}>
                        Cancel
                    </Button>
                    <div className="flex gap-2">
                        {driveMatch && accessToken && (
                            <Button
                                variant="secondary"
                                onClick={handleDriveRestore}
                                disabled={isLoading}
                                className="gap-2"
                            >
                                {isDriveRestoring ? <Loader2 className="h-4 w-4 animate-spin" /> : <CloudDownload className="h-4 w-4" />}
                                Restore from Drive
                            </Button>
                        )}
                        <Button onClick={handleRestoreClick} disabled={isLoading}>
                            {isRestoring && !isDriveRestoring ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Restoring...
                                </>
                            ) : (
                                <>
                                    <Download className="mr-2 h-4 w-4" />
                                    Upload File
                                </>
                            )}
                        </Button>
                    </div>
                </div>
            }
        >
            <div className="space-y-4">
                <div className="p-4 bg-muted/20 border rounded-lg flex items-start gap-3">
                    <CloudOff className="h-5 w-5 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="space-y-1">
                        <p className="text-sm font-medium">Ghost Book</p>
                        <p className="text-xs text-muted-foreground">
                            Reading progress and metadata are synced, but the book file (EPUB) is missing locally.
                        </p>
                    </div>
                </div>

                {driveMatch && accessToken ? (
                    <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-md text-sm text-green-700 dark:text-green-400 flex gap-2 items-center">
                        <CloudDownload className="h-4 w-4" />
                        <span>Found "{driveMatch.name}" in Google Drive.</span>
                    </div>
                ) : (
                    <div className="text-sm text-muted-foreground space-y-2">
                        <p>To continue reading, please restore the original file:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Import the original EPUB file again</li>
                            <li>Transfer it from another device</li>
                            {useDriveStore.getState().isConnected && !driveMatch && <li>(No match found in connected Google Drive folder)</li>}
                        </ul>
                    </div>
                )}

                <input
                    type="file"
                    accept=".epub"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    data-testid="restore-file-input"
                />
            </div>
        </Dialog>
    );
};
