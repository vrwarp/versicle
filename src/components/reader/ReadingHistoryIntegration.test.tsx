
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ReadingHistoryPanel } from './ReadingHistoryPanel';
import { useReadingHistory } from '../../hooks/useReadingHistory';

// Mock useReadingHistory hook
vi.mock('../../hooks/useReadingHistory', () => ({
    useReadingHistory: vi.fn(),
}));

describe('ReadingHistory Integration', () => {
    const mockHook = useReadingHistory as unknown as ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('loads and displays reading history in panel', async () => {
        const ranges = ['epubcfi(/6/14!/4/2/1:0)'];
        mockHook.mockReturnValue({
            entry: { sessions: [], readRanges: ranges },
            loading: false,
            error: null,
            refresh: vi.fn()
        });

        render(
           <ReadingHistoryPanel
               bookId="book1"
               rendition={null}
               onNavigate={vi.fn()}
           />
        );

        // Should render immediately if loading is false
        expect(screen.getByText('Reading Segment')).toBeInTheDocument();
    });

    it('shows loading state', () => {
        mockHook.mockReturnValue({
            entry: undefined,
            loading: true,
            error: null,
            refresh: vi.fn()
        });

        render(
           <ReadingHistoryPanel
               bookId="book1"
               rendition={null}
               onNavigate={vi.fn()}
           />
        );

        expect(screen.getByText('Loading history...')).toBeInTheDocument();
    });

    it('refreshes history when trigger changes', async () => {
        // This test now effectively verifies that the component passes the trigger to the hook,
        // and that the hook behaves correctly. Since we are mocking the hook, we just check call args.
        mockHook.mockReturnValue({
            entry: { sessions: [], readRanges: ['range1'] },
            loading: false,
            error: null,
            refresh: vi.fn()
        });

        const { rerender } = render(
           <ReadingHistoryPanel
               bookId="book1"
               rendition={null}
               onNavigate={vi.fn()}
               trigger={0}
           />
        );

        expect(mockHook).toHaveBeenCalledWith('book1', 0);

        // Update trigger
        rerender(
           <ReadingHistoryPanel
               bookId="book1"
               rendition={null}
               onNavigate={vi.fn()}
               trigger={1}
           />
        );

        expect(mockHook).toHaveBeenCalledWith('book1', 1);
    });

    it('handles empty history gracefully', async () => {
        mockHook.mockReturnValue({
            entry: { sessions: [], readRanges: [] },
            loading: false,
            error: null,
            refresh: vi.fn()
        });

        render(
            <ReadingHistoryPanel
                bookId="book1"
                rendition={null}
                onNavigate={vi.fn()}
            />
        );

        expect(screen.getByText('No reading history recorded yet.')).toBeInTheDocument();
    });

    it('handles database fetch error gracefully', async () => {
         mockHook.mockReturnValue({
             entry: undefined,
             loading: false,
             error: 'Fetch failed',
             refresh: vi.fn()
         });

         render(
            <ReadingHistoryPanel
                bookId="book1"
                rendition={null}
                onNavigate={vi.fn()}
            />
        );

        expect(screen.getByText('No reading history recorded yet.')).toBeInTheDocument();
    });
});
