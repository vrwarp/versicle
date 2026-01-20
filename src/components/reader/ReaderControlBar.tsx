import React from 'react';
import { useTTSStore } from '../../store/useTTSStore';
import { useReadingStateStore } from '../../store/useReadingStateStore';
import { useReaderUIStore } from '../../store/useReaderUIStore';
import { useBook, useLastReadBook } from '../../store/selectors';
import { useAnnotationStore } from '../../store/useAnnotationStore';
import { CompassPill } from '../ui/CompassPill';
import type { ActionType } from '../ui/CompassPill';
import { useToastStore } from '../../store/useToastStore';
import { useNavigate } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { LexiconManager } from './LexiconManager';

export const ReaderControlBar: React.FC = () => {
    // Correctly using the store-based toast
    const showToast = useToastStore(state => state.showToast);
    const navigate = useNavigate();

    const [lexiconOpen, setLexiconOpen] = React.useState(false);
    const [lexiconText, setLexiconText] = React.useState('');

    // Store Subscriptions
    const { popover, add, hidePopover } = useAnnotationStore(useShallow(state => ({
        popover: state.popover,
        add: state.add,
        hidePopover: state.hidePopover,
    })));

    // Optimization: We only need to know if the queue has items to determine variant,
    // and if queue is empty to set title/subtitle manually.
    const hasQueueItems = useTTSStore(state => state.queue.length > 0);
    const isPlaying = useTTSStore(state => state.isPlaying);

    const { immersiveMode, currentSectionTitle, currentBookId } = useReaderUIStore(useShallow(state => ({
        immersiveMode: state.immersiveMode,
        currentSectionTitle: state.currentSectionTitle,
        currentBookId: state.currentBookId
    })));

    // OPTIMIZATION: Use granular selectors to avoid re-rendering on every library change.
    // Previously, we subscribed to `state.books`, causing re-renders whenever *any* book changed.
    // Now, we only re-render if the calculated `lastReadBook` or `currentBook` reference changes.

    // Select the most recently read book
    // OPTIMIZATION: Use specialized selector to avoid iterating all books
    const lastReadBook = useLastReadBook();

    // Select the current book if active
    // OPTIMIZATION: Use specialized selector
    const currentBook = useBook(currentBookId);

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
    } else if (isReaderActive) {
        variant = immersiveMode ? 'compact' : 'active';
    } else if (isPlaying) {
        variant = 'active';
    } else if (lastReadBook) { // Check lastReadBook existence directly
        // If not playing and not in reader, prefer Summary over a paused queue
        variant = 'summary';
    } else if (hasQueueItems) {
        // Fallback: If no last read book (unlikely in Library if we have a queue), but queue exists
        variant = 'active';
    } else {
        variant = null;
    }

    // Handle Annotation Actions
    const handleAnnotationAction = (action: ActionType, payload?: string) => {
        switch (action) {
            case 'color':
                if (payload && currentBookId) {
                    add({
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
                    add({
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
                    navigator.clipboard.writeText(popover.text).then(() => {
                        showToast("Copied to clipboard", "success");
                        setTimeout(() => hidePopover(), 1000);
                    }).catch(() => {
                        showToast("Failed to copy", "error");
                    });
                }
                break;
            case 'play':
                // Play from selection
                if (popover.cfiRange) {
                    const playFromSelection = useReaderUIStore.getState().playFromSelection;
                    if (playFromSelection) {
                        playFromSelection(popover.cfiRange);
                    } else {
                        showToast("Audio not ready yet", "error");
                    }
                    hidePopover();
                }
                break;
            case 'pronounce':
                if (popover.text) {
                    setLexiconText(popover.text);
                    setLexiconOpen(true);
                    hidePopover();
                }
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
        subtitle = "Continue Reading";
        // Get progress from reading state (max across all devices)
        const lastReadProgress = useReadingStateStore.getState().getProgress(lastReadBook.bookId);
        progress = (lastReadProgress?.percentage || 0) * 100;
    } else if ((variant === 'active' || variant === 'compact') && isReaderActive && currentBook) {
        // If queue is empty, CompassPill falls back to its own logic, but we can override it here.
        // If queue has items, CompassPill uses queue item title.
        // We can pass `title` as Book Title and `subtitle` as Section Title to be explicit.
        if (!hasQueueItems) {
            title = currentBook.title;
            subtitle = currentSectionTitle || undefined;
            // Get progress from reading state (max across all devices)
            const currentProgress = useReadingStateStore.getState().getProgress(currentBook.bookId);
            progress = (currentProgress?.percentage || 0) * 100;
        }
    }

    return (
        <>
            <div className="fixed bottom-8 left-0 right-0 z-40 px-4 pointer-events-none">
                <div className="pointer-events-auto shadow-2xl">
                    <CompassPill
                        key={variant}
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
                                navigate(`/read/${lastReadBook.id}`);
                            }
                        }}
                    />
                </div>
            </div>

            <LexiconManager
                key={lexiconOpen ? 'open' : 'closed'}
                open={lexiconOpen}
                onOpenChange={setLexiconOpen}
                initialTerm={lexiconText}
            />
        </>
    );
};
