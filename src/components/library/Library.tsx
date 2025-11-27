import React from 'react';
import { useLibraryStore } from '../../store/useLibraryStore';

export const Library: React.FC = () => {
  const { books, refreshLibrary } = useLibraryStore();

  React.useEffect(() => {
    refreshLibrary();
  }, [refreshLibrary]);

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Library</h1>
      {books.length === 0 ? (
        <p>No books in library.</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          {books.map((book) => (
            <div key={book.id} className="border p-2 rounded">
              <div className="aspect-[2/3] bg-gray-200 mb-2 flex items-center justify-center">
                {book.coverUrl ? (
                  <img src={book.coverUrl} alt={book.title} className="w-full h-full object-cover" />
                ) : (
                  <span>No Cover</span>
                )}
              </div>
              <h3 className="font-semibold truncate">{book.title}</h3>
              <p className="text-sm text-gray-600 truncate">{book.author}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
