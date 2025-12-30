import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BookMetadata } from '../../types/db';
import { MoreVertical, Cloud } from 'lucide-react';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { Button } from '../ui/Button';
import { cn } from '../../lib/utils';
import { BookActionMenu, type BookActionMenuHandle } from './BookActionMenu';

/**
 * Props for the BookCard component.
 */
interface BookCardProps {
  /** The metadata of the book to display. */
  book: BookMetadata;
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
export const BookCard: React.FC<BookCardProps> = React.memo(({ book }) => {
  const navigate = useNavigate();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const actionMenuRef = useRef<BookActionMenuHandle>(null);

  useEffect(() => {
    let url: string | null = null;
    let isActive = true;

    if (book.coverBlob) {
      url = URL.createObjectURL(book.coverBlob);
      if (isActive) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCoverUrl(url);
      }
    }

    return () => {
      isActive = false;
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [book.coverBlob]);

  const handleCardClick = () => {
    if (book.isOffloaded) {
      // Trigger restore via ActionMenu
      actionMenuRef.current?.triggerRestore();
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
      <div className="aspect-[2/3] w-full bg-muted relative overflow-hidden shadow-inner flex flex-col">
        {coverUrl ? (
          <LazyLoadImage
            src={coverUrl}
            alt={`Cover of ${book.title}`}
            effect="blur"
            wrapperClassName="w-full h-full !block"
            className={cn(
                "w-full h-full object-cover transition-transform group-hover:scale-105",
                book.isOffloaded && 'opacity-50 grayscale'
            )}
            threshold={200}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground/50">
            <span className="text-4xl font-light">Aa</span>
          </div>
        )}

        {book.isOffloaded && (
           <div className="absolute inset-0 flex items-center justify-center bg-black/20" data-testid="offloaded-overlay">
               <Cloud className="w-12 h-12 text-white drop-shadow-md" />
           </div>
        )}

        <div
          className="absolute top-2 right-2 z-10"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
            <BookActionMenu book={book} ref={actionMenuRef}>
                <div className="h-11 w-11">
                    <Button
                        variant="ghost"
                        size="icon"
                        className={cn(
                            "rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white transition-opacity",
                            "h-11 w-11", // Minimum 44px touch target
                            "opacity-100 md:opacity-0 md:group-hover:opacity-100", // Always visible on mobile
                            "touch-manipulation"
                        )}
                        data-testid="book-menu-trigger"
                        // Handlers are now in BookActionMenu
                    >
                        <MoreVertical className="w-4 h-4" />
                    </Button>
                </div>
            </BookActionMenu>
        </div>
      </div>

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
