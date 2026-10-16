import { renderHook } from '@testing-library/react';
import { useHistoryHighlights } from '../useHistoryHighlights';
import { HighlightLayerManager } from '@domains/reader/engine/HighlightLayerManager';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock logger
vi.mock('@lib/logger', () => ({
    createLogger: () => ({
        warn: vi.fn(),
    })
}));

// The hook drives the HighlightLayerManager's 'history' layer rather than
// touching rendition.annotations directly. The manager is constructed over
// the mock rendition, so the assertions below pin the epub.js call shapes.
describe('useHistoryHighlights', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mockRendition: any;
    let manager: HighlightLayerManager;

    beforeEach(() => {
        mockRendition = {
            annotations: {
                add: vi.fn(),
                remove: vi.fn(),
            }
        };
        manager = new HighlightLayerManager(mockRendition);
    });

    it('adds annotation for lastPlayedCfi', () => {
        const lastPlayedCfi = 'cfi1';
        renderHook(() => useHistoryHighlights(
            manager,
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
            manager,
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
                manager,
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
                manager,
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

        // Initial render: displayedRanges is seeded from lastPlayedCfi even
        // while playing, so the highlight is applied on mount.
        expect(mockRendition.annotations.add).toHaveBeenCalledWith('highlight', 'cfi1', expect.anything(), null, expect.anything(), expect.anything());
        mockRendition.annotations.add.mockClear();
        mockRendition.annotations.remove.mockClear();

        // Update lastPlayedCfi while playing
        rerender({ lastPlayedCfi: 'cfi2', isPlaying: true });

        // Should NOT update (no remove, no add): lastPlayedCfi changed while
        // playing and the page (bookId/currentCfi) did not.
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
            manager,
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
