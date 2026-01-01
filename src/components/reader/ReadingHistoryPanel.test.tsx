/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { ReadingHistoryPanel } from './ReadingHistoryPanel';
import { dbService } from '../../db/DBService';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock DBService
vi.mock('../../db/DBService', () => ({
  dbService: {
    getReadingHistoryEntry: vi.fn()
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

  // This test expects initial loading state.
  // We avoid wrapping render in act(async) here because we want to assert the state *before* the async effect resolves.
  // However, React 18/19 might batch updates.
  // To test initial state, we just render and assert. The useEffect is async.
  it('renders "Loading history..." initially', async () => {
    // Delay resolution to allow assertion of loading state
    (dbService.getReadingHistoryEntry as any).mockReturnValue(new Promise(() => {}));

    // We intentionally do NOT await this act, or use a sync act, because we want to catch the loading state
    // but React Testing Library requires act for effects.
    // Actually, simply rendering without waiting for the promise should show the initial state.

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    expect(screen.getByText('Loading history...')).toBeInTheDocument();
  });

  it('renders "No reading history recorded yet." when history is empty', async () => {
    (dbService.getReadingHistoryEntry as any).mockResolvedValue({ sessions: [], readRanges: [] });
    await act(async () => {
      render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);
    });

    await waitFor(() => {
      expect(screen.getByText('No reading history recorded yet.')).toBeInTheDocument();
    });
  });

  it('correctly displays chapter titles based on sessions', async () => {
    const sessions = [{ cfiRange: 'epubcfi(/6/14!/4/2/1:0)', timestamp: Date.now() }];
    (dbService.getReadingHistoryEntry as any).mockResolvedValue({ sessions, readRanges: [] });

    // Mock spine.get to return a section
    const mockSection = { href: 'chapter1.html', index: 0 };
    mockBook.spine.get.mockReturnValue(mockSection);
    // Mock navigation.get to return a label
    mockBook.navigation.get.mockReturnValue({ label: 'Chapter One' });

    // Mock spine items for index fallback if needed (not needed if index is present)
    mockBook.spine.items = [mockSection];

    await act(async () => {
      render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Chapter One')).toBeInTheDocument();
    });
  });

  it('falls back to "Chapter X" if TOC label is missing', async () => {
    const sessions = [{ cfiRange: 'epubcfi(/6/16!/4/2/1:0)', timestamp: Date.now() }];
    (dbService.getReadingHistoryEntry as any).mockResolvedValue({ sessions, readRanges: [] });

    // Mock spine.get to return a section
    const mockSection = { href: 'chapter2.html', index: 1 };
    mockBook.spine.get.mockReturnValue(mockSection);
    // Mock navigation.get to return null
    mockBook.navigation.get.mockReturnValue(null);

    await act(async () => {
      render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Chapter 2')).toBeInTheDocument();
    });
  });

  it('falls back to legacy readRanges if sessions are missing', async () => {
    const readRanges = ['epubcfi(/6/16!/4/2/1:0)'];
    (dbService.getReadingHistoryEntry as any).mockResolvedValue({ sessions: [], readRanges });

    const mockSection = { href: 'chapter2.html', index: 1 };
    mockBook.spine.get.mockReturnValue(mockSection);
    mockBook.navigation.get.mockReturnValue({ label: 'Legacy Chapter' });

    await act(async () => {
      render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);
    });

    await waitFor(() => {
      expect(screen.getByText('Legacy Chapter')).toBeInTheDocument();
    });
  });

  it('handles errors in book.spine.get gracefully', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sessions = [{ cfiRange: 'epubcfi(/6/18!/4/2/1:0)', timestamp: Date.now() }];
    (dbService.getReadingHistoryEntry as any).mockResolvedValue({ sessions, readRanges: [] });

    mockBook.spine.get.mockImplementation(() => {
        throw new Error("Invalid CFI");
    });

    await act(async () => {
      render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);
    });

    await waitFor(() => {
      expect(screen.getByText(/Segment at/)).toBeInTheDocument();
    });
    consoleSpy.mockRestore();
  });

  it('calls onNavigate with correct CFI when an item is clicked', async () => {
      const cfi = 'epubcfi(/6/14!/4/2/1:0)';
      const sessions = [{ cfiRange: cfi, timestamp: Date.now() }];
      (dbService.getReadingHistoryEntry as any).mockResolvedValue({ sessions, readRanges: [] });

      const mockSection = { href: 'chapter1.html', index: 0 };
      mockBook.spine.get.mockReturnValue(mockSection);
      mockBook.navigation.get.mockReturnValue({ label: 'Chapter One' });

      const onNavigate = vi.fn();
      await act(async () => {
        render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={onNavigate} />);
      });

      await waitFor(() => {
          expect(screen.getByText('Chapter One')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Chapter One'));
      // Since it's not a range, it falls back to the original CFI
      expect(onNavigate).toHaveBeenCalledWith(cfi);
  });

  it('navigates to the end of the session range', async () => {
      // proper range
      const rangeCfi = 'epubcfi(/6/14!/4/2,/1:0,/1:10)';
      // The component logic extracts the full end of the range
      const expectedEnd = 'epubcfi(/6/14!/4/2/1:10)';

      const sessions = [{ cfiRange: rangeCfi, timestamp: Date.now() }];
      (dbService.getReadingHistoryEntry as any).mockResolvedValue({ sessions, readRanges: [] });

      const mockSection = { href: 'chapter1.html', index: 0 };
      mockBook.spine.get.mockReturnValue(mockSection);
      mockBook.navigation.get.mockReturnValue({ label: 'Chapter One' });

      const onNavigate = vi.fn();
      await act(async () => {
        render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={onNavigate} />);
      });

      await waitFor(() => {
          expect(screen.getByText('Chapter One')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Chapter One'));
      expect(onNavigate).toHaveBeenCalledWith(expectedEnd);
  });
});
