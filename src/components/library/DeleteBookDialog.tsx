import React, { useState } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { type BookMetadata } from '../../types/db';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Loader2 } from 'lucide-react';

interface DeleteBookDialogProps {
    isOpen: boolean;
    onClose: () => void;
    book: BookMetadata | null;
}

export const DeleteBookDialog: React.FC<DeleteBookDialogProps> = ({ isOpen, onClose, book }) => {
    const removeBook = useLibraryStore(state => state.removeBook);
    const showToast = useToastStore(state => state.showToast);
    const [isDeleting, setIsDeleting] = useState(false);

    if (!book) return null;

    const confirmDelete = async (e: React.MouseEvent) => {
        e.stopPropagation();

        if (isDeleting) return;
        setIsDeleting(true);

        try {
            await removeBook(book.id);
            showToast(`Deleted "${book.title}"`, 'success');
            onClose();
        } catch (error) {
            console.error(error);
            showToast("Failed to delete book", "error");
        } finally {
             // If we closed the dialog, this state update might happen on an unmounted component,
             // but React handles that gracefully now, or we can skip it if we know we closed.
             // However, if there was an error, we stay open.
             setIsDeleting(false);
        }
    };

    return (
        <Dialog
            isOpen={isOpen}
            onClose={() => {
                if (!isDeleting) onClose();
            }}
            title="Delete Book"
            description={`Are you sure you want to delete "${book.title}"? This cannot be undone.`}
            footer={
                <>
                    <Button
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); onClose(); }}
                        disabled={isDeleting}
                    >
                        Cancel
                    </Button>
                    <Button
                        variant="destructive"
                        onClick={confirmDelete}
                        disabled={isDeleting}
                        data-testid="confirm-delete"
                        className="gap-2"
                    >
                        {isDeleting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                        {isDeleting ? "Deleting..." : "Delete"}
                    </Button>
                </>
            }
        />
    );
};
