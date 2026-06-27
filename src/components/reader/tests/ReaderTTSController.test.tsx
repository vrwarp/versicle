import type { ReactElement } from 'react';
import { render, fireEvent, act } from '@testing-library/react';
import { ReaderTTSController } from '../ReaderTTSController';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useTTSPlaybackStore } from '@store/useTTSPlaybackStore';
import { useReaderUIStore } from '@store/useReaderUIStore';
import { autoResetStores, makeTTSQueue, seedStore } from '@test/harness';
import { HighlightLayerManager, type AnnotatingRendition } from '@domains/reader/engine/HighlightLayerManager';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import { ReaderCommandsProvider, type ReaderCommands } from '@domains/reader/ui/ReaderCommands';
import { KeyboardShortcutHost } from '@app/shortcuts/KeyboardShortcutHost';

// Engine-port stub over a fake rendition: the controller consumes only
// display() + highlights, and the pins below keep asserting the underlying
// epub.js (fake rendition) call shapes — unchanged through the port cutover.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeEngineStub = (rendition: any): ReaderEngine =>
    ({
        display: rendition.display,
        highlights: new HighlightLayerManager(rendition as AnnotatingRendition),
        // useAudioFollowDetach binds gesture listeners to rendered iframe docs;
        // the stub has none, so the engine just reports an empty, inert surface.
        getContentViews: () => [],
        subscribe: () => () => { },
    }) as unknown as ReaderEngine;

// The controller rides the ReaderCommands context for the engine (Phase 6
// §5a) — the provider stands in for the shell.
const noopCommands: ReaderCommands = {
    jumpTo: () => { }, nextPage: () => { }, prevPage: () => { },
    nextChapter: () => { }, prevChapter: () => { },
    playFromSelection: () => { },
    refineSelection: () => null,
};
// Phase 8 §E: the controller's keys are KeyboardShortcutService
// registrations; the host (normally mounted by RootLayout) provides the
// single window keydown listener these suites drive with fireEvent.
const withEngine = (engine: ReaderEngine | null, ui: ReactElement) => (
    <ReaderCommandsProvider commands={noopCommands} engine={engine}>
        <KeyboardShortcutHost />
        {ui}
    </ReaderCommandsProvider>
);

// Harness migration (Phase 0): seeds the REAL useTTSPlaybackStore (state via
// setState) instead of vi.mock'ing the store module, so the test compiles
// against the real TTSState shape. Engine commands moved to the
// TtsController facade at Phase 5b-PR1, so the command spies mock the
// useAudioCommands hook module instead of living on the store.

const { mockJumpTo, mockPlay, mockPause, mockStop } = vi.hoisted(() => ({
    mockJumpTo: vi.fn(),
    mockPlay: vi.fn(),
    mockPause: vi.fn(),
    mockStop: vi.fn(),
}));

vi.mock('@app/tts/useAudioCommands', () => ({
    useAudioCommands: () => ({
        jumpTo: mockJumpTo,
        play: mockPlay,
        pause: mockPause,
        stop: mockStop,
    }),
}));

// Mock Rendition (simplified)
const mockRendition = {
    display: vi.fn().mockResolvedValue(undefined),
    annotations: {
        add: vi.fn(),
        remove: vi.fn()
    },
    views: vi.fn().mockReturnValue([])
};

