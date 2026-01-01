import React from 'react';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { cn } from '../../lib/utils';
import { Cloud, MoreVertical } from 'lucide-react';
import { Button } from '../ui/Button';
import { BookActionMenu, type BookActionMenuHandle } from './BookActionMenu';
import type { BookMetadata } from '../../types/db';
interface BookCoverProps {
    book: BookMetadata;
    actionMenuRef: React.RefObject<BookActionMenuHandle | null>;
}

export const BookCover: React.FC<BookCoverProps> = React.memo(({ book, actionMenuRef }) => {
    // Use the Service Worker URL pattern to fetch the cover directly from IDB
    const coverUrl = book.coverBlob ? `/__versicle_assets__/covers/${book.id}` : null;

    return (
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
                        >
                            <MoreVertical className="w-4 h-4" />
                        </Button>
                    </div>
                </BookActionMenu>
            </div>
        </div>
    );
});
