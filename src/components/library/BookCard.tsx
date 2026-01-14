import React from 'react';
import type { BookMetadata } from '../../types/db';
import { BookCover } from './BookCover';
import { Progress } from '../ui/Progress';

/**
 * Props for the BookCard component.
 */
interface BookCardProps {
  /** The metadata of the book to display. */
  book: BookMetadata;
  onOpen: (book: BookMetadata) => void;
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
export const BookCard: React.FC<BookCardProps> = React.memo(({ book, onOpen, onDelete, onOffload, onRestore }) => {

  const handleCardClick = () => {
    if (book.isOffloaded) {
      onRestore(book);
    } else {
      onOpen(book);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleCardClick();
    }
  };

  const durationString = book.totalChars ? formatDuration(book.totalChars) : null;
  const progressPercent = book.progress ? Math.round(book.progress * 100) : 0;

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
          <Progress
            value={progressPercent}
            className="mt-3 h-1.5"
            data-testid="progress-container"
            aria-label={`Reading progress: ${progressPercent}%`}
          />
        )}
      </div>
    </div>
  );
});
