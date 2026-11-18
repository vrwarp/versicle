import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLibraryStore } from '@store/useLibraryStore';
import { useToastStore } from '@store/useToastStore';
import { useImportController } from '@app/library/useImportController';
import { Button } from '../ui/Button';
import { Loader2, Library, BookOpen, Upload } from 'lucide-react';
import { FileUploader } from './FileUploader';
import { createLogger } from '@lib/logger';
import { localFetch } from '@kernel/net';

const logger = createLogger('EmptyLibrary');

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
export const EmptyLibrary: React.FC<EmptyLibraryProps> = ({ onImport }) => {
  const navigate = useNavigate();
  const isImporting = useLibraryStore((state) => state.isImporting);
  const controller = useImportController();
  const showToast = useToastStore((state) => state.showToast);
  const [isLoadingDemo, setIsLoadingDemo] = React.useState(false);

  const isBrowseImporting = isImporting && !isLoadingDemo;
  const isBusy = isImporting || isLoadingDemo;

  const handleLoadDemo = async () => {
    setIsLoadingDemo(true);
    try {
      const response = await localFetch('/books/alice.epub');
      if (!response.ok) throw new Error('Failed to load demo book');
      const blob = await response.blob();
      const file = new File([blob], 'Alice in Wonderland.epub', { type: 'application/epub+zip' });
      const result = await controller.importFile(file);
      const bookId = 'bookId' in result ? result.bookId : undefined;
      showToast(
        'Demo book loaded successfully',
        'success',
        bookId ? 5000 : undefined,
        bookId ? { label: 'common.open', onAction: () => navigate(`/read/${bookId}`) } : undefined,
      );
    } catch (error) {
      logger.error('Error loading demo book:', error);
      showToast('Failed to load demo book', 'error');
    } finally {
      setIsLoadingDemo(false);
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

      <div
        className="flex flex-col sm:flex-row gap-4 w-full max-w-md justify-center"
        aria-live="polite"
        aria-busy={isBusy}
      >
        <Button
          variant="default"
          onClick={onImport}
          disabled={isBusy}
          className="font-medium gap-2 h-12 px-6 transition-all touch-manipulation w-full sm:w-auto"
          aria-label={isBrowseImporting ? "Importing book..." : "Browse files to import"}
        >
          {isBrowseImporting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span className="sr-only" aria-live="polite">Importing...</span>
            </>
          ) : (
            <Upload className="h-4 w-4" aria-hidden="true" />
          )}
          <span aria-hidden={isBrowseImporting}>{isBrowseImporting ? "Importing..." : "Browse Files"}</span>
        </Button>
        <Button
          variant="outline"
          onClick={handleLoadDemo}
          disabled={isBusy}
          className="text-primary font-medium gap-2 h-12 px-6 border-primary/20 hover:bg-primary/5 hover:text-primary transition-all touch-manipulation w-full sm:w-auto"
          aria-label={isLoadingDemo ? "Loading demo book..." : "Load Demo Book (Alice in Wonderland)"}
        >
          {isLoadingDemo ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              <span className="sr-only" aria-live="polite">Loading...</span>
            </>
          ) : (
            <BookOpen className="h-4 w-4" aria-hidden="true" />
          )}
          <span aria-hidden={isLoadingDemo}>{isLoadingDemo ? "Loading..." : "Load Demo Book (Alice in Wonderland)"}</span>
        </Button>
      </div>
    </div>
  );
};
