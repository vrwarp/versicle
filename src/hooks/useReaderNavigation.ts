import { useEffect, useRef } from 'react';

interface UseReaderNavigationProps {
    rendition: any;
    readerViewMode: 'paginated' | 'scrolled';
    handlePrev: () => void;
    handleNext: () => void;
    scrollWrapperRef: React.RefObject<HTMLDivElement | null>;
    viewerRef: React.RefObject<HTMLDivElement | null>;
}

export function useReaderNavigation({
    rendition,
    readerViewMode,
    handlePrev,
    handleNext,
    scrollWrapperRef,
    viewerRef
}: UseReaderNavigationProps) {
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);

    // Wheel and Touch events for scrolled mode
    useEffect(() => {
        const wrapper = scrollWrapperRef.current;
        if (!wrapper) return;

        const handleWheel = (e: WheelEvent) => {
            if (readerViewMode !== 'scrolled') return;
            const epubContainer = viewerRef.current?.firstElementChild as HTMLElement;
            if (epubContainer) {
                epubContainer.scrollBy({ top: e.deltaY, left: e.deltaX });
                if (e.cancelable) e.preventDefault();
            }
        };

        const handleTouchStart = (e: TouchEvent) => {
            if (readerViewMode !== 'scrolled') return;
            touchStartRef.current = { y: e.touches[0].clientY, x: e.touches[0].clientX };
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (readerViewMode !== 'scrolled' || !touchStartRef.current) return;
            const deltaY = touchStartRef.current.y - e.touches[0].clientY;
            const deltaX = touchStartRef.current.x - e.touches[0].clientX;

            const epubContainer = viewerRef.current?.firstElementChild as HTMLElement;
            if (epubContainer) {
                epubContainer.scrollBy({ top: deltaY, left: deltaX });
                if (e.cancelable) e.preventDefault();
            }

            touchStartRef.current = { y: e.touches[0].clientY, x: e.touches[0].clientX };
        };

        const handleTouchEnd = () => {
            touchStartRef.current = null;
        };

        wrapper.addEventListener('wheel', handleWheel, { passive: false });
        wrapper.addEventListener('touchstart', handleTouchStart, { passive: true });
        wrapper.addEventListener('touchmove', handleTouchMove, { passive: false });
        wrapper.addEventListener('touchend', handleTouchEnd, { passive: true });

        return () => {
            wrapper.removeEventListener('wheel', handleWheel);
            wrapper.removeEventListener('touchstart', handleTouchStart);
            wrapper.removeEventListener('touchmove', handleTouchMove);
            wrapper.removeEventListener('touchend', handleTouchEnd);
        };
    }, [readerViewMode, scrollWrapperRef, viewerRef]);

    // Keyboard navigation (Left/Right Arrows)
    useEffect(() => {
        const handleKeyDown = (e: Event) => {
            const keyboardEvent = e as KeyboardEvent;

            // Prevent holding the key down from spamming page turns
            if (keyboardEvent.repeat) return;

            // Ignore keypresses if the user is typing in an input field (like the Search or Notes panel)
            const target = keyboardEvent.target as Element;
            if (
                target &&
                (target.tagName === 'INPUT' ||
                    target.tagName === 'TEXTAREA' ||
                    (target as HTMLElement).isContentEditable)
            ) {
                return;
            }

            if (keyboardEvent.key === 'ArrowLeft') {
                if (keyboardEvent.cancelable) {
                    keyboardEvent.preventDefault();
                }
                handlePrev();
            } else if (keyboardEvent.key === 'ArrowRight') {
                if (keyboardEvent.cancelable) {
                    keyboardEvent.preventDefault();
                }
                handleNext();
            }
        };

        // 1. Listen on the parent window (active when clicking menus, buttons, HUD)
        window.addEventListener('keydown', handleKeyDown);

        // 2. Listen on the iframe via the epubjs rendition (active when clicking the book text)
        if (rendition) {
            // @ts-ignore - epub.js typings might be incomplete for event names
            rendition.on('keydown', handleKeyDown);
        }

        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            if (rendition) {
                // @ts-ignore
                rendition.off('keydown', handleKeyDown);
            }
        };
    }, [rendition, handlePrev, handleNext]);
}
