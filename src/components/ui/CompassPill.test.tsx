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
    SkipBack: () => <span data-testid="icon-skip-back" />,
    SkipForward: () => <span data-testid="icon-skip-forward" />,
    Play: () => <span data-testid="icon-play" />,
    Pause: () => <span data-testid="icon-pause" />,
}));

// Mock useTTSStore
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: vi.fn()
}));

// Mock useReaderStore with selector support
vi.mock('../../store/useReaderStore', () => ({
    useReaderStore: (selector: any) => {
        const state = {
            currentChapterTitle: 'Test Chapter'
        };
        return selector ? selector(state) : state;
    }
}));

// Mock useChapterDuration
vi.mock('../../hooks/useChapterDuration', () => ({
    useChapterDuration: () => ({
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

    it('dispatches ArrowLeft event when "prev" button is clicked and not playing', () => {
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
        const event = dispatchSpy.mock.calls[0][0] as KeyboardEvent;
        expect(event.type).toBe('keydown');
        expect(event.key).toBe('ArrowLeft');
    });

    it('dispatches ArrowRight event when "next" button is clicked and not playing', () => {
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
        const event = dispatchSpy.mock.calls[0][0] as KeyboardEvent;
        expect(event.type).toBe('keydown');
        expect(event.key).toBe('ArrowRight');
    });

    it('calls jumpTo when "next" button is clicked and playing', () => {
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

        const nextButton = screen.getByTestId('icon-skip-forward').closest('button');
        fireEvent.click(nextButton!);

        expect(mockJumpTo).toHaveBeenCalledWith(6);
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

   it('has correct aria-labels in active mode', () => {
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

       const prevButton = screen.getByTestId('icon-chevrons-left').closest('button');
       const nextButton = screen.getByTestId('icon-chevrons-right').closest('button');

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

       const skipBackButton = screen.getByTestId('icon-skip-back').closest('button');
       const skipForwardButton = screen.getByTestId('icon-skip-forward').closest('button');

       expect(skipBackButton).toHaveAttribute('aria-label', 'Skip to previous sentence');
       expect(skipForwardButton).toHaveAttribute('aria-label', 'Skip to next sentence');
   });
});
