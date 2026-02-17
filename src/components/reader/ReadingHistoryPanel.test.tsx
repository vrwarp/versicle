/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadingHistoryPanel } from './ReadingHistoryPanel';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock the Yjs store hook
vi.mock('../../store/useReadingStateStore', () => ({
  useBookProgress: vi.fn(),
  useBookHistory: vi.fn()
}));

import { useBookProgress, useBookHistory } from '../../store/useReadingStateStore';

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

  it('renders "No reading history recorded yet." when completedRanges is empty', () => {
    (useBookProgress as any).mockReturnValue({ completedRanges: [] });

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    expect(screen.getByText('No reading history recorded yet.')).toBeInTheDocument();
  });

  it('renders "No reading history recorded yet." when progress is undefined', () => {
    (useBookProgress as any).mockReturnValue(undefined);

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    expect(screen.getByText('No reading history recorded yet.')).toBeInTheDocument();
  });

  it('correctly displays chapter titles based on completedRanges', () => {
    (useBookProgress as any).mockReturnValue({
      completedRanges: ['epubcfi(/6/14!/4/2/1:0)']
    });

    // Mock spine.get to return a section
    const mockSection = { href: 'chapter1.html', index: 0 };
    mockBook.spine.get.mockReturnValue(mockSection);
    // Mock navigation.get to return a label
    mockBook.navigation.get.mockReturnValue({ label: 'Chapter One' });
    mockBook.spine.items = [mockSection];

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    expect(screen.getByText('Chapter One')).toBeInTheDocument();
  });

  it('falls back to "Chapter X" if TOC label is missing', () => {
    (useBookProgress as any).mockReturnValue({
      completedRanges: ['epubcfi(/6/16!/4/2/1:0)']
    });

    // Mock spine.get to return a section
    const mockSection = { href: 'chapter2.html', index: 1 };
    mockBook.spine.get.mockReturnValue(mockSection);
    // Mock navigation.get to return null
    mockBook.navigation.get.mockReturnValue(null);

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    expect(screen.getByText('Chapter 2')).toBeInTheDocument();
  });

  it('handles errors in book.spine.get gracefully', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => { });
    (useBookProgress as any).mockReturnValue({
      completedRanges: ['epubcfi(/6/18!/4/2/1:0)']
    });

    mockBook.spine.get.mockImplementation(() => {
      throw new Error("Invalid CFI");
    });

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    expect(screen.getByText(/Segment at/)).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  it('calls onNavigate with correct CFI when an item is clicked', () => {
    const cfi = 'epubcfi(/6/14!/4/2/1:0)';
    (useBookProgress as any).mockReturnValue({
      completedRanges: [cfi]
    });

    const mockSection = { href: 'chapter1.html', index: 0 };
    mockBook.spine.get.mockReturnValue(mockSection);
    mockBook.navigation.get.mockReturnValue({ label: 'Chapter One' });

    const onNavigate = vi.fn();
    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText('Chapter One'));
    expect(onNavigate).toHaveBeenCalledWith(cfi);
  });

  it('navigates to the start of the range (using exact range)', () => {
    const rangeCfi = 'epubcfi(/6/14!/4/2,/1:0,/1:10)';
    (useBookProgress as any).mockReturnValue({
      completedRanges: [rangeCfi]
    });

    const mockSection = { href: 'chapter1.html', index: 0 };
    mockBook.spine.get.mockReturnValue(mockSection);
    mockBook.navigation.get.mockReturnValue({ label: 'Chapter One' });

    const onNavigate = vi.fn();
    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText('Chapter One'));
    expect(onNavigate).toHaveBeenCalledWith(rangeCfi);
  });

  it('displays multiple history items', () => {
    (useBookProgress as any).mockReturnValue({
      completedRanges: ['cfi1', 'cfi2', 'cfi3']
    });

    mockBook.spine.get.mockReturnValue(null);
    mockBook.locations.percentageFromCfi.mockReturnValue(0.5);

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    const items = screen.getAllByRole('button');
    expect(items).toHaveLength(3);
  });
});
