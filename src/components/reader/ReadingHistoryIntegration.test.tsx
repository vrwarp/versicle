
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ReadingHistoryPanel } from './ReadingHistoryPanel';
import { dbService } from '../../db/DBService';

// Mock logger
vi.mock('../../lib/logger', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }))
}));

// Mock DBService
vi.mock('../../db/DBService', () => ({
    dbService: {
        getReadingHistory: vi.fn(),
        getJourneyEvents: vi.fn(),
        updateReadingHistory: vi.fn().mockResolvedValue(undefined),
        saveProgress: vi.fn(),
        getBook: vi.fn(),
    }
}));

describe('ReadingHistory Integration', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    it('loads and displays reading history in panel', async () => {
        const events = [{ cfiRange: 'epubcfi(/6/14!/4/2/1:0)', timestamp: Date.now(), type: 'page' }];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getJourneyEvents as any).mockResolvedValue(events);

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
    });

    it('refreshes history when trigger changes', async () => {
        const initialEvents = [{ cfiRange: 'epubcfi(/6/14!/4/2/1:0)', timestamp: Date.now(), type: 'page' }];
        const updatedEvents = [
            { cfiRange: 'epubcfi(/6/14!/4/2/1:0)', timestamp: Date.now(), type: 'page' },
            { cfiRange: 'epubcfi(/6/14!/4/2/1:10)', timestamp: Date.now(), type: 'page' }
        ];

        // First call returns initial
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getJourneyEvents as any)
            .mockResolvedValueOnce(initialEvents)
            .mockResolvedValueOnce(updatedEvents);

        const { rerender } = render(
            <ReadingHistoryPanel
                bookId="book1"
                rendition={null}
                onNavigate={vi.fn()}
                trigger={0}
            />
        );

        await waitFor(() => {
            expect(screen.getAllByText('Reading Segment')).toHaveLength(1);
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
            expect(screen.getAllByText('Reading Segment')).toHaveLength(2);
        });

        expect(dbService.getJourneyEvents).toHaveBeenCalledTimes(2);
    });

    it('handles empty history gracefully', async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getJourneyEvents as any).mockResolvedValue([]);

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
        (dbService.getJourneyEvents as any).mockRejectedValue(new Error('Fetch failed'));

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
    });

    it('debounces rapid trigger updates (functionally via effect)', async () => {
        // React useEffect naturally handles rapid updates by re-running.
        // We can verify that rapid props changes trigger requests.
        // Note: If we want real debounce, we'd need to add it to component.
        // Current implementation does NOT debounce the effect, so it should call twice.

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (dbService.getJourneyEvents as any).mockResolvedValue([{ cfiRange: 'range1', timestamp: Date.now(), type: 'page' }]);

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
            expect(dbService.getJourneyEvents).toHaveBeenCalledTimes(3);
        });
    });
});
