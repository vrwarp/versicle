import React, { useRef } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { CloudOff, Loader2, Download, Cloud } from 'lucide-react';
import type { BookMetadata } from '../../types/db';
import { useDriveStore } from '../../store/useDriveStore';
import { DriveScannerService } from '../../lib/drive/DriveScannerService';

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
    const [cloudMatch, setCloudMatch] = React.useState<ReturnType<typeof findFile>>(undefined);
    const [isCloudRestoring, setIsCloudRestoring] = React.useState(false);
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

    const handleCloudRestore = async () => {
        if (!cloudMatch) return;
        setIsCloudRestoring(true);
        try {
            // we bypass the parent onRestore and go direct to ScannerService -> Library
            // or we could fetch blob and pass to onRestore(new File(...))
            // Let's use ScannerService as it encapsulates the download
            await DriveScannerService.importFile(cloudMatch.id, cloudMatch.name, { overwrite: true });
            onOpenChange(false);
        } catch (error) {
            console.error(error);
            // Toast handled by service usually, but let's be safe
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
                    {cloudMatch && (
                        <Button
                            variant="secondary"
                            onClick={handleCloudRestore}
                            disabled={isRestoring || isCloudRestoring}
                            className="w-full sm:w-auto"
                        >
                            {isCloudRestoring ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Downloading...
                                </>
                            ) : (
                                <>
                                    <Cloud className="mr-2 h-4 w-4" />
                                    Restore from Cloud
                                </>
                            )}
                        </Button>
                    )}
                    <Button onClick={handleRestoreClick} disabled={isRestoring || isCloudRestoring} className="w-full sm:w-auto">
                        {isRestoring ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Restoring...
                            </>
                        ) : (
                            <>
                                <Download className="mr-2 h-4 w-4" />
                                Select File
                            </>
                        )}
                    </Button>
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
                    <div className="p-3 bg-primary/10 border border-primary/20 rounded-lg flex items-center gap-3">
                        <Cloud className="h-5 w-5 text-primary shrink-0" />
                        <div className="flex-1">
                            <p className="text-sm font-medium text-primary">Found in Google Drive</p>
                            <p className="text-xs text-muted-foreground break-all whitespace-normal">
                                "{cloudMatch.name}" ({(cloudMatch.size / 1024 / 1024).toFixed(1)} MB)
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
