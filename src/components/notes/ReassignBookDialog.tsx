import React, { useState } from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { useAllBooks } from '../../store/selectors';

interface ReassignBookDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (newBookId: string) => void;
}

export const ReassignBookDialog: React.FC<ReassignBookDialogProps> = ({
    isOpen,
    onClose,
    onConfirm
}) => {
    const books = useAllBooks();
    const [selectedBookId, setSelectedBookId] = useState<string>('');

    const handleConfirm = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (selectedBookId) {
            onConfirm(selectedBookId);
            onClose();
        }
    };

    return (
        <Dialog
            isOpen={isOpen}
            onClose={onClose}
            title="Reassign to Book"
            description="Select a book from your library to associate with these annotations."
            footer={
                <>
                    <Button
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); onClose(); }}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={!selectedBookId}
                    >
                        Reassign
                    </Button>
                </>
            }
        >
            <div className="py-4">
                <select
                    className="w-full p-2 border rounded bg-background text-foreground"
                    value={selectedBookId}
                    onChange={(e) => setSelectedBookId(e.target.value)}
                >
                    <option value="" disabled>Select a book...</option>
                    {books.map((book) => (
                        <option key={book.id} value={book.id}>
                            {book.title || 'Untitled'} {book.author ? `by ${book.author}` : ''}
                        </option>
                    ))}
                </select>
            </div>
        </Dialog>
    );
};
