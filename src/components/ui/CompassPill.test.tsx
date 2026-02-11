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
    Play: (props: any) => <span data-testid={props['data-testid'] || "icon-play"} />,
    Pause: (props: any) => <span data-testid={props['data-testid'] || "icon-pause"} />,
    StickyNote: () => <span data-testid="icon-sticky-note" />,
    Mic: () => <span data-testid="icon-mic" />,
    Copy: () => <span data-testid="icon-copy" />,
    X: () => <span data-testid="icon-x" />,
    BookOpen: () => <span data-testid="icon-book-open" />,
    Smartphone: () => <span data-testid="icon-smartphone" />,
    RefreshCw: () => <span data-testid="icon-refresh-cw" />,
    ArrowUpCircle: () => <span data-testid="icon-arrow-up-circle" />,
}));

// Mock useTTSStore
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: vi.fn()
}));

// Mock useReaderUIStore with selector support
vi.mock('../../store/useReaderUIStore', () => ({
    useReaderUIStore: (selector: any) => {
        const state = {
            currentSectionTitle: 'Test Chapter',
            toc: []
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

    it('renders sync-alert mode correctly', () => {
        vi.mocked(useTTSStore).mockReturnValue({
            isPlaying: false,
            queue: [],
            currentIndex: 0,
            jumpTo: mockJumpTo,
            play: mockPlay,
            pause: mockPause
        } as any);

        const handleAction = vi.fn();
        const handleClick = vi.fn();

        render(
            <CompassPill
                variant="sync-alert"
                title="Pick up from Phone?"
                subtitle="Jump to 45%"
                onAnnotationAction={handleAction}
                onClick={handleClick}
            />
        );

        // Check text content
        expect(screen.getByText('Pick up from Phone?')).toBeInTheDocument();
        expect(screen.getByText('Jump to 45%')).toBeInTheDocument();

        // Check click handler
        const mainButton = screen.getByText('Pick up from Phone?').closest('[role="button"]');
        fireEvent.click(mainButton!);
        expect(handleClick).toHaveBeenCalled();

        // Check dismiss
        const dismissBtn = screen.getByLabelText('Dismiss update');
        fireEvent.click(dismissBtn);
        expect(handleAction).toHaveBeenCalledWith('dismiss');
    });

    it('dispatches reader:chapter-nav event when "prev" button is clicked and not playing', () => {
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
        expect(event.detail.direction).toBe('prev');
    });

    it('dispatches reader:chapter-nav event when "next" button is clicked and not playing', () => {
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
        expect(event.detail.direction).toBe('next');
    });

    it('dispatches reader:chapter-nav event when "next" button is clicked and playing', () => {
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

        // Should still show chevrons, not skip icons
        expect(screen.getByTestId('icon-chevrons-right')).toBeInTheDocument();
        expect(screen.queryByTestId('icon-skip-forward')).not.toBeInTheDocument();

        const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
        const nextButton = screen.getByTestId('icon-chevrons-right').closest('button');
        fireEvent.click(nextButton!);

        expect(dispatchSpy).toHaveBeenCalled();
        const event = dispatchSpy.mock.calls[0][0] as CustomEvent;
        expect(event.type).toBe('reader:chapter-nav');
        expect(event.detail.direction).toBe('next');

        // Should NOT call jumpTo
        expect(mockJumpTo).not.toHaveBeenCalled();
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

    it('has consistent aria-labels in active mode', () => {
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

        prevButton = screen.getByTestId('icon-chevrons-left').closest('button');
        nextButton = screen.getByTestId('icon-chevrons-right').closest('button');

        expect(prevButton).toHaveAttribute('aria-label', 'Previous chapter');
        expect(nextButton).toHaveAttribute('aria-label', 'Next chapter');
    });

    it('renders summary mode correctly and handles interactions', () => {
        vi.mocked(useTTSStore).mockReturnValue({
            isPlaying: false,
            queue: [],
            currentIndex: 0,
            jumpTo: mockJumpTo,
            play: mockPlay,
            pause: mockPause
        } as any);

        const mockClick = vi.fn();
        render(
            <CompassPill
                variant="summary"
                title="Test Book"
                subtitle="Continue Reading"
                progress={45}
                onClick={mockClick}
            />
        );

        const summaryElement = screen.getByTestId('compass-pill-summary');
        expect(summaryElement).toBeInTheDocument();
        expect(summaryElement).toHaveAttribute('role', 'button');
        expect(summaryElement).toHaveAttribute('tabIndex', '0');
        expect(summaryElement).toHaveAttribute('aria-label', 'Continue reading Test Book, Continue Reading, 45% complete');
        expect(screen.getByText('Test Book')).toBeInTheDocument();
        expect(screen.getByText('Continue Reading')).toBeInTheDocument();
        expect(screen.getByText('45% complete')).toBeInTheDocument();
        expect(screen.getByTestId('icon-book-open')).toBeInTheDocument();

        // Click interaction
        fireEvent.click(summaryElement);
        expect(mockClick).toHaveBeenCalledTimes(1);

        // Keyboard interaction (Enter)
        fireEvent.keyDown(summaryElement, { key: 'Enter' });
        expect(mockClick).toHaveBeenCalledTimes(2);

        // Keyboard interaction (Space)
        fireEvent.keyDown(summaryElement, { key: ' ' });
        expect(mockClick).toHaveBeenCalledTimes(3);
    });

    it('shows playback indicator in active mode', () => {
        // Paused state
        vi.mocked(useTTSStore).mockReturnValue({
            isPlaying: false,
            queue: [{ title: 'Item 1' }],
            currentIndex: 0,
            jumpTo: mockJumpTo,
            play: mockPlay,
            pause: mockPause
        } as any);

        const { rerender } = render(<CompassPill variant="active" />);

        // Should show Play icon
        expect(screen.getByTestId('active-play-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('active-pause-icon')).not.toBeInTheDocument();

        // Playing state
        vi.mocked(useTTSStore).mockReturnValue({
            isPlaying: true,
            queue: [{ title: 'Item 1' }],
            currentIndex: 0,
            jumpTo: mockJumpTo,
            play: mockPlay,
            pause: mockPause
        } as any);

        rerender(<CompassPill variant="active" />);

        // Should show Pause icon
        expect(screen.getByTestId('active-pause-icon')).toBeInTheDocument();
        expect(screen.queryByTestId('active-play-icon')).not.toBeInTheDocument();
    });

    it('renders annotation mode with accessible color buttons', () => {
        vi.mocked(useTTSStore).mockReturnValue({
            isPlaying: false,
            queue: [],
            currentIndex: 0,
            jumpTo: mockJumpTo,
            play: mockPlay,
            pause: mockPause
        } as any);

        render(<CompassPill variant="annotation" />);

        const colors = ['yellow', 'green', 'blue', 'red'];
        colors.forEach(color => {
            const button = screen.getByTestId(`popover-color-${color}`);
            expect(button).toBeInTheDocument();
            expect(button).toHaveAttribute('aria-label', `Highlight ${color}`);
            // Verify focus classes are present
            expect(button).toHaveClass('focus-visible:ring-2');
            expect(button).toHaveClass('focus-visible:ring-ring');
            expect(button).toHaveClass('focus-visible:ring-offset-2');
        });
    });
});
