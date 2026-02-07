import React from 'react';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Cloud, HardDrive } from 'lucide-react';

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
                        <div className="p-3 rounded-full bg-blue-50 text-blue-600 dark:bg-blue-900/20 dark:text-blue-400">
                            <Cloud className="h-8 w-8" />
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <span className="font-semibold text-lg">Google Drive</span>
                            <span className="text-xs text-muted-foreground text-center">Cloud storage</span>
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
