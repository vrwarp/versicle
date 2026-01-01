import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { BookMetadata } from '../../types/db';
import { BookCover } from './BookCover';

/**
 * Props for the BookCard component.
 */
interface BookCardProps {
  /** The metadata of the book to display. */
  book: BookMetadata;
  onDelete: (book: BookMetadata) => void;
  onOffload: (book: BookMetadata) => void;
  onRestore: (book: BookMetadata) => void;
}

const formatDuration = (chars?: number): string => {
    if (!chars) return '';
    const minutes = Math.ceil(chars / (180 * 5));
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;

    if (hours > 0) {
        return `${hours}h ${remainingMinutes}m`;
    }
    return `${minutes}m`;
}

/**
 * Displays a summary card for a book, including its cover, title, and author.
 * navigating to the reader view when clicked.
 *
 * @param props - Component props containing the book metadata.
 * @returns A React component rendering the book card.
 */
export const BookCard: React.FC<BookCardProps> = React.memo(({ book, onDelete, onOffload, onRestore }) => {
  const navigate = useNavigate();
  // We keep the ref to pass it to BookCover -> BookActionMenu, but we could technically bypass it if we updated BookCover too.
  // However, BookCard relies on the click handler to trigger restore.
  // Since BookCard click triggers restore if offloaded, it can now just call onRestore(book).
  // But wait, BookCover contains the BookActionMenu.
  // The BookActionMenu is the visual trigger (three dots).
  // The BookCard click on the CARD itself triggers navigation or restore.
  // If we just call onRestore(book), we don't need the menu ref anymore!
  // BUT: BookCover renders BookActionMenu. We need to pass the callbacks to BookCover so it can pass them to BookActionMenu.

  const handleCardClick = () => {
    if (book.isOffloaded) {
      onRestore(book);
    } else {
      navigate(`/read/${book.id}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  };

  const durationString = book.totalChars ? formatDuration(book.totalChars) : null;

  return (
    <div
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      data-testid={`book-card-${book.id}`}
      className="group flex flex-col bg-card text-card-foreground rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden border border-border h-full cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full"
    >
      <BookCover
        book={book}
        onDelete={() => onDelete(book)}
        onOffload={() => onOffload(book)}
        onRestore={() => onRestore(book)}
      />

      <div className="p-3 flex flex-col flex-1">
        <h3 data-testid="book-title" className="font-semibold text-foreground line-clamp-2 mb-1" title={book.title}>
          {book.title}
        </h3>
        <p className="text-sm text-muted-foreground line-clamp-1" title={book.author}>
          {book.author || 'Unknown Author'}
        </p>

        {durationString && (
            <p className="text-xs text-muted-foreground mt-1">
                {durationString}
            </p>
        )}

        {book.progress !== undefined && book.progress > 0 && (
          <div
            className="w-full h-1.5 bg-secondary rounded-full mt-3 overflow-hidden"
            data-testid="progress-container"
            role="progressbar"
            aria-valuenow={Math.round(book.progress * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Reading progress: ${Math.round(book.progress * 100)}%`}
          >
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, book.progress * 100))}%` }}
              data-testid="progress-bar"
            />
          </div>
        )}
      </div>
    </div>
  );
});
