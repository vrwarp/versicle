import React from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import type { BookMetadata } from '../../types/db';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';

interface DeleteBookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  book: BookMetadata | null;
}

export const DeleteBookDialog: React.FC<DeleteBookDialogProps> = ({ isOpen, onClose, book }) => {
  const { removeBook } = useLibraryStore();
  const showToast = useToastStore(state => state.showToast);

  const handleConfirm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (book) {
      await removeBook(book.id);
      showToast(`Deleted "${book.title}"`, 'success');
      onClose();
    }
  };

  if (!book) return null;

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
            onClick={handleConfirm}
            data-testid="confirm-delete"
          >
            Delete
          </Button>
        </>
      }
    />
  );
};
