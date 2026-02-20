import React from 'react';
import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ReadingHistoryPanel } from './ReadingHistoryPanel';
import type { ReadingSession } from '../../types/db';

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
        const sessions: ReadingSession[] = [{
            cfiRange: 'epubcfi(/6/14!/4/2/1:0)',
            startTime: Date.now(),
            endTime: Date.now(),
            type: 'page',
            label: 'Chapter One'
        }];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useBookProgress as any).mockReturnValue({
            completedRanges: ['epubcfi(/6/14!/4/2/1:0)'],
            readingSessions: sessions
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
        expect(screen.getByText('Chapter One')).toBeInTheDocument();
    });

    it('updates when readingSessions changes', () => {
        const sessions1: ReadingSession[] = [{
            cfiRange: 'epubcfi(/6/14!/4/2/1:0)',
            startTime: Date.now(),
            endTime: Date.now(),
            type: 'page',
            label: 'Chapter One'
        }];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useBookProgress as any).mockReturnValue({
            completedRanges: ['epubcfi(/6/14!/4/2/1:0)'],
            readingSessions: sessions1
        });

        const { rerender } = render(
            <ReadingHistoryPanel
                bookId="book1"
                rendition={null}
                onNavigate={vi.fn()}
            />
        );

        expect(screen.getAllByRole('button')).toHaveLength(1);

        // Update mock to return more sessions (different section)
        const sessions2: ReadingSession[] = [
            ...sessions1,
            {
                cfiRange: 'epubcfi(/6/14!/4/2/1:10)',
                startTime: Date.now(),
                endTime: Date.now(),
                type: 'tts',
                label: 'Chapter Two'
            }
        ];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useBookProgress as any).mockReturnValue({
            completedRanges: [
                'epubcfi(/6/14!/4/2/1:0)',
                'epubcfi(/6/14!/4/2/1:10)'
            ],
            readingSessions: sessions2
        });

        rerender(
            <ReadingHistoryPanel
                bookId="book1"
                rendition={null}
                onNavigate={vi.fn()}
            />
        );

        expect(screen.getAllByRole('button')).toHaveLength(2);
    });

    it('handles empty readingSessions gracefully', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (useBookProgress as any).mockReturnValue({
            completedRanges: [],
            readingSessions: []
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
            completedRanges: ['epubcfi(/6/14!/4/2/1:0)'],
            readingSessions: [{
                cfiRange: 'epubcfi(/6/14!/4/2/1:0)',
                startTime: Date.now(),
                endTime: Date.now(),
                type: 'page',
                label: 'Test'
            }]
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
