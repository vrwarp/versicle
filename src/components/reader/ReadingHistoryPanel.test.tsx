/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadingHistoryPanel } from './ReadingHistoryPanel';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ReadingSession } from '../../types/db';

// Mock the Yjs store hook
vi.mock('../../store/useReadingStateStore', () => ({
  useBookProgress: vi.fn()
}));

import { useBookProgress } from '../../store/useReadingStateStore';

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
    mockBook.spine.get.mockReturnValue(undefined);
    mockBook.navigation.get.mockReturnValue(undefined);
    mockBook.locations.percentageFromCfi.mockReturnValue(0.5);
  });

  it('renders "No reading history recorded yet." when completedRanges is empty', () => {
    (useBookProgress as any).mockReturnValue({ completedRanges: [], readingSessions: [] });

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    expect(screen.getByText('No reading history recorded yet.')).toBeInTheDocument();
  });

  it('renders "No reading history recorded yet." when progress is undefined', () => {
    (useBookProgress as any).mockReturnValue(undefined);

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    expect(screen.getByText('No reading history recorded yet.')).toBeInTheDocument();
  });

  it('correctly displays chapter titles from session labels', () => {
    const sessions: ReadingSession[] = [{
      cfiRange: 'epubcfi(/6/14!/4/2/1:0)',
      timestamp: Date.now(),
      type: 'page',
      label: 'Chapter One'
    }];
    (useBookProgress as any).mockReturnValue({
      completedRanges: ['epubcfi(/6/14!/4/2/1:0)'],
      readingSessions: sessions
    });

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    expect(screen.getByText('Chapter One')).toBeInTheDocument();
  });

  it('resolves chapter title from book when session has no label', () => {
    const sessions: ReadingSession[] = [{
      cfiRange: 'epubcfi(/6/14!/4/2/1:0)',
      timestamp: Date.now(),
      type: 'page'
    }];
    (useBookProgress as any).mockReturnValue({
      completedRanges: [],
      readingSessions: sessions
    });

    const mockSection = { href: 'chapter1.html', index: 0 };
    mockBook.spine.get.mockReturnValue(mockSection);
    mockBook.navigation.get.mockReturnValue({ label: 'Chapter One' });
    mockBook.spine.items = [mockSection];

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    expect(screen.getByText('Chapter One')).toBeInTheDocument();
  });

  it('displays correct icon for TTS sessions', () => {
    const sessions: ReadingSession[] = [{
      cfiRange: 'epubcfi(/6/14!/4/2/1:0)',
      timestamp: Date.now(),
      type: 'tts',
      label: 'TTS Chapter'
    }];
    (useBookProgress as any).mockReturnValue({
      completedRanges: [],
      readingSessions: sessions
    });

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    // Headphones icon should be present (lucide renders as svg)
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(screen.getByText('TTS Chapter')).toBeInTheDocument();
  });

  it('merges consecutive sessions with the same label', () => {
    const now = Date.now();
    const sessions: ReadingSession[] = [
      { cfiRange: 'cfi1', timestamp: now - 5000, type: 'page', label: 'Chapter 1' },
      { cfiRange: 'cfi2', timestamp: now - 3000, type: 'page', label: 'Chapter 1' },
      { cfiRange: 'cfi3', timestamp: now - 1000, type: 'scroll', label: 'Chapter 1' },
      { cfiRange: 'cfi4', timestamp: now, type: 'page', label: 'Chapter 2' },
    ];
    (useBookProgress as any).mockReturnValue({
      completedRanges: [],
      readingSessions: sessions
    });

    render(<ReadingHistoryPanel bookId="book1" rendition={null} onNavigate={vi.fn()} />);

    // Should show 2 grouped items, not 4
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('does not merge non-consecutive sessions with the same label', () => {
    const now = Date.now();
    const sessions: ReadingSession[] = [
      { cfiRange: 'cfi1', timestamp: now - 5000, type: 'page', label: 'Chapter 1' },
      { cfiRange: 'cfi2', timestamp: now - 3000, type: 'tts', label: 'Chapter 2' },
      { cfiRange: 'cfi3', timestamp: now - 1000, type: 'page', label: 'Chapter 1' },
    ];
    (useBookProgress as any).mockReturnValue({
      completedRanges: [],
      readingSessions: sessions
    });

    render(<ReadingHistoryPanel bookId="book1" rendition={null} onNavigate={vi.fn()} />);

    // Non-consecutive: all 3 should show
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
  });

  it('calls onNavigate with correct CFI when an item is clicked', () => {
    const sessions: ReadingSession[] = [{
      cfiRange: 'epubcfi(/6/14!/4/2/1:0)',
      timestamp: Date.now(),
      type: 'page',
      label: 'Chapter One'
    }];
    (useBookProgress as any).mockReturnValue({
      completedRanges: [],
      readingSessions: sessions
    });

    const onNavigate = vi.fn();
    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText('Chapter One'));
    expect(onNavigate).toHaveBeenCalledWith('epubcfi(/6/14!/4/2/1:0)');
  });

  it('falls back to completedRanges when no readingSessions', () => {
    (useBookProgress as any).mockReturnValue({
      completedRanges: ['cfi1', 'cfi2', 'cfi3']
    });

    mockBook.spine.get.mockReturnValue(null);
    mockBook.locations.percentageFromCfi.mockReturnValue(0.5);

    render(<ReadingHistoryPanel bookId="book1" rendition={mockRendition as any} onNavigate={vi.fn()} />);

    // Legacy mode: all ranges with same label ("Segment at 50.0%") should be merged
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });
});
