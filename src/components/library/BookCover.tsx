import React from 'react';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { cn } from '../../lib/utils';
import { Cloud, MoreVertical } from 'lucide-react';
import { Button } from '../ui/Button';
import { BookActionMenu } from './BookActionMenu';
import type { BookMetadata } from '../../types/db';
interface BookCoverProps {
    book: BookMetadata;
    onDelete: (book: BookMetadata) => void;
    onOffload: (book: BookMetadata) => void;
    onRestore: (book: BookMetadata) => void;
}

export const BookCover: React.FC<BookCoverProps> = React.memo(({ book, onDelete, onOffload, onRestore }) => {
    // We assume the service worker handles /__versicle__/covers/:id
    // But we only want to try loading it if we know we have a cover (book.coverBlob exists)
    // or if we have a remote coverUrl.
    // Ideally, we shouldn't rely on 'book.coverBlob' existence check for the URL construction
    // if we want to support pure URL based fetching, but for now, the pattern replaces useObjectUrl(blob).

    // If book.coverUrl is set (external URL), use it.
    // Otherwise, if we have a blob (local), use the SW route.
    const displayUrl = book.coverUrl || (book.coverBlob ? `/__versicle__/covers/${book.id}` : null);

    return (
        <div className="aspect-[2/3] w-full bg-muted relative overflow-hidden shadow-inner flex flex-col">
            {displayUrl ? (
                <LazyLoadImage
                    src={displayUrl}
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
                <div
                    className="absolute inset-0 flex items-center justify-center bg-black/20"
                    data-testid="offloaded-overlay"
                    title="Offloaded - Click to restore"
                >
                    <Cloud className="w-12 h-12 text-white drop-shadow-md" aria-hidden="true" />
                    <span className="sr-only">Offloaded</span>
                </div>
            )}

            <div
                className="absolute top-2 right-2 z-10"
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
            >
                <BookActionMenu
                    book={book}
                    onDelete={() => onDelete(book)}
                    onOffload={() => onOffload(book)}
                    onRestore={() => onRestore(book)}
                >
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Book actions"
                    className={cn(
                        "rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white transition-opacity",
                        "h-11 w-11", // Minimum 44px touch target
                        "opacity-100 md:opacity-0 md:group-hover:opacity-100", // Always visible on mobile
                        "touch-manipulation"
                    )}
                    data-testid="book-menu-trigger"
                >
                    <MoreVertical className="w-4 h-4" />
                </Button>
                </BookActionMenu>
            </div>
        </div>
    );
});
