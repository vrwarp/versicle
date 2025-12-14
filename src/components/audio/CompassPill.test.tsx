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
}));

// Mock useTTSStore
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: vi.fn()
}));

// Mock useReaderStore
vi.mock('../../store/useReaderStore', () => ({
    useReaderStore: () => ({
        currentChapterTitle: 'Test Chapter'
    })
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

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('dispatches ArrowLeft event when "prev" button is clicked and not playing', () => {
        // Setup not playing
        vi.mocked(useTTSStore).mockReturnValue({
             isPlaying: false,
             queue: [{ title: 'Item 1' }],
             currentIndex: 0,
             jumpTo: mockJumpTo
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
             jumpTo: mockJumpTo
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
             jumpTo: mockJumpTo
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
         } as any);

        render(<CompassPill variant="active" />);

        const nextButton = screen.getByTestId('icon-skip-forward').closest('button');
        fireEvent.click(nextButton!);

        expect(mockJumpTo).toHaveBeenCalledWith(6);
    });
});
