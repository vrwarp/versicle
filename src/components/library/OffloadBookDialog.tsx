import React from 'react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import type { BookMetadata } from '../../types/db';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';

interface OffloadBookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  book: BookMetadata | null;
}

export const OffloadBookDialog: React.FC<OffloadBookDialogProps> = ({ isOpen, onClose, book }) => {
  const { offloadBook } = useLibraryStore();
  const showToast = useToastStore(state => state.showToast);

  const handleConfirm = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (book) {
      await offloadBook(book.id);
      showToast(`Offloaded "${book.title}"`, 'success');
      onClose();
    }
  };

  if (!book) return null;

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
            onClick={handleConfirm}
            data-testid="confirm-offload"
          >
            Offload
          </Button>
        </>
      }
    />
  );
};
