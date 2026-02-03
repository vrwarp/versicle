import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ReadingHistoryPanel } from './ReadingHistoryPanel';

// Mock the Yjs store hook
vi.mock('../../store/useReadingStateStore', () => ({
    useBookProgress: vi.fn()
}));

import { useBookProgress } from '../../store/useReadingStateStore';

describe('ReadingHistory Integration', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('loads and displays reading history from Yjs store', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useBookProgress as any).mockReturnValue({
            completedRanges: ['epubcfi(/6/14!/4/2/1:0)']
        });

        render(
            <ReadingHistoryPanel
                bookId="book1"
                rendition={null}
                onNavigate={vi.fn()}
            />
        );

        // No loading state - component renders synchronously now
        expect(screen.queryByText('Loading history...')).not.toBeInTheDocument();
        expect(screen.getByText('Reading Segment')).toBeInTheDocument();
    });

    it('updates when completedRanges changes', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useBookProgress as any).mockReturnValue({
            completedRanges: ['epubcfi(/6/14!/4/2/1:0)']
        });

        const { rerender } = render(
            <ReadingHistoryPanel
                bookId="book1"
                rendition={null}
                onNavigate={vi.fn()}
            />
        );

        expect(screen.getAllByText('Reading Segment')).toHaveLength(1);

        // Update mock to return more ranges
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useBookProgress as any).mockReturnValue({
            completedRanges: [
                'epubcfi(/6/14!/4/2/1:0)',
                'epubcfi(/6/14!/4/2/1:10)'
            ]
        });

        rerender(
            <ReadingHistoryPanel
                bookId="book1"
                rendition={null}
                onNavigate={vi.fn()}
            />
        );

        expect(screen.getAllByText('Reading Segment')).toHaveLength(2);
    });

    it('handles empty completedRanges gracefully', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useBookProgress as any).mockReturnValue({
            completedRanges: []
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

    it('handles undefined progress gracefully', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useBookProgress as any).mockReturnValue(undefined);

        render(
            <ReadingHistoryPanel
                bookId="book1"
                rendition={null}
                onNavigate={vi.fn()}
            />
        );

        expect(screen.getByText('No reading history recorded yet.')).toBeInTheDocument();
    });

    it('reacts to bookId prop changes', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useBookProgress as any).mockReturnValue({
            completedRanges: ['epubcfi(/6/14!/4/2/1:0)']
        });

        const { rerender } = render(
            <ReadingHistoryPanel
                bookId="book1"
                rendition={null}
                onNavigate={vi.fn()}
            />
        );

        expect(useBookProgress).toHaveBeenCalledWith('book1');

        rerender(
            <ReadingHistoryPanel
                bookId="book2"
                rendition={null}
                onNavigate={vi.fn()}
            />
        );

        expect(useBookProgress).toHaveBeenCalledWith('book2');
    });
});
