import React from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { type BookMetadata } from '../../types/db';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';

interface DeleteBookDialogProps {
    isOpen: boolean;
    onClose: () => void;
    book: BookMetadata | null;
}

export const DeleteBookDialog: React.FC<DeleteBookDialogProps> = ({ isOpen, onClose, book }) => {
    const removeBook = useLibraryStore(state => state.removeBook);
    const showToast = useToastStore(state => state.showToast);

    if (!book) return null;

    const confirmDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();
        await removeBook(book.id);
        showToast(`Deleted "${book.title}"`, 'success');
        onClose();
    };

    return (
        <Dialog
            isOpen={isOpen}
            onClose={onClose}
            title="Delete Book"
            description={`Are you sure you want to delete "${book.title}"? This cannot be undone.`}
            footer={
                <>
                    <Button variant="ghost" onClick={(e) => { e.stopPropagation(); onClose(); }}>
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={confirmDelete}
                        data-testid="confirm-delete"
                    >
                        Delete
                    </Button>
                </>
            }
        />
    );
};
