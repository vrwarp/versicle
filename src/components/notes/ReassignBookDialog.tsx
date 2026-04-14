import React, { useState, useMemo, useEffect } from 'react';
import { Search, X } from 'lucide-react';
import { Dialog } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { ScrollArea } from '../ui/ScrollArea';
import { useAllBooks } from '../../store/selectors';
import { useDebounce } from '../../hooks/useDebounce';
import { cn } from '../../lib/utils';

interface ReassignBookDialogProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (newBookId: string) => void;
}

export const ReassignBookDialog: React.FC<ReassignBookDialogProps> = ({
    isOpen,
    onClose,
    onConfirm
}) => {
    const books = useAllBooks();
    const [selectedBookId, setSelectedBookId] = useState<string>('');
    const [searchQuery, setSearchQuery] = useState('');
    const debouncedSearchQuery = useDebounce(searchQuery, 300);

    useEffect(() => {
        if (isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedBookId('');
            setSearchQuery('');
        }
    }, [isOpen]);

    const filteredBooks = useMemo(() => {
        const query = debouncedSearchQuery.toLowerCase();
        return books
            .filter((book) => {
                const titleMatch = (book.title || 'Untitled').toLowerCase().includes(query);
                const authorMatch = (book.author || '').toLowerCase().includes(query);
                return titleMatch || authorMatch;
            })
            .sort((a, b) => (a.title || 'Untitled').localeCompare(b.title || 'Untitled'));
    }, [books, debouncedSearchQuery]);

    const handleConfirm = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (selectedBookId) {
            onConfirm(selectedBookId);
            onClose();
        }
    };

    // OPTIMIZATION: Memoize rendered VDOM items to prevent O(N) allocation on every keystroke in the search bar.
    const renderedBooks = useMemo(() => {
        return filteredBooks.map((book) => (
            <Button
                key={book.id}
                variant={selectedBookId === book.id ? "secondary" : "ghost"}
                className="w-full h-auto font-normal justify-start text-left flex-col items-start py-2 px-3"
                onClick={() => setSelectedBookId(book.id)}
            >
                <span className="font-medium line-clamp-1">{book.title || 'Untitled'}</span>
                {book.author && (
                    <span className="text-xs text-muted-foreground line-clamp-1">{book.author}</span>
                )}
            </Button>
        ));
    }, [filteredBooks, selectedBookId]);

    return (
        <Dialog
            isOpen={isOpen}
            onClose={onClose}
            title="Reassign to Book"
            description="Select a book from your library to associate with these annotations."
            footer={
                <>
                    <Button
                        variant="ghost"
                        onClick={(e) => { e.stopPropagation(); onClose(); }}
                    >
                        Cancel
                    </Button>
                    <Button
                        onClick={handleConfirm}
                        disabled={!selectedBookId}
                    >
                        Reassign
                    </Button>
                </>
            }
        >
            <div className="py-4 flex flex-col gap-4">
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Search books..."
                        aria-label="Search books"
                        className={cn("pl-9", searchQuery && "pr-9")}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => setSearchQuery('')}
                            aria-label="Clear query"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>
                <ScrollArea className="h-[200px] border rounded-md p-2">
                    <div className="flex flex-col gap-1">
                        {filteredBooks.length === 0 ? (
                            <p className="text-sm text-muted-foreground text-center py-4">
                                No books found matching "{debouncedSearchQuery}"
                            </p>
                        ) : (
                            renderedBooks
                        )}
                    </div>
                </ScrollArea>
            </div>
        </Dialog>
    );
};
