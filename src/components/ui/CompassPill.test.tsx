/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { CompassPill } from './CompassPill';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { useTTSStore } from '../../store/useTTSStore';

// Mock Lucide icons
vi.mock('lucide-react', () => ({
    ChevronsLeft: () => <span data-testid="icon-chevrons-left" />,
    ChevronsRight: () => <span data-testid="icon-chevrons-right" />,
    Play: () => <span data-testid="icon-play" />,
    Pause: () => <span data-testid="icon-pause" />,
    StickyNote: () => <span data-testid="icon-sticky-note" />,
    Mic: () => <span data-testid="icon-mic" />,
    Copy: () => <span data-testid="icon-copy" />,
    X: () => <span data-testid="icon-x" />,
}));

// Mock useTTSStore
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: vi.fn()
}));

// Mock useReaderStore with selector support
vi.mock('../../store/useReaderStore', () => ({
    useReaderStore: (selector: any) => {
        const state = {
            currentSectionTitle: 'Test Chapter'
        };
        return selector ? selector(state) : state;
    }
}));

// Mock useSectionDuration
vi.mock('../../hooks/useSectionDuration', () => ({
    useSectionDuration: () => ({
        timeRemaining: 5, // 5 minutes
        progress: 50
    })
}));

describe('CompassPill', () => {
    const mockJumpTo = vi.fn();
    const mockPlay = vi.fn();
    const mockPause = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('dispatches reader:chapter-nav prev event when "prev" button is clicked', () => {
        // Setup not playing
        vi.mocked(useTTSStore).mockReturnValue({
             isPlaying: false,
             queue: [{ title: 'Item 1' }],
             currentIndex: 0,
             jumpTo: mockJumpTo,
             play: mockPlay,
             pause: mockPause
        } as any);

        render(<CompassPill variant="active" />);

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
        const prevButton = screen.getByTestId('icon-chevrons-left').closest('button');

        fireEvent.click(prevButton!);

        expect(dispatchSpy).toHaveBeenCalled();
        const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
        expect(event.type).toBe('reader:chapter-nav');
        expect(event.detail).toEqual({ direction: 'prev' });
    });

    it('dispatches reader:chapter-nav next event when "next" button is clicked', () => {
         // Setup not playing
         vi.mocked(useTTSStore).mockReturnValue({
             isPlaying: false,
             queue: [{ title: 'Item 1' }],
             currentIndex: 0,
             jumpTo: mockJumpTo,
             play: mockPlay,
             pause: mockPause
         } as any);

        render(<CompassPill variant="active" />);

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
        const nextButton = screen.getByTestId('icon-chevrons-right').closest('button');

        fireEvent.click(nextButton!);

        expect(dispatchSpy).toHaveBeenCalled();
        const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
        expect(event.type).toBe('reader:chapter-nav');
        expect(event.detail).toEqual({ direction: 'next' });
    });

    it('dispatches reader:chapter-nav even when playing (instead of jumpTo)', () => {
         // Setup playing
         vi.mocked(useTTSStore).mockReturnValue({
             isPlaying: true,
             queue: [{ title: 'Item 1' }],
             currentIndex: 5,
             jumpTo: mockJumpTo,
             play: mockPlay,
             pause: mockPause
         } as any);

        render(<CompassPill variant="active" />);

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
        // Now it uses chevrons even when playing
        const nextButton = screen.getByTestId('icon-chevrons-right').closest('button');
        fireEvent.click(nextButton!);

        // Expect dispatch, NOT jumpTo
        expect(mockJumpTo).not.toHaveBeenCalled();
        expect(dispatchSpy).toHaveBeenCalled();
        const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
        expect(event.type).toBe('reader:chapter-nav');
        expect(event.detail).toEqual({ direction: 'next' });
    });

    it('renders compact mode correctly', () => {
        vi.mocked(useTTSStore).mockReturnValue({
            isPlaying: false,
            queue: [{ title: 'Item 1' }],
            currentIndex: 0,
            jumpTo: mockJumpTo,
            play: mockPlay,
            pause: mockPause
        } as any);

        render(<CompassPill variant="compact" />);

        expect(screen.getByTestId('compass-pill-compact')).toBeInTheDocument();
        expect(screen.getByTestId('icon-play')).toBeInTheDocument();
    });

    it('toggles play/pause in compact mode', () => {
         vi.mocked(useTTSStore).mockReturnValue({
            isPlaying: false,
            queue: [{ title: 'Item 1' }],
            currentIndex: 0,
            jumpTo: mockJumpTo,
            play: mockPlay,
            pause: mockPause
        } as any);

        render(<CompassPill variant="compact" />);
        const playButton = screen.getByTestId('icon-play').closest('button');
        fireEvent.click(playButton!);
        expect(mockPlay).toHaveBeenCalled();
    });

    it('pauses when playing in compact mode', () => {
        vi.mocked(useTTSStore).mockReturnValue({
           isPlaying: true,
           queue: [{ title: 'Item 1' }],
           currentIndex: 0,
           jumpTo: mockJumpTo,
           play: mockPlay,
           pause: mockPause
       } as any);

       render(<CompassPill variant="compact" />);
       const pauseButton = screen.getByTestId('icon-pause').closest('button');
       fireEvent.click(pauseButton!);
       expect(mockPause).toHaveBeenCalled();
   });

   it('has consistent aria-labels regardless of playing state', () => {
       // Setup not playing
       vi.mocked(useTTSStore).mockReturnValue({
           isPlaying: false,
           queue: [{ title: 'Item 1' }],
           currentIndex: 0,
           jumpTo: mockJumpTo,
           play: mockPlay,
           pause: mockPause
       } as any);

       const { rerender } = render(<CompassPill variant="active" />);

       let prevButton = screen.getByTestId('icon-chevrons-left').closest('button');
       let nextButton = screen.getByTestId('icon-chevrons-right').closest('button');

       expect(prevButton).toHaveAttribute('aria-label', 'Previous chapter');
       expect(nextButton).toHaveAttribute('aria-label', 'Next chapter');

       // Setup playing
       vi.mocked(useTTSStore).mockReturnValue({
           isPlaying: true,
           queue: [{ title: 'Item 1' }],
           currentIndex: 0,
           jumpTo: mockJumpTo,
           play: mockPlay,
           pause: mockPause
       } as any);

       rerender(<CompassPill variant="active" />);

       // Still chevrons and same labels
       prevButton = screen.getByTestId('icon-chevrons-left').closest('button');
       nextButton = screen.getByTestId('icon-chevrons-right').closest('button');

       expect(prevButton).toHaveAttribute('aria-label', 'Previous chapter');
       expect(nextButton).toHaveAttribute('aria-label', 'Next chapter');
   });
});
