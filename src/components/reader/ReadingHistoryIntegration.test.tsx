
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
});
