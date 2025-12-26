import React, { useMemo } from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { useReaderStore } from '../../store/useReaderStore';
import { useLibraryStore } from '../../store/useLibraryStore';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { CompassPill } from '../audio/CompassPill';
import type { ActionType } from '../audio/CompassPill';
import { useToastStore } from '../../store/useToastStore';
import { useNavigate } from 'react-router-dom';

export const ReaderControlBar: React.FC = () => {
    // Correctly using the store-based toast
    const showToast = useToastStore(state => state.showToast);
    const navigate = useNavigate();

    // Store Subscriptions
    const { popover, addAnnotation, hidePopover } = useAnnotationStore(state => ({
        popover: state.popover,
        addAnnotation: state.addAnnotation,
        hidePopover: state.hidePopover,
    }));

    const { queue } = useTTSStore(state => ({
        queue: state.queue,
    }));

    const { immersiveMode, currentBookId, currentChapterTitle } = useReaderStore(state => ({
        immersiveMode: state.immersiveMode,
        currentBookId: state.currentBookId,
        currentChapterTitle: state.currentChapterTitle
    }));

    const books = useLibraryStore(state => state.books);

    // Memoize last read book calculation
    const lastReadBook = useMemo(() => {
        return books.filter(b => b.lastRead).sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0))[0];
    }, [books]);

    // Determine current book title if active
    const currentBook = useMemo(() => {
        return currentBookId ? books.find(b => b.id === currentBookId) : undefined;
    }, [currentBookId, books]);

    // Determine State Priority
    // 1. Annotation Mode
    const isAnnotationMode = popover.visible;

    // 2. Audio Mode OR Active Reader
    // If we are reading a book (currentBookId exists), we are active.
    // If audio queue has items, we are active.
    const isReaderActive = !!currentBookId;

    // Logic:
    let variant: 'annotation' | 'active' | 'summary' | 'compact' | null = null;

    if (isAnnotationMode) {
        variant = 'annotation';
    } else if (queue.length > 0 || isReaderActive) {
        variant = immersiveMode ? 'compact' : 'active';
    } else if (lastReadBook) { // Check lastReadBook existence directly
        variant = 'summary';
    } else {
        variant = null;
    }

    // Handle Annotation Actions
    const handleAnnotationAction = (action: ActionType, payload?: string) => {
        switch (action) {
            case 'color':
                if (payload && currentBookId) {
                    addAnnotation({
                        type: 'highlight',
                        color: payload,
                        bookId: currentBookId,
                        text: popover.text || '',
                        cfiRange: popover.cfiRange || ''
                    });
                    hidePopover();
                }
                break;
            case 'note':
                if (payload && currentBookId) {
                    addAnnotation({
                        type: 'note',
                        note: payload,
                        bookId: currentBookId,
                        text: popover.text || '',
                        cfiRange: popover.cfiRange || '',
                        color: 'yellow' // Default color for notes if not specified
                    });
                    showToast("Note saved", "success");
                    hidePopover();
                }
                break;
            case 'copy':
                 if (popover.text) {
                     navigator.clipboard.writeText(popover.text);
                     showToast("Copied to clipboard", "success");
                     hidePopover();
                 }
                break;
            case 'play':
                // Play from selection
                if (popover.cfiRange) {
                    // TODO: Implement playback from CFI
                    showToast("Play from here: Feature coming soon", "info");
                    hidePopover();
                }
                break;
            case 'pronounce':
                // Open Pronunciation Dialog
                showToast("Pronunciation: Feature coming soon", "info");
                // hidePopover(); // Keep it open?
                break;
            case 'dismiss':
                hidePopover();
                break;
        }
    };

    if (!variant) return null;

    // Determine props based on variant
    let title: string | undefined;
    let subtitle: string | undefined;
    let progress: number | undefined;

    if (variant === 'summary' && lastReadBook) {
        title = lastReadBook.title;
        subtitle = "Continue reading";
        progress = lastReadBook.progress;
    } else if ((variant === 'active' || variant === 'compact') && isReaderActive && currentBook) {
        // If queue is empty, CompassPill falls back to its own logic, but we can override it here.
        // If queue has items, CompassPill uses queue item title.
        // We can pass `title` as Book Title and `subtitle` as Chapter Title to be explicit.
        if (queue.length === 0) {
            title = currentBook.title;
            subtitle = currentChapterTitle || undefined;
            progress = currentBook.progress;
        }
    }

    return (
        <div className="fixed bottom-6 left-0 right-0 z-50 px-4 pointer-events-none">
            <div className="pointer-events-auto">
                <CompassPill
                    variant={variant}
                    title={title}
                    subtitle={subtitle}
                    progress={progress}
                    onAnnotationAction={handleAnnotationAction}
                    availableActions={{
                        play: true,
                        pronounce: true
                    }}
                    onClick={() => {
                        if (variant === 'summary' && lastReadBook) {
                            navigate(`/reader/${lastReadBook.id}`);
                        }
                    }}
                />
            </div>
        </div>
    );
};
