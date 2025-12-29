import React from 'react';
import type { BookMetadata } from '../../types/db';
import { BookOpen, HardDriveDownload } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useToastStore } from '../../store/useToastStore';
import { cn } from '../../lib/utils';
import { useReaderStore } from '../../store/useReaderStore';
import { Progress } from '../ui/Progress';
import { BookActionMenu } from './BookActionMenu';

/**
 * Props for the BookListItem component.
 */
interface BookListItemProps {
    /** The metadata of the book to display. */
    book: BookMetadata;
}

const formatFileSize = (bytes?: number): string => {
    if (bytes === undefined) return '';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

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
 * Displays a book item in a list view format.
 * Includes thumbnail, title, author, progress, and action menu.
 *
 * @param props - Component props.
 * @returns The rendered list item.
 */
export const BookListItem: React.FC<BookListItemProps> = ({ book }) => {
    const navigate = useNavigate();
    const { restoreBook } = useLibraryStore();
    const showToast = useToastStore(state => state.showToast);
    const setBookId = useReaderStore(state => state.setCurrentBookId);
    const fileInputRef = React.useRef<HTMLInputElement>(null);
    const [coverUrl, setCoverUrl] = React.useState<string | null>(null);

    React.useEffect(() => {
        let url: string | null = null;
        if (book.coverBlob) {
            url = URL.createObjectURL(book.coverBlob);
            setCoverUrl(url);
        } else {
            setCoverUrl(null);
        }

        return () => {
            if (url) {
                URL.revokeObjectURL(url);
            }
        };
    }, [book.coverBlob]);

    const displayUrl = coverUrl || book.coverUrl;

    const handleOpen = () => {
        if (book.isOffloaded) {
            showToast("Book is offloaded. Please restore it to read.", "error");
            return;
        }
        setBookId(book.id); // Set the active book ID in the store
        navigate(`/read/${book.id}`);
    };

    const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            try {
                await restoreBook(book.id, file);
                showToast(`Restored "${book.title}"`, 'success');
            } catch (err) {
                // Error is handled in store, but we can catch here if needed
                console.error(err);
            }
        }
        if (e.target.value) e.target.value = '';
    };

    const progressPercent = book.progress ? Math.round(book.progress * 100) : 0;
    const durationString = book.totalChars ? formatDuration(book.totalChars) : null;
    const sizeString = formatFileSize(book.fileSize);

    return (
        <div className="px-4 py-2" data-testid={`book-list-item-${book.id}`}>
            <div
                className={cn(
                    "flex items-center gap-4 p-2 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group h-full border border-transparent hover:border-border",
                    book.isOffloaded && "opacity-75"
                )}
                onClick={handleOpen}
            >
                {/* Thumbnail */}
                <div className="flex-none w-10 h-14 bg-muted rounded overflow-hidden shadow-sm relative">
                    {displayUrl ? (
                        <img
                            src={displayUrl}
                            alt={`Cover for ${book.title}`}
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-secondary text-muted-foreground">
                            <BookOpen className="w-5 h-5" />
                        </div>
                    )}
                    {book.isOffloaded && (
                        <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                            <HardDriveDownload className="w-5 h-5 text-muted-foreground" />
                        </div>
                    )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <h3 className="text-sm font-semibold truncate text-foreground pr-2" title={book.title}>
                        {book.title}
                    </h3>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5 truncate">
                        <span className="truncate max-w-[150px]">{book.author}</span>

                        {progressPercent > 0 && (
                            <>
                                <span>•</span>
                                <div className="flex items-center gap-1.5">
                                    <Progress value={progressPercent} className="w-12 h-1.5" aria-label="Reading progress" />
                                    <span>{progressPercent}%</span>
                                </div>
                            </>
                        )}
                        {progressPercent === 0 && (
                             <>
                                <span>•</span>
                                <span>0%</span>
                             </>
                        )}

                        {durationString ? (
                            <>
                                <span>•</span>
                                <span>{durationString}</span>
                            </>
                        ) : (
                            book.fileSize !== undefined && (
                                <>
                                    <span>•</span>
                                    <span>{sizeString}</span>
                                </>
                            )
                        )}

                         {book.isOffloaded && (
                            <span className="text-amber-500 font-medium ml-1">(Offloaded)</span>
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex-none">
                     <input
                        type="file"
                        ref={fileInputRef}
                        onChange={handleRestoreFile}
                        accept=".epub"
                        className="hidden"
                        data-testid={`restore-input-${book.id}`}
                    />
                    <BookActionMenu book={book} variant="list" testId={`book-actions-${book.id}`} />
                </div>
            </div>
        </div>
    );
};
