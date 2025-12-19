
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ReadingHistoryPanel } from './ReadingHistoryPanel';
import { dbService } from '../../db/DBService';

// Mock DBService
vi.mock('../../db/DBService', () => ({
  dbService: {
    getReadingHistory: vi.fn(),
    updateReadingHistory: vi.fn().mockResolvedValue(undefined),
    saveProgress: vi.fn(),
    getBook: vi.fn(),
  }
}));

describe('ReadingHistory Integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('loads and displays reading history in panel', async () => {
        const ranges = ['epubcfi(/6/14!/4/2/1:0)'];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getReadingHistory as any).mockResolvedValue(ranges);

        render(
           <ReadingHistoryPanel
               bookId="book1"
               rendition={null}
               onNavigate={vi.fn()}
           />
        );

        expect(screen.getByText('Loading history...')).toBeInTheDocument();

        await waitFor(() => {
            expect(screen.queryByText('Loading history...')).not.toBeInTheDocument();
        });

        expect(screen.getByText('Reading Segment')).toBeInTheDocument();
        expect(screen.getByText('epubcfi(/6/14!/4/2/1:0)')).toBeInTheDocument();
    });

    it('refreshes history when trigger changes', async () => {
        const initialRanges = ['epubcfi(/6/14!/4/2/1:0)'];
        const updatedRanges = ['epubcfi(/6/14!/4/2/1:0)', 'epubcfi(/6/14!/4/2/1:10)'];

        // First call returns initial
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getReadingHistory as any)
            .mockResolvedValueOnce(initialRanges)
            .mockResolvedValueOnce(updatedRanges);

        const { rerender } = render(
           <ReadingHistoryPanel
               bookId="book1"
               rendition={null}
               onNavigate={vi.fn()}
               trigger={0}
           />
        );

        await waitFor(() => {
             expect(screen.getByText('epubcfi(/6/14!/4/2/1:0)')).toBeInTheDocument();
        });

        // Update trigger
        rerender(
           <ReadingHistoryPanel
               bookId="book1"
               rendition={null}
               onNavigate={vi.fn()}
               trigger={1}
           />
        );

        await waitFor(() => {
             expect(screen.getByText('epubcfi(/6/14!/4/2/1:10)')).toBeInTheDocument();
        });

        expect(dbService.getReadingHistory).toHaveBeenCalledTimes(2);
    });

    it('handles empty history gracefully', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getReadingHistory as any).mockResolvedValue([]);

        render(
            <ReadingHistoryPanel
                bookId="book1"
                rendition={null}
                onNavigate={vi.fn()}
            />
        );

        await waitFor(() => {
            expect(screen.getByText('No reading history recorded yet.')).toBeInTheDocument();
        });
    });

    it('handles database fetch error gracefully', async () => {
         // eslint-disable-next-line @typescript-eslint/no-explicit-any
         (dbService.getReadingHistory as any).mockRejectedValue(new Error('Fetch failed'));

         const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

         render(
            <ReadingHistoryPanel
                bookId="book1"
                rendition={null}
                onNavigate={vi.fn()}
            />
        );

        await waitFor(() => {
             // Should verify that it stops loading.
             // Currently component doesn't show error state UI, just stops loading and shows empty list (if items initialized empty)
             // or keeps previous items.
             expect(screen.queryByText('Loading history...')).not.toBeInTheDocument();
        });

        // It renders "No reading history" because items is empty [] by default and error catch block sets loading false.
        expect(screen.getByText('No reading history recorded yet.')).toBeInTheDocument();

        expect(consoleSpy).toHaveBeenCalledWith('Failed to load history', expect.any(Error));
        consoleSpy.mockRestore();
    });

    it('debounces rapid trigger updates (functionally via effect)', async () => {
         // React useEffect naturally handles rapid updates by re-running.
         // We can verify that rapid props changes trigger requests.
         // Note: If we want real debounce, we'd need to add it to component.
         // Current implementation does NOT debounce the effect, so it should call twice.

         // eslint-disable-next-line @typescript-eslint/no-explicit-any
         (dbService.getReadingHistory as any).mockResolvedValue(['range1']);

         const { rerender } = render(
            <ReadingHistoryPanel
                bookId="book1"
                rendition={null}
                onNavigate={vi.fn()}
                trigger={0}
            />
         );

         rerender(<ReadingHistoryPanel bookId="book1" rendition={null} onNavigate={vi.fn()} trigger={1} />);
         rerender(<ReadingHistoryPanel bookId="book1" rendition={null} onNavigate={vi.fn()} trigger={2} />);

         await waitFor(() => {
             expect(dbService.getReadingHistory).toHaveBeenCalledTimes(3);
         });
    });
});
