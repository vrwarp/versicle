import React from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { type BookMetadata } from '../../types/db';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';

interface OffloadBookDialogProps {
    isOpen: boolean;
    onClose: () => void;
    book: BookMetadata | null;
}

export const OffloadBookDialog: React.FC<OffloadBookDialogProps> = ({ isOpen, onClose, book }) => {
    const offloadBook = useLibraryStore(state => state.offloadBook);
    const showToast = useToastStore(state => state.showToast);

    if (!book) return null;

    const confirmOffload = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await offloadBook(book.id);
        showToast(`Offloaded "${book.title}"`, 'success');
        onClose();
    };

    return (
        <Dialog
            isOpen={isOpen}
            onClose={onClose}
            title="Offload Book"
            description={`Offload "${book.title}"? This will delete the local file to save space but keep your reading progress and annotations.`}
            footer={
                <>
                    <Button variant="ghost" onClick={(e) => { e.stopPropagation(); onClose(); }}>
                        Cancel
                    </Button>
                    <Button
                        variant="default"
                        onClick={confirmOffload}
                        data-testid="confirm-offload"
                    >
                        Offload
                    </Button>
                </>
            }
        />
    );
};
