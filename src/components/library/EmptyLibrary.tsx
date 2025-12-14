import React from 'react';
import { BookOpen } from 'lucide-react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';

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
    <div className="flex flex-col items-center justify-center py-20 text-center px-4">
      <div className="bg-blue-50 p-6 rounded-full mb-6">
        <BookOpen className="w-12 h-12 text-blue-500" />
      </div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">Your library is empty</h2>
      <p className="text-gray-500 mb-8 max-w-md">
        Import an EPUB file to start reading, or load our demo book to explore the features.
      </p>

      <div className="flex flex-col items-center gap-4">
        <button
          onClick={onImport}
          disabled={isImporting}
          className="bg-blue-600 text-white hover:bg-blue-700 px-8 py-3 rounded-lg font-medium transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Import EPUB
        </button>

        <button
          onClick={handleLoadDemo}
          disabled={isImporting}
          className="text-blue-600 hover:underline text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isImporting ? 'Loading...' : 'Load Demo Book (Alice in Wonderland)'}
        </button>
      </div>
    </div>
  );
};
