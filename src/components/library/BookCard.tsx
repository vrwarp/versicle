import React, { useCallback } from 'react';
import { MoreVertical, Play, Trash2, CloudOff, RotateCcw } from 'lucide-react';
import type { BookMetadata } from '../../types/db';
import { BookCover } from './BookCover';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../ui/DropdownMenu';
import { Button } from '../ui/Button';
import { ResumeBadge } from './ResumeBadge';
import { RemoteSessionsSubMenu } from './RemoteSessionsSubMenu';

/**
 * Props for the BookCard component.
 */
interface BookCardProps {
  /** The metadata of the book to display. */
  book: BookMetadata;
  /** Whether this is a Ghost Book (synced metadata but no local file) */
  isGhostBook?: boolean;
  onOpen: (book: BookMetadata) => void;
  onDelete: (book: BookMetadata) => void;
  onOffload: (book: BookMetadata) => void;
  onRestore: (book: BookMetadata) => void;
  /** Optional callback when resume badge is clicked */
  onResume?: (book: BookMetadata, deviceId: string, cfi: string) => void;
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
export const BookCard: React.FC<BookCardProps> = React.memo(({
  book,
  isGhostBook = false,
  onOpen,
  onDelete,
  onOffload,
  onRestore,
  onResume
}) => {
  // OPTIMIZATION: Use book.progress passed from parent (computed by useAllBooks selector)
  // instead of subscribing individually to useBookProgress.
  // This prevents ~1000 selectors running on every store update.
  const progressPercent = book.progress || 0;

  const handleCardClick = () => {
    if (book.isOffloaded || isGhostBook) {
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

  const handleResumeClick = useCallback((deviceId: string, cfi: string) => {
    if (onResume) {
      onResume(book, deviceId, cfi);
    }
  }, [book, onResume]);

  const durationString = book.totalChars ? formatDuration(book.totalChars) : null;

  return (
    <div
      onClick={handleCardClick}
      onKeyDown={handleKeyDown}
      role="button"
      tabIndex={0}
      data-testid={`book-card-${book.id}`}
      className="group flex flex-col bg-card text-card-foreground rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden border border-border h-full cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring w-full max-w-[240px]"
    >
      <div className="relative">
        <BookCover
          book={book}
          isGhostBook={isGhostBook}
          onDelete={() => onDelete(book)}
          onOffload={() => onOffload(book)}
          onRestore={() => onRestore(book)}
          showActions={false}
        />

        {/* Dropdown Menu Trigger - Always visible on touch, visible on hover/focus on desktop */}
        <div className="absolute top-2 right-2 z-20 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity focus-within:opacity-100">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="h-8 w-8 rounded-full shadow-md bg-background/80 backdrop-blur-sm"
                onClick={(e) => e.stopPropagation()}
                data-testid="book-context-menu-trigger"
              >
                <MoreVertical className="h-4 w-4" />
                <span className="sr-only">Book options</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOpen(book); }}>
                <Play className="mr-2 h-4 w-4" />
                <span>Open</span>
              </DropdownMenuItem>

              {/* Submenu separated to prevent re-renders of the main card on device updates */}
              {onResume && (
                <RemoteSessionsSubMenu
                  bookId={book.id}
                  onResumeClick={handleResumeClick}
                />
              )}

              <DropdownMenuSeparator />

              {book.isOffloaded ? (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onRestore(book); }} data-testid="menu-restore">
                  <RotateCcw className="mr-2 h-4 w-4" />
                  <span>Restore Download</span>
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onOffload(book); }} data-testid="menu-offload">
                  <CloudOff className="mr-2 h-4 w-4" />
                  <span>Remove Download</span>
                </DropdownMenuItem>
              )}

              <DropdownMenuItem
                onClick={(e) => { e.stopPropagation(); onDelete(book); }}
                className="text-destructive focus:text-destructive"
                data-testid="menu-delete"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                <span>Delete from Library</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Resume Badge - shows when remote device has further progress */}
      {/* Separated to prevent re-renders of the main card on device updates */}
      {onResume && (
        <ResumeBadge
          bookId={book.id}
          onResumeClick={handleResumeClick}
        />
      )}

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

        {progressPercent > 0 && (
          <div
            className="w-full h-1.5 bg-secondary rounded-full mt-3 overflow-hidden"
            data-testid="progress-container"
            role="progressbar"
            aria-valuenow={Math.round(progressPercent * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Reading progress: ${Math.round(progressPercent * 100)}%`}
          >
            <div
              className="h-full bg-primary transition-all duration-300 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progressPercent * 100))}%` }}
              data-testid="progress-bar"
            />
          </div>
        )}
      </div>
    </div>
  );
});
