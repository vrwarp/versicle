import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { ReaderTTSController } from './ReaderTTSController';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useTTSStore } from '../../store/useTTSStore';

// Mock useTTSStore
vi.mock('../../store/useTTSStore', () => ({
    useTTSStore: vi.fn()
}));

// Mock Rendition (simplified)
const mockRendition = {
    display: vi.fn().mockResolvedValue(undefined),
    annotations: {
        add: vi.fn(),
        remove: vi.fn()
    }
};

describe('ReaderTTSController', () => {
    const mockJumpTo = vi.fn();
    const mockPlay = vi.fn();
    const mockPause = vi.fn();
    const mockStop = vi.fn();
    const mockOnNext = vi.fn();
    const mockOnPrev = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    const setup = (status: 'playing' | 'paused' | 'stopped' = 'stopped', queueLength = 5, currentIndex = 0) => {
        vi.mocked(useTTSStore).mockImplementation((selector: any) => {
            const state = {
                activeCfi: 'epubcfi(/6/4!/4/2)',
                currentIndex,
                status,
                queue: new Array(queueLength).fill({ title: 'Item' }),
                jumpTo: mockJumpTo,
                play: mockPlay,
                pause: mockPause,
                stop: mockStop
            };
            return selector ? selector(state) : state;
        });

        // Mock getState on the store itself (needed for visibility change logic in component)
        (useTTSStore as any).getState = () => ({
            activeCfi: 'epubcfi(/6/4!/4/2)',
            status
        });

        return render(
            <ReaderTTSController
                rendition={mockRendition as any}
                viewMode="paginated"
                onNext={mockOnNext}
                onPrev={mockOnPrev}
            />
        );
    };

    it('handles ArrowRight: jumps to next sentence when playing', () => {
        setup('playing', 5, 0);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(mockJumpTo).toHaveBeenCalledWith(1);
        expect(mockOnNext).not.toHaveBeenCalled();
    });

    it('handles ArrowRight: navigates to next page when stopped', () => {
        setup('stopped', 5, 0);
        fireEvent.keyDown(window, { key: 'ArrowRight' });
        expect(mockJumpTo).not.toHaveBeenCalled();
        expect(mockOnNext).toHaveBeenCalled();
    });

    it('handles ArrowLeft: jumps to previous sentence when playing', () => {
        setup('playing', 5, 1);
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(mockJumpTo).toHaveBeenCalledWith(0);
        expect(mockOnPrev).not.toHaveBeenCalled();
    });

    it('handles ArrowLeft: navigates to previous page when stopped', () => {
        setup('stopped', 5, 0);
        fireEvent.keyDown(window, { key: 'ArrowLeft' });
        expect(mockJumpTo).not.toHaveBeenCalled();
        expect(mockOnPrev).toHaveBeenCalled();
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
});
