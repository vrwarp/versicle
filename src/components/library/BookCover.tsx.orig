import React from 'react';
import { LazyLoadImage } from 'react-lazy-load-image-component';
import 'react-lazy-load-image-component/src/effects/blur.css';
import { cn } from '../../lib/utils';
import { getOptimizedTextColor, unpackColorToRGB } from '../../lib/cover-palette';
import { Cloud, CloudDownload, MoreVertical } from 'lucide-react';
import { Button } from '../ui/Button';
import { BookActionMenu } from './BookActionMenu';
import type { BookMetadata } from '../../types/db';

function unpackColor(packed: number): string {
    const { r, g, b } = unpackColorToRGB(packed);
    return `rgb(${r}, ${g}, ${b})`;
}

interface BookCoverProps {
    book: BookMetadata;
    /** Whether this is a Ghost Book (metadata synced but file not present locally) */
    isGhostBook?: boolean;
    onDelete: (book: BookMetadata) => void;
    onOffload: (book: BookMetadata) => void;
    onRestore: (book: BookMetadata) => void;
}

export const BookCover: React.FC<BookCoverProps & { showActions?: boolean }> = React.memo(({ book, isGhostBook = false, onDelete, onOffload, onRestore, showActions = true }) => {
    // We assume the service worker handles /__versicle__/covers/:id
    // But we only want to try loading it if we know we have a cover (book.coverBlob exists)
    // or if we have a remote coverUrl.
    // Ideally, we shouldn't rely on 'book.coverBlob' existence check for the URL construction
    // if we want to support pure URL based fetching, but for now, the pattern replaces useObjectUrl(blob).

    // If book.coverUrl is set (external URL), use it.
    // Otherwise, if we have a blob (local), use the SW route.
    const displayUrl = book.coverUrl || (book.coverBlob ? `/__versicle__/covers/${book.id}` : null);

    const [imageError, setImageError] = React.useState(false);

    React.useEffect(() => {
        setImageError(false);
    }, [displayUrl]);

    const gradientStyle = React.useMemo(() => {
        if (!book.coverPalette || book.coverPalette.length !== 5) return undefined;

        const colors = book.coverPalette.map(unpackColor);

        // We use oklab interpolation for perceptually smooth transitions and to avoid muddy colors in the middle
        // 5th color is the Center color, used as a central radial boost.
        // Base layer is linear gradient between TL and BR.
        return {
            backgroundImage: `
                radial-gradient(at top left in oklab, ${colors[0]}, transparent),
                radial-gradient(at top right in oklab, ${colors[1]}, transparent),
                radial-gradient(at bottom left in oklab, ${colors[2]}, transparent),
                radial-gradient(at bottom right in oklab, ${colors[3]}, transparent),
                radial-gradient(circle at center in oklab, ${colors[4]} 0%, transparent 125%),
                /* Base layer is white to ensure contrast and prevent transparency */
                linear-gradient(white, white)
            `
        };
    }, [book.coverPalette]);

    const textColorClass = React.useMemo(() => {
        return getOptimizedTextColor(book.coverPalette);
    }, [book.coverPalette]);

    const showImage = displayUrl && !imageError;

    // Ghost books show with reduced opacity and a cloud download icon
    // Offloaded books show with grayscale and a cloud icon (different from ghost)

    return (
        <div
            className={cn(
                "aspect-[2/3] w-full bg-muted relative overflow-hidden shadow-inner flex flex-col",
                isGhostBook && "opacity-80"
            )}
            style={!showImage && gradientStyle ? gradientStyle : undefined}
        >
            {showImage ? (
                <LazyLoadImage
                    src={displayUrl}
                    onError={() => setImageError(true)}
                    alt={`Cover of ${book.title}`}
                    effect="blur"
                    wrapperClassName="w-full h-full !block"
                    className={cn(
                        "w-full h-full object-cover transition-transform group-hover:scale-105",
                        book.isOffloaded && 'opacity-50 grayscale',
                        isGhostBook && 'opacity-80'
                    )}
                    threshold={200}
                />
            ) : gradientStyle ? (
                <div className="w-full h-full flex flex-col justify-between p-2">
                    <span
                        className={cn(
                            "font-bold text-lg leading-tight text-center drop-shadow-md line-clamp-3 break-words",
                            textColorClass
                        )}
                    >
                        {book.title}
                    </span>
                    <span
                        className={cn(
                            "text-xs font-medium text-center drop-shadow-md line-clamp-1 opacity-90",
                            textColorClass
                        )}
                    >
                        {book.author}
                    </span>
                </div>
            ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground/50">
                    <span className="text-4xl font-light">Aa</span>
                </div>
            )}

            {/* Ghost Book overlay - content not on this device */}
            {isGhostBook && !book.isOffloaded && (
                <div
                    className="absolute inset-0 flex items-center justify-center bg-black/10"
                    data-testid="ghost-book-overlay"
                    title="Cloud only - Click to download"
                >
                    <CloudDownload className="w-12 h-12 text-white drop-shadow-lg" aria-hidden="true" />
                    <span className="sr-only">Available in cloud</span>
                </div>
            )}

            {/* Offloaded overlay - file was removed to save space */}
            {book.isOffloaded && !isGhostBook && (
                <div
                    className="absolute inset-0 flex items-center justify-center bg-black/20"
                    data-testid="offloaded-overlay"
                    title="Offloaded - Click to restore"
                >
                    <Cloud className="w-12 h-12 text-white drop-shadow-md" aria-hidden="true" />
                    <span className="sr-only">Offloaded</span>
                </div>
            )}

            {showActions && (
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
                        <div className="h-11 w-11">
                            <Button
                                variant="ghost"
                                size="icon"
                                asChild
                                className={cn(
                                    "rounded-full bg-black/50 text-white hover:bg-black/70 hover:text-white transition-opacity",
                                    "h-11 w-11", // Minimum 44px touch target
                                    "opacity-100 md:opacity-0 md:group-hover:opacity-100", // Always visible on mobile
                                    "touch-manipulation"
                                )}
                                data-testid="book-menu-trigger"
                            >
                                <span>
                                    <MoreVertical className="w-4 h-4" />
                                </span>
                            </Button>
                        </div>
                    </BookActionMenu>
                </div>
            )}
        </div>
    );
});
