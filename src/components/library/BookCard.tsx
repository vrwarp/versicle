import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BookMetadata } from '../../types/db';
import { Trash2 } from 'lucide-react';
import { useLibraryStore } from '../../store/useLibraryStore';

/**
 * Props for the BookCard component.
 */
interface BookCardProps {
  /** The metadata of the book to display. */
  book: BookMetadata;
}

/**
 * Displays a summary card for a book, including its cover, title, and author.
 * navigating to the reader view when clicked.
 *
 * @param props - Component props containing the book metadata.
 * @returns A React component rendering the book card.
 */
export const BookCard: React.FC<BookCardProps> = ({ book }) => {
  const navigate = useNavigate();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const { deleteBook } = useLibraryStore();

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
      if (confirm(`Are you sure you want to delete "${book.title}"?`)) {
          deleteBook(book.id);
      }
  };

  return (
    <div
      onClick={() => navigate(`/read/${book.id}`)}
      data-testid="book-card"
      className="group flex flex-col bg-surface rounded-lg shadow-sm hover:shadow-md transition-all overflow-hidden border border-border h-full cursor-pointer relative"
    >
      <div className="aspect-[2/3] w-full bg-muted relative overflow-hidden">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`Cover of ${book.title}`}
            className="w-full h-full object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground">
            <span className="text-4xl font-light">Aa</span>
          </div>
        )}

        {/* Delete Button (Visible on Hover) */}
        <button
            data-testid="delete-book-button"
            onClick={handleDelete}
            className="absolute top-2 right-2 p-2 bg-black/50 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-destructive"
            title="Delete Book"
        >
            <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="p-3 flex flex-col flex-1 bg-surface">
        <h3 data-testid="book-title" className="font-semibold text-foreground line-clamp-2 mb-1" title={book.title}>
          {book.title}
        </h3>
        <p className="text-sm text-secondary line-clamp-1" title={book.author}>
          {book.author || 'Unknown Author'}
        </p>
      </div>
    </div>
  );
};
