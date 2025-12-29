import React from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { Button } from '../ui/Button';
import { Loader2, Library, BookOpen } from 'lucide-react';
import { FileUploader } from './FileUploader';

/**
 * Props for EmptyLibrary component.
 */
interface EmptyLibraryProps {
  /** Callback to trigger the file import dialog. */
  onImport: () => void;
}

/**
 * Renders an empty state message when no books are in the library.
 * Provides options to import a book or load a demo book.
 *
 * @param props - Component props.
 * @returns A React component for the empty library state.
 */
export const EmptyLibrary: React.FC<EmptyLibraryProps> = () => {
  const { addBook, isImporting } = useLibraryStore();
  const showToast = useToastStore((state) => state.showToast);

  const handleLoadDemo = async () => {
    try {
      const response = await fetch('/books/alice.epub');
      if (!response.ok) throw new Error('Failed to load demo book');
      const blob = await response.blob();
      const file = new File([blob], 'Alice in Wonderland.epub', { type: 'application/epub+zip' });
      await addBook(file);
      showToast('Demo book loaded successfully', 'success');
    } catch (error) {
      console.error('Error loading demo book:', error);
      showToast('Failed to load demo book', 'error');
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center px-4 max-w-2xl mx-auto">
      <div className="mb-6 p-6 bg-muted/20 rounded-full animate-in fade-in zoom-in duration-500">
        <Library className="w-16 h-16 text-muted-foreground/40" />
      </div>

      <h2 className="text-2xl font-bold text-foreground mb-2">Your library is empty</h2>
      <p className="text-muted-foreground mb-8 text-lg">
        Import an EPUB file to start reading, or load our demo book to explore the features.
      </p>

      <div className="w-full max-w-md mb-8">
        <FileUploader />
      </div>

      <Button
        variant="outline"
        onClick={handleLoadDemo}
        disabled={isImporting}
        className="text-primary font-medium gap-2 h-12 px-6 border-primary/20 hover:bg-primary/5 hover:text-primary transition-all touch-manipulation"
      >
        {isImporting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </>
        ) : (
          <>
            <BookOpen className="h-4 w-4" />
            Load Demo Book (Alice in Wonderland)
          </>
        )}
      </Button>
    </div>
  );
};