describe('ReaderTTSController', () => {
    autoResetStores(useTTSPlaybackStore);

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => { });
        vi.clearAllMocks();
        // autoResetStores only resets the TTS store; keep follow-mode pinned
        // to its default (ON) so suites stay isolated.
        useReaderUIStore.setState({ followingAudio: true });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const setup = (status: 'playing' | 'paused' | 'stopped' = 'stopped', queueLength = 5, currentIndex = 0) => {
        seedStore(useTTSPlaybackStore, {
            activeCfi: 'epubcfi(/6/4!/4/2)',
            currentIndex,
            status,
            isPlaying: status === 'playing',
            queue: makeTTSQueue(queueLength)
        });

        return render(
            withEngine(
                makeEngineStub(mockRendition),
                <ReaderTTSController viewMode="paginated" />,
            )
        );
    };

    it('handles ArrowRight: jumps to next sentence when playing', () => {
        setup('playing', 5, 0);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(mockJumpTo).toHaveBeenCalledWith(1);
    });

    it('handles ArrowRight: does nothing when stopped (useReaderNavigation owns page turns)', () => {
        setup('stopped', 5, 0);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(mockJumpTo).not.toHaveBeenCalled();
    });

    it('handles ArrowLeft: jumps to previous sentence when playing', () => {
        setup('playing', 5, 1);
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(mockJumpTo).toHaveBeenCalledWith(0);
    });

    it('handles ArrowLeft: does nothing when stopped (useReaderNavigation owns page turns)', () => {
        setup('stopped', 5, 0);
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(mockJumpTo).not.toHaveBeenCalled();
    });

    it('handles Space: pauses when playing', () => {
        setup('playing');
        fireEvent.keyDown(window, { key: ' ' });
        expect(mockPause).toHaveBeenCalled();
        expect(mockPlay).not.toHaveBeenCalled();
    });

    it('handles Space: plays when paused', () => {
        setup('paused');
        fireEvent.keyDown(window, { key: ' ' });
        expect(mockPlay).toHaveBeenCalled();
        expect(mockPause).not.toHaveBeenCalled();
    });

    it('handles Space: does nothing when stopped (default behavior)', () => {
        setup('stopped');
        const preventDefault = vi.fn();
        fireEvent.keyDown(window, { key: ' ', preventDefault });
        expect(mockPlay).not.toHaveBeenCalled();
        expect(mockPause).not.toHaveBeenCalled();
        expect(preventDefault).not.toHaveBeenCalled();
    });

    it('handles Escape: stops when playing', () => {
        setup('playing');
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(mockStop).toHaveBeenCalled();
    });

    it('handles Escape: stops when paused', () => {
        setup('paused');
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(mockStop).toHaveBeenCalled();
    });

    it('handles Escape: does nothing when stopped', () => {
        setup('stopped');
        fireEvent.keyDown(window, { key: 'Escape' });
        expect(mockStop).not.toHaveBeenCalled();
    });

    describe('characterization: TTS highlight single-node invariant + orphan sweep (P6 entry gate)', () => {
        // Pins the CURRENT epub.js call pattern of the TTS sentence highlight
        // (prep/phase6-reader-engine.md §4 overlay #2) before the Phase 6
        // HighlightLayerManager absorbs the three duplicated DOM sweeps
        // (ReaderTTSController.tsx :69-81, :107-118, :143-154). The manager
        // cutover must keep every assertion here green — it centralizes the
        // sweep, it does not change the observable add/remove/sweep sequence.
        const makePaneWithOrphan = () => {
            const pane = document.createElement('div');
            pane.innerHTML = '<svg><g class="tts-highlight"></g></svg>';
            return pane;
        };

        const makeRendition = (panes: HTMLElement[]) => ({
            display: vi.fn().mockResolvedValue(undefined),
            annotations: { add: vi.fn(), remove: vi.fn() },
            views: vi.fn().mockReturnValue(panes.map(element => ({ pane: { element } }))),
        });

        const renderWith = (rendition: ReturnType<typeof makeRendition>,
            status: 'playing' | 'paused' | 'stopped', activeCfi = 'epubcfi(/6/4!/4/2)') => {
            seedStore(useTTSPlaybackStore, {
                activeCfi,
                currentIndex: 0,
                status,
                isPlaying: status === 'playing',
                queue: makeTTSQueue(3)
            });
            return render(
                withEngine(
                    makeEngineStub(rendition),
                    <ReaderTTSController viewMode="paginated" />,
                )
            );
        };

        it('adds exactly ONE tts-highlight per active sentence and sweeps orphaned SVG nodes first', () => {
            const pane = makePaneWithOrphan();
            const rendition = makeRendition([pane]);

            renderWith(rendition, 'playing');

            // Orphan sweep ran against every view pane…
            expect(pane.querySelectorAll('g.tts-highlight').length).toBe(0);
            // …then exactly one highlight was added for the active CFI.
            expect(rendition.annotations.add).toHaveBeenCalledTimes(1);
            expect(rendition.annotations.add).toHaveBeenCalledWith(
                'highlight', 'epubcfi(/6/4!/4/2)', {}, expect.any(Function), 'tts-highlight'
            );
            expect(rendition.display).toHaveBeenCalledWith('epubcfi(/6/4!/4/2)');
        });

        it('removes the previous highlight (and re-sweeps) when the active sentence advances', () => {
            const rendition = makeRendition([makePaneWithOrphan()]);
            renderWith(rendition, 'playing', 'cfi-A');
            expect(rendition.annotations.add).toHaveBeenCalledTimes(1);

            act(() => {
                useTTSPlaybackStore.setState({ activeCfi: 'cfi-B' });
            });

            expect(rendition.annotations.remove).toHaveBeenCalledWith('cfi-A', 'highlight');
            // One add per CFI — never two live highlights.
            const addedCfis = rendition.annotations.add.mock.calls.map(c => c[1]);
            expect(addedCfis).toEqual(['cfi-A', 'cfi-B']);
        });

        it('keeps a single highlight across pause/resume (status change re-applies, never duplicates)', () => {
            const rendition = makeRendition([makePaneWithOrphan()]);
            renderWith(rendition, 'playing', 'cfi-A');

            act(() => { useTTSPlaybackStore.setState({ status: 'paused', isPlaying: false }); });
            act(() => { useTTSPlaybackStore.setState({ status: 'playing', isPlaying: true }); });

            const addedCfis = rendition.annotations.add.mock.calls.map(c => c[1]);
            const removedCfis = rendition.annotations.remove.mock.calls.map(c => c[0]);
            // Every add for cfi-A is preceded by a remove of cfi-A (add count
            // never exceeds remove count + 1) — the single-node invariant.
            expect(addedCfis.every(c => c === 'cfi-A')).toBe(true);
            expect(addedCfis.length).toBeLessThanOrEqual(removedCfis.length + 1);
        });

        it('stops highlighting (no add) once status is stopped', () => {
            const rendition = makeRendition([makePaneWithOrphan()]);
            renderWith(rendition, 'stopped');
            expect(rendition.annotations.add).not.toHaveBeenCalled();
        });

        it('reconciles on visibilitychange: display + remove + sweep + re-add for the fresh CFI', () => {
            const pane = makePaneWithOrphan();
            const rendition = makeRendition([pane]);
            renderWith(rendition, 'playing', 'cfi-A');
            rendition.annotations.add.mockClear();
            rendition.annotations.remove.mockClear();
            rendition.display.mockClear();

            // Simulate a background queue advance, then return to foreground.
            act(() => { useTTSPlaybackStore.setState({ activeCfi: 'cfi-FRESH' }); });
            pane.innerHTML = '<svg><g class="tts-highlight"></g></svg>'; // orphan re-appears
            Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true });
            fireEvent(document, new Event('visibilitychange'));

            expect(rendition.display).toHaveBeenCalledWith('cfi-FRESH');
            expect(rendition.annotations.remove).toHaveBeenCalledWith('cfi-FRESH', 'highlight');
            expect(pane.querySelectorAll('g.tts-highlight').length).toBe(0);
            const lastAdd = rendition.annotations.add.mock.calls.at(-1);
            expect(lastAdd?.[1]).toBe('cfi-FRESH');
            expect(lastAdd?.[4]).toBe('tts-highlight');
        });
    });

    describe('audio-follow ("navigation") mode: re-center vs leave-alone', () => {
        const makeRendition = () => ({
            display: vi.fn().mockResolvedValue(undefined),
            annotations: { add: vi.fn(), remove: vi.fn() },
            views: vi.fn().mockReturnValue([]),
        });

        const renderPlaying = (rendition: ReturnType<typeof makeRendition>, activeCfi = 'cfi-A') => {
            seedStore(useTTSPlaybackStore, {
                activeCfi,
                currentIndex: 0,
                status: 'playing',
                isPlaying: true,
                queue: makeTTSQueue(3),
            });
            return render(
                withEngine(makeEngineStub(rendition), <ReaderTTSController viewMode="scrolled" />)
            );
        };

        it('does NOT re-center (no display) when the user has scrolled away, but still highlights', () => {
            useReaderUIStore.setState({ followingAudio: false });
            const rendition = makeRendition();

            renderPlaying(rendition);

            // Scroll position is left untouched...
            expect(rendition.display).not.toHaveBeenCalled();
            // ...but the spoken sentence is still highlighted (for when the
            // user scrolls back, or taps re-center).
            expect(rendition.annotations.add).toHaveBeenCalledTimes(1);
        });

        it('snaps back to the current sentence when following is re-engaged (the re-center button)', () => {
            useReaderUIStore.setState({ followingAudio: false });
            const rendition = makeRendition();

            renderPlaying(rendition, 'cfi-A');
            expect(rendition.display).not.toHaveBeenCalled();

            act(() => { useReaderUIStore.setState({ followingAudio: true }); });

            expect(rendition.display).toHaveBeenCalledWith('cfi-A');
        });

        it('re-engages following automatically on a fresh playback (stopped → playing)', () => {
            useReaderUIStore.setState({ followingAudio: false });
            const rendition = makeRendition();
            seedStore(useTTSPlaybackStore, {
                activeCfi: 'cfi-A',
                currentIndex: 0,
                status: 'stopped',
                isPlaying: false,
                queue: makeTTSQueue(3),
            });
            render(
                withEngine(makeEngineStub(rendition), <ReaderTTSController viewMode="scrolled" />)
            );

            act(() => { useTTSPlaybackStore.setState({ status: 'playing', isPlaying: true }); });

            expect(useReaderUIStore.getState().followingAudio).toBe(true);
        });
    });

    describe('regression: overlapping global keyboard registries (keyboard-gating hotfix)', () => {
        it('ignores key auto-repeat for sentence jumps', () => {
            setup('playing', 5, 0);
            fireEvent.keyDown(window, { key: 'ArrowRight', repeat: true });
            expect(mockJumpTo).not.toHaveBeenCalled();
        });

        it('leaves Space to a focused interactive control instead of toggling playback', () => {
            setup('playing');
            const button = document.createElement('button');
            document.body.appendChild(button);
            button.focus();

            const notPrevented = fireEvent.keyDown(button, { key: ' ' });

            expect(mockPause).not.toHaveBeenCalled();
            expect(mockPlay).not.toHaveBeenCalled();
            // The button keeps its own Space activation (no preventDefault)
            expect(notPrevented).toBe(true);

            document.body.removeChild(button);
        });

        it('still toggles playback on Space when no interactive control is focused', () => {
            setup('playing');
            fireEvent.keyDown(document.body, { key: ' ' });
            expect(mockPause).toHaveBeenCalled();
        });

        it('does not stop playback on Escape while an overlay is open', () => {
            setup('playing');
            const dialog = document.createElement('div');
            dialog.setAttribute('role', 'dialog');
            dialog.setAttribute('data-state', 'open');
            document.body.appendChild(dialog);

            fireEvent.keyDown(window, { key: 'Escape' });
            expect(mockStop).not.toHaveBeenCalled();

            // Once the overlay is closed, Escape stops playback again
            document.body.removeChild(dialog);
            fireEvent.keyDown(window, { key: 'Escape' });
            expect(mockStop).toHaveBeenCalled();
        });

        it('does not stop playback on Escape while an overlay is closing (data-state="closed" ignored, popper open honored)', () => {
            setup('playing');
            const popperWrapper = document.createElement('div');
            popperWrapper.setAttribute('data-radix-popper-content-wrapper', '');
            const popperContent = document.createElement('div');
            popperContent.setAttribute('data-state', 'open');
            popperWrapper.appendChild(popperContent);
            document.body.appendChild(popperWrapper);

            fireEvent.keyDown(window, { key: 'Escape' });
            expect(mockStop).not.toHaveBeenCalled();

            // A closing (animating-out) overlay no longer owns Escape
            popperContent.setAttribute('data-state', 'closed');
            fireEvent.keyDown(window, { key: 'Escape' });
            expect(mockStop).toHaveBeenCalled();

            document.body.removeChild(popperWrapper);
        });
    });
    // Absorbed from the duplicate suite at tests/ReaderTTSController.test.tsx
    // (D13 dedupe, Phase 6 PR-14): the redundant foreground-sync case is
    // covered by the visibilitychange reconciliation pin above; these three
    // gating cases were the file's unique assertions.
    describe('regression: arrow keys defer to focused text inputs (D13 absorption)', () => {
        it('ignores arrow keys when an input is focused', () => {
            setup('playing', 5, 1);
            const input = document.createElement('input');
            document.body.appendChild(input);
            input.focus();

            fireEvent.keyDown(input, { key: 'ArrowLeft', bubbles: true });
            fireEvent.keyDown(input, { key: 'ArrowRight', bubbles: true });
            expect(mockJumpTo).not.toHaveBeenCalled();

            document.body.removeChild(input);
        });

        it('ignores arrow keys when a textarea is focused', () => {
            setup('playing', 5, 1);
            const textarea = document.createElement('textarea');
            document.body.appendChild(textarea);
            textarea.focus();

            fireEvent.keyDown(textarea, { key: 'ArrowLeft', bubbles: true });
            fireEvent.keyDown(textarea, { key: 'ArrowRight', bubbles: true });
            expect(mockJumpTo).not.toHaveBeenCalled();

            document.body.removeChild(textarea);
        });

        it('responds to arrow keys when no text input is focused', () => {
            setup('playing', 5, 1);
            document.body.focus();

            fireEvent.keyDown(document.body, { key: 'ArrowLeft', bubbles: true });
            expect(mockJumpTo).toHaveBeenCalledWith(0); // index - 1
        });
    });
});
