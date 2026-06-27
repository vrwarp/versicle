import { renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useAudioFollowDetach } from './useAudioFollowDetach';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useReaderUIStore } from '@store/useReaderUIStore';
import type { ContentView, ReaderEngine, ReaderEngineEvent } from '@domains/reader/engine/ReaderEngine';

// A minimal engine fake: holds a swappable set of content views and lets the
// test push contentRendered/contentDestroyed through the real subscribe seam.
class FakeEngine {
    private listeners = new Set<(e: ReaderEngineEvent) => void>();
    views: ContentView[] = [];

    getContentViews(): ContentView[] {
        return this.views;
    }
    subscribe(listener: (e: ReaderEngineEvent) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
    emit(e: ReaderEngineEvent): void {
        for (const l of this.listeners) l(e);
    }
}

function makeView(href: string): ContentView {
    return {
        sectionHref: href,
        document: document.implementation.createHTMLDocument(href),
        window: window,
        iframeOffset: { top: 0, left: 0 },
        cfiFromRange: () => '',
    };
}

const asEngine = (fake: FakeEngine) => fake as unknown as ReaderEngine;

describe('useAudioFollowDetach', () => {
    beforeEach(() => {
        useTTSPlaybackStore.setState({ status: 'playing', isPlaying: true });
        useReaderUIStore.setState({ followingAudio: true });
    });

    it('drops follow on a wheel inside an already-rendered iframe document', () => {
        const engine = new FakeEngine();
        const view = makeView('ch1.xhtml');
        engine.views = [view];

        renderHook(() => useAudioFollowDetach(asEngine(engine)));

        view.document.dispatchEvent(new Event('wheel'));

        expect(useReaderUIStore.getState().followingAudio).toBe(false);
    });

    it('drops follow on a touchmove inside an iframe rendered after mount', () => {
        const engine = new FakeEngine();
        renderHook(() => useAudioFollowDetach(asEngine(engine)));

        const view = makeView('ch2.xhtml');
        engine.emit({ type: 'contentRendered', view });

        view.document.dispatchEvent(new Event('touchmove'));

        expect(useReaderUIStore.getState().followingAudio).toBe(false);
    });

    it('does NOT detach when audio is stopped (plain reading)', () => {
        useTTSPlaybackStore.setState({ status: 'stopped', isPlaying: false });
        const engine = new FakeEngine();
        const view = makeView('ch1.xhtml');
        engine.views = [view];

        renderHook(() => useAudioFollowDetach(asEngine(engine)));
        view.document.dispatchEvent(new Event('wheel'));

        expect(useReaderUIStore.getState().followingAudio).toBe(true);
    });

    it('stops listening once the section iframe is destroyed', () => {
        const engine = new FakeEngine();
        const view = makeView('ch1.xhtml');
        engine.views = [view];
        renderHook(() => useAudioFollowDetach(asEngine(engine)));

        engine.emit({ type: 'contentDestroyed', sectionHref: 'ch1.xhtml' });
        view.document.dispatchEvent(new Event('wheel'));

        // The listener was removed with the section, so follow is untouched.
        expect(useReaderUIStore.getState().followingAudio).toBe(true);
    });

    it('unbinds every iframe listener on unmount', () => {
        const engine = new FakeEngine();
        const view = makeView('ch1.xhtml');
        engine.views = [view];
        const { unmount } = renderHook(() => useAudioFollowDetach(asEngine(engine)));

        unmount();
        view.document.dispatchEvent(new Event('wheel'));

        expect(useReaderUIStore.getState().followingAudio).toBe(true);
    });
});
