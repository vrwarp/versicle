import React, { useState } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { type BookMetadata } from '../../types/db';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Loader2 } from 'lucide-react';
import { createLogger } from '../../lib/logger';

const logger = createLogger('OffloadBookDialog');

interface OffloadBookDialogProps {
    isOpen: boolean;
    onClose: () => void;
    book: BookMetadata | null;
}

export const OffloadBookDialog: React.FC<OffloadBookDialogProps> = ({ isOpen, onClose, book }) => {
    const offloadBook = useLibraryStore(state => state.offloadBook);
    const showToast = useToastStore(state => state.showToast);
    const [isOffloading, setIsOffloading] = useState(false);

    if (!book) return null;

    const confirmOffload = async () => {
        // e.stopPropagation(); // REMOVED

        if (isOffloading) return;
        setIsOffloading(true);

        try {
            await offloadBook(book.id);
            showToast(`Offloaded "${book.title}"`, 'success');
            onClose();
        } catch (error) {
            logger.error("Failed to offload book", error);
            showToast("Failed to offload book", "error");
        } finally {
            setIsOffloading(false);
        }
    };

    return (
        <Dialog
            isOpen={isOpen}
            onClose={() => {
                if (!isOffloading) onClose();
            }}
            title="Offload Book"
            description={`Offload "${book.title}"? This will delete the local file to save space but keep your reading progress and annotations.`}
            footer={
                <>
                    <Button
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); onClose(); }}
                        disabled={isOffloading}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="default"
                        onClick={() => {
                            confirmOffload();
                        }}
                        disabled={isOffloading}
                        data-testid="confirm-offload"
                        className="gap-2"
                    >
                        {isOffloading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {isOffloading ? "Offloading..." : "Offload"}
                    </Button>
                </>
            }
        />
    );
};
