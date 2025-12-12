import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BookMetadata } from '../../types/db';
import { MoreVertical, Trash2, CloudOff, Cloud, RefreshCw } from 'lucide-react';
import { useLibraryStore } from '../../store/useLibraryStore';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/DropdownMenu';
import { cn } from '../../lib/utils';

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
  const { removeBook, offloadBook, restoreBook } = useLibraryStore();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleCardClick = () => {
    if (book.isOffloaded) {
      // Trigger restore
      fileInputRef.current?.click();
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

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this book completely? This cannot be undone.')) {
      await removeBook(book.id);
    }
  };

  const handleOffload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await offloadBook(book.id);
  };

  const handleRestoreClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        try {
            await restoreBook(book.id, e.target.files[0]);
        } catch (error) {
            console.error("Restore failed", error);
        }
    }
    if (e.target.value) {
        e.target.value = '';
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
      className="group flex flex-col bg-card text-card-foreground rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden border border-border h-full cursor-pointer relative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".epub"
        className="hidden"
        data-testid={`restore-input-${book.id}`}
      />

      <div className="aspect-[2/3] w-full bg-muted relative overflow-hidden shadow-inner">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={`Cover of ${book.title}`}
            className={cn(
                "w-full h-full object-cover transition-transform group-hover:scale-105",
                book.isOffloaded && 'opacity-50 grayscale'
            )}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted-foreground/50">
            <span className="text-4xl font-light">Aa</span>
          </div>
        )}

        {book.isOffloaded && (
           <div className="absolute inset-0 flex items-center justify-center bg-black/20">
               <Cloud className="w-12 h-12 text-white drop-shadow-md" />
           </div>
        )}

        <div
          className="absolute top-2 right-2"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
           <DropdownMenu>
             <DropdownMenuTrigger asChild>
               <button
                 className="p-1 rounded-full bg-black/50 text-white hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 focus-visible:opacity-100"
                 data-testid="book-menu-trigger"
                 aria-label="Book actions"
               >
                  <MoreVertical className="w-4 h-4" />
               </button>
             </DropdownMenuTrigger>
             <DropdownMenuContent align="end" className="w-48">
                {!book.isOffloaded ? (
                    <DropdownMenuItem onClick={handleOffload} data-testid="menu-offload" className="cursor-pointer">
                        <CloudOff className="w-4 h-4 mr-2" />
                        Offload File
                    </DropdownMenuItem>
                ) : (
                    <DropdownMenuItem onClick={handleRestoreClick} data-testid="menu-restore" className="cursor-pointer">
                        <RefreshCw className="w-4 h-4 mr-2" />
                        Restore File
                    </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={handleDelete} className="text-destructive focus:text-destructive cursor-pointer" data-testid="menu-delete">
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Book
                </DropdownMenuItem>
             </DropdownMenuContent>
           </DropdownMenu>
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
