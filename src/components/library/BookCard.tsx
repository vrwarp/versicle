import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { BookMetadata } from '../../types/db';
import { MoreVertical, Trash2, CloudOff, Cloud, RefreshCw } from 'lucide-react';
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
  const { removeBook, offloadBook, restoreBook } = useLibraryStore();
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };

    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showMenu]);

  const handleCardClick = () => {
    if (book.isOffloaded) {
      // Trigger restore
      fileInputRef.current?.click();
    } else {
      navigate(`/read/${book.id}`);
    }
  };

  const handleMenuClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowMenu(!showMenu);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Are you sure you want to delete this book completely? This cannot be undone.')) {
      await removeBook(book.id);
    }
    setShowMenu(false);
  };

  const handleOffload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await offloadBook(book.id);
    setShowMenu(false);
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

  return (
    <div
      onClick={handleCardClick}
      data-testid={`book-card-${book.id}`}
      className="group flex flex-col bg-card text-card-foreground rounded-lg shadow-sm hover:shadow-md transition-shadow overflow-hidden border border-border h-full cursor-pointer relative"
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
            className={`w-full h-full object-cover transition-transform group-hover:scale-105 ${book.isOffloaded ? 'opacity-50 grayscale' : ''}`}
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

        <div className="absolute top-2 right-2">
           <button
             onClick={handleMenuClick}
             className="p-1 rounded-full bg-black/50 text-white hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity"
             data-testid="book-menu-trigger"
           >
              <MoreVertical className="w-4 h-4" />
           </button>
           {showMenu && (
             <div
               ref={menuRef}
               className="absolute right-0 top-full mt-1 w-48 bg-popover text-popover-foreground rounded-md shadow-lg border border-border z-10 overflow-hidden"
             >
                {!book.isOffloaded ? (
                    <button
                        onClick={handleOffload}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                        data-testid="menu-offload"
                    >
                        <CloudOff className="w-4 h-4" />
                        Offload File
                    </button>
                ) : (
                    <button
                        onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); setShowMenu(false); }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                        data-testid="menu-restore"
                    >
                        <RefreshCw className="w-4 h-4" />
                        Restore File
                    </button>
                )}
                <button
                    onClick={handleDelete}
                    className="w-full text-left px-4 py-2 text-sm hover:bg-destructive/10 text-destructive hover:text-destructive flex items-center gap-2 border-t border-border"
                    data-testid="menu-delete"
                >
                    <Trash2 className="w-4 h-4" />
                    Delete Book
                </button>
             </div>
           )}
        </div>
      </div>
      <div className="p-3 flex flex-col flex-1">
        <h3 data-testid="book-title" className="font-semibold text-foreground line-clamp-2 mb-1" title={book.title}>
          {book.title}
        </h3>
        <p className="text-sm text-muted-foreground line-clamp-1" title={book.author}>
          {book.author || 'Unknown Author'}
        </p>
        {book.progress !== undefined && book.progress > 0 && (
          <div className="w-full h-1.5 bg-secondary rounded-full mt-3 overflow-hidden" data-testid="progress-container">
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
};
