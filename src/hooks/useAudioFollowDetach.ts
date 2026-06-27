import { useEffect } from 'react';
import type { ContentView, ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useReaderUIStore } from '@store/useReaderUIStore';

/**
 * Drop out of audio-follow mode when the user manually scrolls during
 * playback. No-op when audio is idle, or already not following — so plain
 * reading never churns the store. (Module-scope: the listeners below all
 * share one debounced-by-state implementation.)
 */
function breakAudioFollowOnUserScroll() {
    if (useTTSPlaybackStore.getState().status === 'stopped') return;
    const ui = useReaderUIStore.getState();
    if (ui.followingAudio) ui.setFollowingAudio(false);
}

/**
 * useAudioFollowDetach — the maps-style "you swiped off the route" signal,
 * wired to the RIGHT surface.
 *
 * The reader renders each section inside its own epub.js iframe (flow:
 * 'scrolled-doc'). A finger or wheel over the book text dispatches its
 * wheel/touchmove events to the IFRAME's document, which never bubble to the
 * parent wrapper — so the wrapper-level listener in useReaderNavigation only
 * catches scrolls over the surrounding margin (the "sometimes it works"
 * the user saw). This hook attaches the same detach signal directly to every
 * rendered iframe document via the engine's contentRendered seam, so a swipe
 * on the text itself drops follow mode too.
 *
 * Why wheel + touchmove (not the native 'scroll' event): those two are purely
 * user-initiated. The audio-follow `engine.display()` scrolls the iframe
 * programmatically and would trip a 'scroll' listener, falsely detaching on
 * every sentence advance. wheel/touchmove fire only for real input, so no
 * programmatic-vs-user disambiguation is needed.
 */
export function useAudioFollowDetach(engine: ReaderEngine | null): void {
    useEffect(() => {
        if (!engine) return;

        // Keyed by the iframe document so re-renders don't double-bind; the
        // section href lets contentDestroyed evict the entry (the listeners
        // themselves die with the torn-down iframe regardless).
        const attached = new Map<Document, { href: string; detach: () => void }>();
        const listenerOpts: AddEventListenerOptions = { passive: true };

        const attach = (view: ContentView) => {
            const doc = view.document;
            if (!doc || attached.has(doc)) return;
            const onGesture = () => breakAudioFollowOnUserScroll();
            doc.addEventListener('wheel', onGesture, listenerOpts);
            doc.addEventListener('touchmove', onGesture, listenerOpts);
            attached.set(doc, {
                href: view.sectionHref,
                detach: () => {
                    doc.removeEventListener('wheel', onGesture, listenerOpts);
                    doc.removeEventListener('touchmove', onGesture, listenerOpts);
                },
            });
        };

        const detachByHref = (href: string) => {
            for (const [doc, entry] of attached) {
                if (entry.href === href) {
                    entry.detach();
                    attached.delete(doc);
                }
            }
        };

        // Bind the already-rendered sections, then keep up with renders.
        for (const view of engine.getContentViews()) attach(view);
        const unsubscribe = engine.subscribe((event) => {
            if (event.type === 'contentRendered') attach(event.view);
            else if (event.type === 'contentDestroyed') detachByHref(event.sectionHref);
        });

        return () => {
            unsubscribe();
            for (const entry of attached.values()) entry.detach();
            attached.clear();
        };
    }, [engine]);
}
