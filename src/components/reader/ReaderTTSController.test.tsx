import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { ReaderTTSController } from './ReaderTTSController';
import { useTTSStore } from '../../store/useTTSStore';

// Mock Store
vi.mock('../../store/useTTSStore');

describe('ReaderTTSController', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockRendition: any;
    let storeState: any;

    beforeEach(() => {
        vi.clearAllMocks();

        mockRendition = {
            display: vi.fn().mockResolvedValue(undefined),
            annotations: {
                add: vi.fn(),
                remove: vi.fn(),
            }
        };

        storeState = {
            activeCfi: null,
            currentIndex: 0,
            status: 'stopped',
            queue: [],
            jumpTo: vi.fn(),
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useTTSStore as any).mockImplementation((selector: any) => selector(storeState));
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should highlight active CFI when visible', () => {
        storeState.activeCfi = 'epubcfi(/6/14!/4/2/1:0)';
        Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });

        render(
            <ReaderTTSController
                rendition={mockRendition}
                viewMode="scrolled"
                onNext={vi.fn()}
                onPrev={vi.fn()}
            />
        );

        expect(mockRendition.annotations.add).toHaveBeenCalledWith(
            'highlight',
            'epubcfi(/6/14!/4/2/1:0)',
            expect.anything(),
            expect.anything(),
            'tts-highlight'
        );
    });

    it('should NOT highlight or display when hidden (background)', () => {
        storeState.activeCfi = 'epubcfi(/6/14!/4/2/1:0)';
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });

        render(
            <ReaderTTSController
                rendition={mockRendition}
                viewMode="paginated"
                onNext={vi.fn()}
                onPrev={vi.fn()}
            />
        );

        // Should NOT call display or highlight
        expect(mockRendition.display).not.toHaveBeenCalled();
        expect(mockRendition.annotations.add).not.toHaveBeenCalled();
    });

    it('should reconcile visibility when becoming visible', () => {
        // 1. Start hidden
        Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true });
        storeState.activeCfi = 'epubcfi(/6/14!/4/2/1:0)';

        const { rerender } = render(
            <ReaderTTSController
                rendition={mockRendition}
                viewMode="paginated"
                onNext={vi.fn()}
                onPrev={vi.fn()}
            />
        );

        expect(mockRendition.display).not.toHaveBeenCalled();

        // 2. Simulate visibility change to visible
        Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true });

        // Dispatch visibilitychange event
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });

        // Should now call display to catch up
        expect(mockRendition.display).toHaveBeenCalledWith('epubcfi(/6/14!/4/2/1:0)');
        // And highlight
        expect(mockRendition.annotations.add).toHaveBeenCalledWith(
            'highlight',
            'epubcfi(/6/14!/4/2/1:0)',
            expect.anything(),
            expect.anything(),
            'tts-highlight'
        );
    });

    it('should handle keyboard navigation', () => {
        storeState.status = 'playing';
        storeState.currentIndex = 5;
        storeState.queue = new Array(10).fill({}); // Length 10

        render(
            <ReaderTTSController
                rendition={mockRendition}
                viewMode="scrolled"
                onNext={vi.fn()}
                onPrev={vi.fn()}
            />
        );

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
        });
        expect(storeState.jumpTo).toHaveBeenCalledWith(4);

        act(() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
        });
        expect(storeState.jumpTo).toHaveBeenCalledWith(6);
    });
});
