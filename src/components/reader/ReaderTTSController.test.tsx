import { render, fireEvent } from '@testing-library/react';
import { ReaderTTSController } from './ReaderTTSController';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useTTSStore } from '@store/useTTSStore';
import { autoResetStores, makeTTSQueue, seedStore } from '@test/harness';
import type { Rendition } from 'epubjs';

// Harness migration (Phase 0): seeds the REAL useTTSStore (state via
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
    autoResetStores(useTTSStore);

    beforeEach(() => {
        vi.spyOn(console, 'error').mockImplementation(() => { });
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const setup = (status: 'playing' | 'paused' | 'stopped' = 'stopped', queueLength = 5, currentIndex = 0) => {
        seedStore(useTTSStore, {
            activeCfi: 'epubcfi(/6/4!/4/2)',
            currentIndex,
            status,
            isPlaying: status === 'playing',
            queue: makeTTSQueue(queueLength)
        });

        return render(
            <ReaderTTSController
                rendition={mockRendition as unknown as Rendition}
                viewMode="paginated"
            />
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
});
