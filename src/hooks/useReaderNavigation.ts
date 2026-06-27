import { useEffect, useRef } from 'react';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useReaderUIStore } from '@store/useReaderUIStore';

/**
 * Drop out of audio-follow mode when the user manually scrolls during
 * playback (the maps "you swiped away from the route" signal). No-op when
 * audio is idle, or already not following — so normal reading never churns
 * the store.
 */
function breakAudioFollowOnUserScroll() {
    if (useTTSPlaybackStore.getState().status === 'stopped') return;
    const ui = useReaderUIStore.getState();
    if (ui.followingAudio) ui.setFollowingAudio(false);
}

interface UseReaderNavigationProps {
    readerViewMode: 'paginated' | 'scrolled';
    scrollWrapperRef: React.RefObject<HTMLDivElement | null>;
    viewerRef: React.RefObject<HTMLDivElement | null>;
}

/**
 * Reader-area wheel + touch navigation (scrolled mode).
 *
 * Phase 8 §E: the KEYBOARD half of this hook — one of the two overlapping
 * window keydown registries, including the P0 interim TTS-status
 * predicate ("Interim mitigation until the Phase 8
 * KeyboardShortcutService replaces both") — was deleted. Page-turn keys
 * are now `useReaderPageTurnShortcuts` registrations on the
 * KeyboardShortcutService (src/app/shortcuts/), where scope stacking
 * replaces the cross-registry peeking; the engine's iframe keydown stream
 * feeds the same service via `useReaderEngineKeyBridge`.
 */
export function useReaderNavigation({
    readerViewMode,
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
                breakAudioFollowOnUserScroll();
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
                breakAudioFollowOnUserScroll();
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
}
