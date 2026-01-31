import { renderHook } from '@testing-library/react';
import { useHistoryHighlights } from './useHistoryHighlights';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock logger
vi.mock('../../lib/logger', () => ({
    createLogger: () => ({
        warn: vi.fn(),
    })
}));

describe('useHistoryHighlights', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockRendition: any;

    beforeEach(() => {
        mockRendition = {
            annotations: {
                add: vi.fn(),
                remove: vi.fn(),
            }
        };
    });

    it('adds annotations when completedRanges are provided', () => {
        const completedRanges = ['cfi1', 'cfi2'];
        renderHook(() => useHistoryHighlights(
            mockRendition,
            true,
            'book1',
            completedRanges,
            'currentCfi',
            false
        ));

        expect(mockRendition.annotations.add).toHaveBeenCalledTimes(2);
        expect(mockRendition.annotations.add).toHaveBeenCalledWith('highlight', 'cfi1', expect.anything(), null, expect.anything(), expect.anything());
        expect(mockRendition.annotations.add).toHaveBeenCalledWith('highlight', 'cfi2', expect.anything(), null, expect.anything(), expect.anything());
    });

    it('updates annotations when currentCfi changes', () => {
        const completedRanges1 = ['cfi1'];
        const completedRanges2 = ['cfi1', 'cfi2'];

        const { rerender } = renderHook(
            ({ completedRanges, currentCfi }) => useHistoryHighlights(
                mockRendition,
                true,
                'book1',
                completedRanges,
                currentCfi,
                false
            ),
            {
                initialProps: { completedRanges: completedRanges1, currentCfi: 'page1' }
            }
        );

        expect(mockRendition.annotations.add).toHaveBeenCalledTimes(1);
        mockRendition.annotations.add.mockClear();

        // Update completedRanges but NOT currentCfi -> updates because isPlaying=false (sync/load behavior)
        rerender({ completedRanges: completedRanges2, currentCfi: 'page1' });

        // It first removes cfi1 (cleanup), then adds cfi1, cfi2.
        expect(mockRendition.annotations.remove).toHaveBeenCalledWith('cfi1', 'highlight');
        expect(mockRendition.annotations.add).toHaveBeenCalledTimes(2);
    });

    it('suppresses updates when isPlaying is true and currentCfi is stable', () => {
        const completedRanges1 = ['cfi1'];
        const completedRanges2 = ['cfi1', 'cfi2'];

        const { rerender } = renderHook(
            ({ completedRanges, currentCfi, isPlaying }) => useHistoryHighlights(
                mockRendition,
                true,
                'book1',
                completedRanges,
                currentCfi,
                isPlaying
            ),
            {
                initialProps: { completedRanges: completedRanges1, currentCfi: 'page1', isPlaying: true }
            }
        );

        expect(mockRendition.annotations.add).toHaveBeenCalledTimes(1);
        mockRendition.annotations.add.mockClear();
        mockRendition.annotations.remove.mockClear();

        // Update completedRanges, isPlaying=true, currentCfi stable
        rerender({ completedRanges: completedRanges2, currentCfi: 'page1', isPlaying: true });

        // Should NOT update (no remove, no add)
        expect(mockRendition.annotations.remove).not.toHaveBeenCalled();
        expect(mockRendition.annotations.add).not.toHaveBeenCalled();

        // Now change currentCfi (page flip)
        rerender({ completedRanges: completedRanges2, currentCfi: 'page2', isPlaying: true });

        // Should update now:
        // Cleanup old effect (removes cfi1)
        expect(mockRendition.annotations.remove).toHaveBeenCalledWith('cfi1', 'highlight');
        // Add new ranges (cfi1, cfi2)
        expect(mockRendition.annotations.add).toHaveBeenCalledTimes(2);
    });

    it('removes annotations on unmount', () => {
        const completedRanges = ['cfi1'];
        const { unmount } = renderHook(() => useHistoryHighlights(
            mockRendition,
            true,
            'book1',
            completedRanges,
            'currentCfi',
            false
        ));

        unmount();
        expect(mockRendition.annotations.remove).toHaveBeenCalledWith('cfi1', 'highlight');
    });

    it('respects highlightMode="last-read"', () => {
        const completedRanges = ['cfi1', 'cfi2'];
        const lastPlayedCfi = 'lastCfi';

        renderHook(() => useHistoryHighlights(
            mockRendition,
            true,
            'book1',
            completedRanges,
            'currentCfi',
            false,
            'last-read', // mode
            lastPlayedCfi
        ));

        // Should ONLY add lastPlayedCfi
        expect(mockRendition.annotations.add).toHaveBeenCalledTimes(1);
        expect(mockRendition.annotations.add).toHaveBeenCalledWith('highlight', 'lastCfi', expect.anything(), null, expect.anything(), expect.anything());
    });

    it('switches between modes dynamically', () => {
        const completedRanges = ['cfi1'];
        const lastPlayedCfi = 'lastCfi';

        const { rerender } = renderHook(
            ({ mode }) => useHistoryHighlights(
                mockRendition,
                true,
                'book1',
                completedRanges,
                'currentCfi',
                false,
                mode,
                lastPlayedCfi
            ),
            {
                initialProps: { mode: 'all' as 'all' | 'last-read' }
            }
        );

        // Initially 'all' -> cfi1
        expect(mockRendition.annotations.add).toHaveBeenCalledWith('highlight', 'cfi1', expect.anything(), null, expect.anything(), expect.anything());
        mockRendition.annotations.add.mockClear();
        mockRendition.annotations.remove.mockClear();

        // Switch to 'last-read'
        rerender({ mode: 'last-read' });

        // Cleanup 'cfi1'
        expect(mockRendition.annotations.remove).toHaveBeenCalledWith('cfi1', 'highlight');
        // Add 'lastCfi'
        expect(mockRendition.annotations.add).toHaveBeenCalledWith('highlight', 'lastCfi', expect.anything(), null, expect.anything(), expect.anything());
    });
});
