import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BookMetadata } from '../../types/db';
import { Trash2 } from 'lucide-react';
import { useLibraryStore } from '../../store/useLibraryStore';

interface BookCardProps {
  book: BookMetadata;
}

export const BookCard: React.FC<BookCardProps> = ({ book }) => {
  const navigate = useNavigate();
  const { removeBook } = useLibraryStore();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);

  useEffect(() => {
    let url: string | null = null;
    if (book.coverBlob) {
      url = URL.createObjectURL(book.coverBlob);
      setCoverUrl(url);
    }

    return () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [book.coverBlob]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(`Are you sure you want to delete "${book.title}"?`)) {
      removeBook(book.id);
    }
  };

  return (
    <div
      onClick={() => navigate(`/read/${book.id}`)}
      className="group flex flex-col bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden border border-gray-200 h-full cursor-pointer relative"
    >
      <button
        onClick={handleDelete}
        className="absolute top-2 right-2 p-2 bg-white/80 hover:bg-red-50 text-gray-500 hover:text-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-all z-10"
        aria-label={`Delete ${book.title}`}
        title="Delete book"
      >
        <Trash2 className="w-4 h-4" />
      </button>

      <div className="aspect-[2/3] w-full bg-gray-100 relative overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`Cover of ${book.title}`}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-400">
            <span className="text-4xl font-light">Aa</span>
          </div>
        )}
      </div>
      <div className="p-3 flex flex-col flex-1">
        <h3 className="font-semibold text-gray-900 line-clamp-2 mb-1" title={book.title}>
          {book.title}
        </h3>
        <p className="text-sm text-gray-500 line-clamp-1" title={book.author}>
          {book.author || 'Unknown Author'}
        </p>
      </div>
    </div>
  );
};
