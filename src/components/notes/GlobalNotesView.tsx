import React, { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { NotesSearchBar } from './NotesSearchBar';
import { BookNotesBlock } from './BookNotesBlock';
import { useGroupedAnnotations } from '../../hooks/useGroupedAnnotations';
import { useDebounce } from '../../hooks/useDebounce';
import { BookOpen } from 'lucide-react';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { selectPendingAudioBookmarks } from '../../store/selectors';
import { useShallow } from 'zustand/react/shallow';
import { Button } from '../ui/Button';
import { Mic, Check, Trash2 } from 'lucide-react';

interface GlobalNotesViewProps {
    onContentMissing: (bookId: string) => void;
}

export const GlobalNotesView: React.FC<GlobalNotesViewProps> = ({ onContentMissing }) => {
    const [rawQuery, setRawQuery] = useState('');
    const debouncedQuery = useDebounce(rawQuery, 300);
    const groups = useGroupedAnnotations(debouncedQuery);
    const navigate = useNavigate();

    const pendingBookmarks = useAnnotationStore(useShallow(selectPendingAudioBookmarks));

    const handleNavigate = useCallback((bookId: string, cfiRange: string) => {
        const staticMetadata = useLibraryStore.getState().staticMetadata;
        const offloadedBookIds = useLibraryStore.getState().offloadedBookIds;

        const isGhost = !staticMetadata[bookId] && !offloadedBookIds.has(bookId);
        const isOffloaded = offloadedBookIds.has(bookId);

        if (isGhost || isOffloaded) {
            onContentMissing(bookId);
            return;
        }
        navigate(`/read/${bookId}?cfi=${encodeURIComponent(cfiRange)}`);
    }, [navigate, onContentMissing]);

    const handleOpenBook = useCallback((bookId: string) => {
        const staticMetadata = useLibraryStore.getState().staticMetadata;
        const offloadedBookIds = useLibraryStore.getState().offloadedBookIds;

        const isGhost = !staticMetadata[bookId] && !offloadedBookIds.has(bookId);
        const isOffloaded = offloadedBookIds.has(bookId);

        if (isGhost || isOffloaded) {
            onContentMissing(bookId);
            return;
        }
        navigate(`/read/${bookId}`);
    }, [navigate, onContentMissing]);

    // OPTIMIZATION: Memoize mapped output to prevent O(N) mapping on every search input keystroke
    const renderedGroups = useMemo(() => {
        return groups.map(group => (
            <BookNotesBlock
                key={group.bookId}
                group={group}
                onNavigate={handleNavigate}
                onOpenBook={handleOpenBook}
            />
        ));
    }, [groups, handleNavigate, handleOpenBook]);

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
                {pendingBookmarks.length > 0 && !debouncedQuery && (
                    <div className="mb-6">
                        <h2 className="text-sm font-semibold text-orange-500 mb-3 flex items-center gap-2">
                            <Mic size={16} /> Audio Bookmarks Inbox ({pendingBookmarks.length})
                        </h2>
                        <div className="flex flex-col gap-3">
                            {pendingBookmarks.map(bookmark => {
                                const book = useLibraryStore.getState().staticMetadata?.[bookmark.bookId];
                                return (
                                    <div key={bookmark.id} className="rounded-xl border border-orange-500/30 bg-orange-500/5">
                                        <div className="p-4 flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm italic text-muted-foreground mb-1 line-clamp-1">
                                                    {book?.title || 'Unknown Book'}
                                                </p>
                                                <p className="text-sm text-foreground line-clamp-3">
                                                    "{bookmark.text}"
                                                </p>
                                            </div>
                                            <div className="flex gap-2 w-full sm:w-auto">
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    className="flex-1 sm:flex-none text-destructive hover:bg-destructive/10 border-destructive/20"
                                                    onClick={() => useAnnotationStore.getState().remove(bookmark.id)}
                                                >
                                                    <Trash2 size={16} className="mr-2" /> Discard
                                                </Button>
                                                <Button
                                                    variant="default"
                                                    size="sm"
                                                    className="flex-1 sm:flex-none bg-orange-500 hover:bg-orange-600 text-white"
                                                    onClick={() => {
                                                        const store = useAnnotationStore.getState();
                                                        store.remove(bookmark.id);
                                                        store.add({
                                                            ...bookmark,
                                                            type: 'highlight',
                                                        });
                                                    }}
                                                >
                                                    <Check size={16} className="mr-2" /> Keep
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

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
                    renderedGroups
                )}
            </div>
        </div>
    );
};
