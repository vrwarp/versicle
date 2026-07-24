import React, { useRef } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { CloudOff, Loader2, Download, Cloud, Book } from 'lucide-react';
import type { BookMetadata } from '~types/book';
import { useDriveStore } from '@store/useDriveStore';
import { getDriveLibrarySync } from '@domains/google';
import { useGoogleServicesStore } from '@store/useGoogleServicesStore';
import { getGoogleAuthClient } from '@domains/google';
import { AlertCircle } from 'lucide-react';
import { formatBytes } from '@kernel/locale/format';
import { useDrivePreview } from '../drive/useDrivePreview';

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
    const { findFile } = useDriveStore();
    const isDriveConnected = useGoogleServicesStore((state) => state.connectedServices.includes('drive'));
    const [cloudMatch, setCloudMatch] = React.useState<ReturnType<typeof findFile>>(undefined);
    // R1: verify the candidate before download — pull its real title + cover
    // via a partial fetch so the user confirms identity, not a filename guess.
    const cloudPreview = useDrivePreview(cloudMatch?.id, {
        enabled: !!cloudMatch && isDriveConnected,
        interactive: true,
        priority: 'interactive',
    });
    const [isCloudRestoring, setIsCloudRestoring] = React.useState(false);
    const [isReconnecting, setIsReconnecting] = React.useState(false);
    const [reconnectError, setReconnectError] = React.useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (open && book) {
            // BookMetadata uses 'filename' from BookSource, not 'sourceFilename'
            const match = findFile(book.title, book.filename);
            setCloudMatch(match);
        }
    }, [open, book, findFile]);

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

    const handleReconnect = async () => {
        setIsReconnecting(true);
        setReconnectError(null);
        try {
            await getGoogleAuthClient().connect('drive');
        } catch (error) {
            console.error('Failed to reconnect Drive:', error);
            setReconnectError('Failed to reconnect. Please try again.');
        } finally {
            setIsReconnecting(false);
        }
    };

    const handleCloudRestore = async () => {
        if (!cloudMatch) return;
        if (!isDriveConnected) {
            setReconnectError('Please reconnect to Google Drive first.');
            return;
        }

        setIsCloudRestoring(true);
        setReconnectError(null);
        try {
            // Download the cloud copy, then restore it onto THIS ghost via the
            // same bookId-targeted path as "Select File" (onRestore ->
            // controller.restoreBook(book.id, file)). Handing the File to the
            // generic importer instead re-matched the binary by filename then
            // title+author and -- when the Drive filename or the EPUB's embedded
            // metadata differed from the synced ghost -- imported a duplicate and
            // left the ghost unresolved.
            // User gesture: interactive token acquisition (the deleted façade's default).
            const file = await getDriveLibrarySync().downloadAsFile(cloudMatch.id, cloudMatch.name, { interactive: true });
            await onRestore(file);
        } catch (error) {
            console.error(error);
            // Toast handled by the parent restore handler; surface download
            // failures (which happen before onRestore) inline as a fallback.
            setReconnectError('Failed to restore from cloud.');
        } finally {
            setIsCloudRestoring(false);
        }
    };

    return (
        <Dialog
            isOpen={open}
            onClose={() => onOpenChange(false)}
            title="Content Missing"
            description={`The content for "${book.title}" is not on your device.`}
            footer={
                <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-3 sm:gap-2 w-full">
                    <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full sm:w-auto">
                        Cancel
                    </Button>
                    <Button 
                        variant={cloudMatch ? "outline" : "default"} 
                        onClick={handleRestoreClick} 
                        disabled={isRestoring || isCloudRestoring || isReconnecting} 
                        className="w-full sm:w-auto"
                    >
                        {isRestoring ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                <span className="sr-only" aria-live="polite">Restoring...</span>
                                <span aria-hidden="true">Restoring...</span>
                            </>
                        ) : (
                            <>
                                <Download className="mr-2 h-4 w-4" />
                                Select File
                            </>
                        )}
                    </Button>
                    {cloudMatch && (
                        <Button
                            variant="default"
                            onClick={isDriveConnected ? handleCloudRestore : handleReconnect}
                            disabled={isRestoring || isCloudRestoring || isReconnecting}
                            className="w-full sm:w-auto"
                        >
                            {isCloudRestoring ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                    <span className="sr-only" aria-live="polite">Downloading...</span>
                                    <span aria-hidden="true">Downloading...</span>
                                </>
                            ) : isReconnecting ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                                    <span aria-hidden="true">Connecting...</span>
                                </>
                            ) : isDriveConnected ? (
                                <>
                                    <Cloud className="mr-2 h-4 w-4" />
                                    Restore from Cloud
                                </>
                            ) : (
                                <>
                                    <Cloud className="mr-2 h-4 w-4" />
                                    Reconnect Drive
                                </>
                            )}
                        </Button>
                    )}
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

                {cloudMatch ? (
                    <div className={`p-3 border rounded-lg flex items-center gap-3 transition-colors ${
                        isDriveConnected 
                            ? "bg-primary/10 border-primary/20" 
                            : "bg-amber-500/10 border-amber-500/20"
                    }`}>
                        {isDriveConnected ? (
                            cloudPreview.coverUrl ? (
                                <img
                                    src={cloudPreview.coverUrl}
                                    alt=""
                                    className="h-14 w-10 rounded object-cover shrink-0 border"
                                />
                            ) : cloudPreview.loading ? (
                                <div className="h-14 w-10 rounded bg-muted flex items-center justify-center shrink-0 border">
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden="true" />
                                </div>
                            ) : cloudPreview.title ? (
                                <div className="h-14 w-10 rounded bg-muted flex items-center justify-center shrink-0 border">
                                    <Book className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                                </div>
                            ) : (
                                <Cloud className="h-5 w-5 text-primary shrink-0" />
                            )
                        ) : (
                            <CloudOff className="h-5 w-5 text-amber-500 shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                            <p className={`text-sm font-medium ${isDriveConnected ? "text-primary" : "text-amber-600"}`}>
                                {isDriveConnected
                                    ? (cloudPreview.title ? "Restore from this file?" : "Found in Google Drive")
                                    : "Drive Disconnected"}
                            </p>
                            {isDriveConnected && cloudPreview.title && (
                                <p className="text-sm font-medium text-foreground break-words">
                                    {cloudPreview.title}
                                    {cloudPreview.author ? ` — ${cloudPreview.author}` : ''}
                                </p>
                            )}
                            <p className="text-xs text-muted-foreground break-all whitespace-normal">
                                {isDriveConnected
                                    ? `"${cloudMatch.name}" (${formatBytes(cloudMatch.size)})`
                                    : "Reconnect to download this book from the cloud."}
                            </p>
                        </div>
                    </div>
                ) : (
                    <div className="text-sm text-muted-foreground space-y-2">
                        <p>To continue reading, please restore the original file:</p>
                        <ul className="list-disc pl-5 space-y-1">
                            <li>Import the original EPUB file again</li>
                            <li>Transfer it from another device</li>
                        </ul>
                    </div>
                )}

                {reconnectError && (
                    <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg flex items-center gap-2 text-destructive text-xs animate-in fade-in slide-in-from-top-1">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <p>{reconnectError}</p>
                    </div>
                )}

                <input
                    type="file"
                    accept=".epub"
                    className="hidden"
                    ref={fileInputRef}
                    onChange={handleFileSelect}
                    data-testid="restore-file-input"
                    aria-label="Select file to restore"
                />
            </div>
        </Dialog>
    );
};
