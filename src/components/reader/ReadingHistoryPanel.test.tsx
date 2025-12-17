/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { ReadingHistoryPanel } from './ReadingHistoryPanel';
import { dbService } from '../../db/DBService';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock DBService
vi.mock('../../db/DBService', () => ({
  dbService: {
    getReadingHistory: vi.fn()
  }
}));

describe('ReadingHistoryPanel', () => {
  const mockBook = {
    spine: {
      get: vi.fn(),
      items: [] as any[]
    },
    navigation: {
      get: vi.fn()
    },
    locations: {
        length: () => 100,
        percentageFromCfi: vi.fn().mockReturnValue(0.5)
    }
  };

  const mockRendition = {
    book: mockBook,
    display: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders "Loading history..." initially', () => {
    (dbService.getReadingHistory as any).mockResolvedValue([]);
    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);
    expect(screen.getByText('Loading history...')).toBeInTheDocument();
  });

  it('renders "No reading history recorded yet." when history is empty', async () => {
    (dbService.getReadingHistory as any).mockResolvedValue([]);
    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('No reading history recorded yet.')).toBeInTheDocument();
    });
  });

  it('correctly displays chapter titles based on book.spine.get', async () => {
    const historyRanges = ['epubcfi(/6/14!/4/2/1:0)'];
    (dbService.getReadingHistory as any).mockResolvedValue(historyRanges);

    // Mock spine.get to return a section
    const mockSection = { href: 'chapter1.html', index: 0 };
    mockBook.spine.get.mockReturnValue(mockSection);
    // Mock navigation.get to return a label
    mockBook.navigation.get.mockReturnValue({ label: 'Chapter One' });

    // Mock spine items for index fallback if needed (not needed if index is present)
    mockBook.spine.items = [mockSection];

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Chapter One')).toBeInTheDocument();
    });
  });

  it('falls back to "Chapter X" if TOC label is missing', async () => {
    const historyRanges = ['epubcfi(/6/16!/4/2/1:0)'];
    (dbService.getReadingHistory as any).mockResolvedValue(historyRanges);

    // Mock spine.get to return a section
    const mockSection = { href: 'chapter2.html', index: 1 };
    mockBook.spine.get.mockReturnValue(mockSection);
    // Mock navigation.get to return null
    mockBook.navigation.get.mockReturnValue(null);

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Chapter 2')).toBeInTheDocument();
    });
  });

  it('handles errors in book.spine.get gracefully', async () => {
    const historyRanges = ['epubcfi(/6/18!/4/2/1:0)'];
    (dbService.getReadingHistory as any).mockResolvedValue(historyRanges);

    mockBook.spine.get.mockImplementation(() => {
        throw new Error("Invalid CFI");
    });

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText(/Segment at/)).toBeInTheDocument();
    });
  });

  it('calls onNavigate when an item is clicked', async () => {
      const historyRanges = ['epubcfi(/6/14!/4/2/1:0)'];
      (dbService.getReadingHistory as any).mockResolvedValue(historyRanges);

      const mockSection = { href: 'chapter1.html', index: 0 };
      mockBook.spine.get.mockReturnValue(mockSection);
      mockBook.navigation.get.mockReturnValue({ label: 'Chapter One' });

      const onNavigate = vi.fn();
      render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={onNavigate} />);

      await waitFor(() => {
          expect(screen.getByText('Chapter One')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Chapter One'));
      expect(onNavigate).toHaveBeenCalledWith('epubcfi(/6/14!/4/2/1:0)');
  });
});
