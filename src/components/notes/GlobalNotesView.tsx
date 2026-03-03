import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { NotesSearchBar } from './NotesSearchBar';
import { BookNotesBlock } from './BookNotesBlock';
import { useGroupedAnnotations } from '../../hooks/useGroupedAnnotations';
import { useDebounce } from '../../hooks/useDebounce';
import { BookOpen } from 'lucide-react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { Button } from '../ui/Button';

interface GlobalNotesViewProps {
    onContentMissing: (bookId: string) => void;
}

export const GlobalNotesView: React.FC<GlobalNotesViewProps> = ({ onContentMissing }) => {
    const [rawQuery, setRawQuery] = useState('');
    const debouncedQuery = useDebounce(rawQuery, 300);
    const groups = useGroupedAnnotations(debouncedQuery);
    const navigate = useNavigate();

    const handleNavigate = (bookId: string, cfiRange: string) => {
        const staticMetadata = useLibraryStore.getState().staticMetadata;
        const offloadedBookIds = useLibraryStore.getState().offloadedBookIds;

        const isGhost = !staticMetadata[bookId] && !offloadedBookIds.has(bookId);
        const isOffloaded = offloadedBookIds.has(bookId);

        if (isGhost || isOffloaded) {
            onContentMissing(bookId);
            return;
        }
        navigate(`/read/${bookId}?cfi=${encodeURIComponent(cfiRange)}`);
    };

    const handleOpenBook = (bookId: string) => {
        const staticMetadata = useLibraryStore.getState().staticMetadata;
        const offloadedBookIds = useLibraryStore.getState().offloadedBookIds;

        const isGhost = !staticMetadata[bookId] && !offloadedBookIds.has(bookId);
        const isOffloaded = offloadedBookIds.has(bookId);

        if (isGhost || isOffloaded) {
            onContentMissing(bookId);
            return;
        }
        navigate(`/read/${bookId}`);
    };

    return (
        <div className="flex-1 w-full max-w-4xl mx-auto flex flex-col gap-6" data-testid="global-notes-view">
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur py-4 -mx-4 px-4 sm:mx-0 sm:px-0">
                <NotesSearchBar
                    value={rawQuery}
                    onChange={setRawQuery}
                />
                {/* Live region for accessibility */}
                <div role="status" aria-live="polite" className="sr-only">
                    {debouncedQuery ? (
                        groups.length === 0 ? 'No annotations found' : `${groups.reduce((acc, g) => acc + g.annotations.length, 0)} annotations found across ${groups.length} books`
                    ) : ''}
                </div>
            </div>

            <div className="flex flex-col gap-2 pb-24">
                {groups.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                        {debouncedQuery ? (
                            <>
                                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                                    <BookOpen className="w-8 h-8 text-muted-foreground" />
                                </div>
                                <h3 className="text-xl font-bold mb-2">No results found</h3>
                                <p className="text-muted-foreground text-center max-w-md">
                                    No annotations or notes matching "{debouncedQuery}" were found in your library.
                                </p>
                                <Button
                                    variant="secondary"
                                    onClick={() => setRawQuery('')}
                                    className="mt-6"
                                    aria-label="Clear search query"
                                >
                                    Clear search
                                </Button>
                            </>
                        ) : (
                            <>
                                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                                    <BookOpen className="w-8 h-8 text-muted-foreground" />
                                </div>
                                <h3 className="text-xl font-bold mb-2">No annotations yet</h3>
                                <p className="text-muted-foreground text-center max-w-md text-balance mb-6">
                                    Read a book and highlight text to create your first annotation.
                                    Your highlights and notes will appear here across all your devices.
                                </p>
                            </>
                        )}
                    </div>
                ) : (
                    groups.map(group => (
                        <BookNotesBlock
                            key={group.bookId}
                            group={group}
                            onNavigate={handleNavigate}
                            onOpenBook={handleOpenBook}
                        />
                    ))
                )}
            </div>
        </div>
    );
};
