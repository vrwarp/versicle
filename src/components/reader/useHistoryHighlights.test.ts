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

    it('adds annotation for lastPlayedCfi', () => {
        const lastPlayedCfi = 'cfi1';
        renderHook(() => useHistoryHighlights(
            mockRendition,
            true,
            'book1',
            'currentCfi',
            false,
            lastPlayedCfi
        ));

        expect(mockRendition.annotations.add).toHaveBeenCalledTimes(1);
        expect(mockRendition.annotations.add).toHaveBeenCalledWith(
            'highlight',
            'cfi1',
            expect.anything(),
            null,
            'reading-history-highlight',
            expect.objectContaining({ fill: 'gray' })
        );
    });

    it('does not add annotation if lastPlayedCfi is missing', () => {
        renderHook(() => useHistoryHighlights(
            mockRendition,
            true,
            'book1',
            'currentCfi',
            false,
            undefined
        ));

        expect(mockRendition.annotations.add).not.toHaveBeenCalled();
    });

    it('updates annotation when lastPlayedCfi changes', () => {
        const { rerender } = renderHook(
            ({ lastPlayedCfi }) => useHistoryHighlights(
                mockRendition,
                true,
                'book1',
                'currentCfi',
                false,
                lastPlayedCfi
            ),
            {
                initialProps: { lastPlayedCfi: 'cfi1' as string | undefined }
            }
        );

        expect(mockRendition.annotations.add).toHaveBeenCalledWith('highlight', 'cfi1', expect.anything(), null, expect.anything(), expect.anything());
        mockRendition.annotations.add.mockClear();

        // Update lastPlayedCfi
        rerender({ lastPlayedCfi: 'cfi2' });

        // Cleanup old cfi1
        expect(mockRendition.annotations.remove).toHaveBeenCalledWith('cfi1', 'highlight');
        // Add new cfi2
        expect(mockRendition.annotations.add).toHaveBeenCalledWith('highlight', 'cfi2', expect.anything(), null, expect.anything(), expect.anything());
    });

    it('suppresses updates when isPlaying is true', () => {
        const { rerender } = renderHook(
            ({ lastPlayedCfi, isPlaying }) => useHistoryHighlights(
                mockRendition,
                true,
                'book1',
                'currentCfi',
                isPlaying,
                lastPlayedCfi
            ),
            {
                initialProps: { lastPlayedCfi: 'cfi1', isPlaying: true }
            }
        );

        // Initial render (even if playing, initial state is applied?
        // Actually, logic says: "Update when data changes, BUT only if not playing".
        // But the initial state setting in `updateDisplayedRanges` is called in the first useEffect [bookId, currentCfi]
        // because `updateDisplayedRanges` is in its dependency array.
        // Wait, the hook has two effects.
        // 1. [bookId, currentCfi, updateDisplayedRanges] -> Calls updateDisplayedRanges()
        // 2. [lastPlayedCfi, isPlaying, updateDisplayedRanges] -> Calls updateDisplayedRanges() IF !isPlaying.

        // Initial render: bookId is set. Effect 1 runs. updateDisplayedRanges sets state.
        expect(mockRendition.annotations.add).toHaveBeenCalledWith('highlight', 'cfi1', expect.anything(), null, expect.anything(), expect.anything());
        mockRendition.annotations.add.mockClear();
        mockRendition.annotations.remove.mockClear();

        // Update lastPlayedCfi while playing
        rerender({ lastPlayedCfi: 'cfi2', isPlaying: true });

        // Should NOT update (no remove, no add) because Effect 2 blocks it.
        // And Effect 1 only runs on bookId/currentCfi change.
        expect(mockRendition.annotations.remove).not.toHaveBeenCalled();
        expect(mockRendition.annotations.add).not.toHaveBeenCalled();

        // Now stop playing
        rerender({ lastPlayedCfi: 'cfi2', isPlaying: false });

        // Should update now:
        // Cleanup old cfi1
        expect(mockRendition.annotations.remove).toHaveBeenCalledWith('cfi1', 'highlight');
        // Add new cfi2
        expect(mockRendition.annotations.add).toHaveBeenCalledWith('highlight', 'cfi2', expect.anything(), null, expect.anything(), expect.anything());
    });

    it('removes annotations on unmount', () => {
        const { unmount } = renderHook(() => useHistoryHighlights(
            mockRendition,
            true,
            'book1',
            'currentCfi',
            false,
            'cfi1'
        ));

        unmount();
        expect(mockRendition.annotations.remove).toHaveBeenCalledWith('cfi1', 'highlight');
    });
});
