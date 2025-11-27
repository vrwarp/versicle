import React, { useEffect } from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { BookCard } from './BookCard';
import { FileUploader } from './FileUploader';

export const LibraryView: React.FC = () => {
  const { books, fetchBooks, isLoading, error } = useLibraryStore();

  useEffect(() => {
    fetchBooks();
  }, [fetchBooks]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">My Library</h1>
        <p className="text-gray-600">Manage and read your EPUB collection</p>
      </header>

      <section className="mb-12">
        <FileUploader />
        {error && (
            <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg">
                {error}
            </div>
        )}
      </section>

      {isLoading ? (
        <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
        </div>
      ) : (
        <section>
          {books.length === 0 ? (
             <div className="text-center py-12 text-gray-500">
                No books yet. Import one to get started!
             </div>
          ) : (
             <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                {books.map((book) => (
                    <BookCard key={book.id} book={book} />
                ))}
             </div>
          )}
        </section>
      )}
    </div>
  );
};
