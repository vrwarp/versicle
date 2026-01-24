import React, { useRef } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { CloudOff, Loader2, Download } from 'lucide-react';
import type { BookMetadata } from '../../types/db';

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

    const handleRestoreClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            await onRestore(file);
            // Close handled by parent potentially, or we close here?
            // Usually parent updates state on success.
        }
        // Reset input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    return (
        <Dialog
            isOpen={open}
            onClose={() => onOpenChange(false)}
            title="Content Missing"
            description={`The content for "${book.title}" is not on your device.`}
            footer={
                <div className="flex justify-end gap-2 w-full">
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleRestoreClick} disabled={isRestoring}>
                        {isRestoring ? (
                            <>
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                Restoring...
                            </>
                        ) : (
                            <>
                                <Download className="mr-2 h-4 w-4" />
                                Restore File
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

                <div className="text-sm text-muted-foreground space-y-2">
                    <p>To continue reading, please restore the original file:</p>
                    <ul className="list-disc pl-5 space-y-1">
                        <li>Import the original EPUB file again</li>
                        <li>Transfer it from another device</li>
                    </ul>
                </div>

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
