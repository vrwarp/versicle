/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, screen, fireEvent } from '@testing-library/react';
import { ReadingHistoryPanel } from '../ReadingHistoryPanel';
import { EpubJsEngine } from '@domains/reader/engine/EpubJsEngine';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { ReadingSession } from '~types/user-data';

// Mock the Yjs store hook
vi.mock('@store/useReadingStateStore', () => ({
  useBookProgress: vi.fn()
}));

import { useBookProgress } from '@store/useReadingStateStore';

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

  // Engine port over the same book double: the nav-label resolution the
  // panel used to own moved verbatim into EpubJsEngine.getNavLabel, so the
  // suite now pins it THROUGH the engine (same assertions as pre-port).
  const makeEngine = () =>
    new EpubJsEngine({
      book: mockBook as any,
      rendition: {
        on: vi.fn(),
        off: vi.fn(),
        display: vi.fn(),
        hooks: { content: { register: vi.fn() } },
        annotations: { add: vi.fn(), remove: vi.fn() },
      } as any,
      container: document.createElement('div'),
      locationsReady: Promise.resolve(),
    });
  let mockEngine = makeEngine();

  beforeEach(() => {
    vi.clearAllMocks();
    mockBook.spine.get.mockReturnValue(undefined);
    mockBook.navigation.get.mockReturnValue(undefined);
    mockBook.locations.percentageFromCfi.mockReturnValue(0.5);
    mockEngine = makeEngine();
  });

  it('renders "No reading history recorded yet." when completedRanges is empty', () => {
    (useBookProgress as any).mockReturnValue({ completedRanges: [], readingSessions: [] });

    render(<ReadingHistoryPanel bookId="book1" engine={mockEngine} onNavigate={vi.fn()} />);

    expect(screen.getByText('No reading history recorded yet.')).toBeInTheDocument();
  });

  it('renders "No reading history recorded yet." when progress is undefined', () => {
    (useBookProgress as any).mockReturnValue(undefined);

    render(<ReadingHistoryPanel bookId="book1" engine={mockEngine} onNavigate={vi.fn()} />);

    expect(screen.getByText('No reading history recorded yet.')).toBeInTheDocument();
  });

  it('correctly displays chapter titles from session labels', () => {
    const sessions: ReadingSession[] = [{
      cfiRange: 'epubcfi(/6/14!/4/2/1:0)',
      startTime: Date.now(),
      endTime: Date.now(),
      type: 'page',
      label: 'Chapter One'
    }];
    (useBookProgress as any).mockReturnValue({
      completedRanges: ['epubcfi(/6/14!/4/2/1:0)'],
      readingSessions: sessions
    });

    render(<ReadingHistoryPanel bookId="book1" engine={mockEngine} onNavigate={vi.fn()} />);

    expect(screen.getByText('Chapter One')).toBeInTheDocument();
  });

  it('resolves chapter title from book when session has no label', () => {
    const sessions: ReadingSession[] = [{
      cfiRange: 'epubcfi(/6/14!/4/2/1:0)',
      startTime: Date.now(),
      endTime: Date.now(),
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

    render(<ReadingHistoryPanel bookId="book1" engine={mockEngine} onNavigate={vi.fn()} />);

    expect(screen.getByText('Chapter One')).toBeInTheDocument();
  });

  it('displays correct icon for TTS sessions', () => {
    const sessions: ReadingSession[] = [{
      cfiRange: 'epubcfi(/6/14!/4/2/1:0)',
      startTime: Date.now(),
      endTime: Date.now(),
      type: 'tts',
      label: 'TTS Chapter'
    }];
    (useBookProgress as any).mockReturnValue({
      completedRanges: [],
      readingSessions: sessions
    });

    render(<ReadingHistoryPanel bookId="book1" engine={mockEngine} onNavigate={vi.fn()} />);

    // Headphones icon should be present (lucide renders as svg)
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(screen.getByText('TTS Chapter')).toBeInTheDocument();
  });

  it('merges consecutive sessions with the same label', () => {
    const now = Date.now();
    const sessions: ReadingSession[] = [
      { cfiRange: 'cfi1', startTime: now - 5000, endTime: now - 5000, type: 'page', label: 'Chapter 1' },
      { cfiRange: 'cfi2', startTime: now - 3000, endTime: now - 3000, type: 'page', label: 'Chapter 1' },
      { cfiRange: 'cfi3', startTime: now - 1000, endTime: now - 1000, type: 'scroll', label: 'Chapter 1' },
      { cfiRange: 'cfi4', startTime: now, endTime: now, type: 'page', label: 'Chapter 2' },
    ];
    (useBookProgress as any).mockReturnValue({
      completedRanges: [],
      readingSessions: sessions
    });

    render(<ReadingHistoryPanel bookId="book1" engine={null} onNavigate={vi.fn()} />);

    // Should show 2 grouped items, not 4
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
  });

  it('does not merge non-consecutive sessions with the same label', () => {
    const now = Date.now();
    const sessions: ReadingSession[] = [
      { cfiRange: 'cfi1', startTime: now - 5000, endTime: now - 5000, type: 'page', label: 'Chapter 1' },
      { cfiRange: 'cfi2', startTime: now - 3000, endTime: now - 3000, type: 'tts', label: 'Chapter 2' },
      { cfiRange: 'cfi3', startTime: now - 1000, endTime: now - 1000, type: 'page', label: 'Chapter 1' },
    ];
    (useBookProgress as any).mockReturnValue({
      completedRanges: [],
      readingSessions: sessions
    });

    render(<ReadingHistoryPanel bookId="book1" engine={null} onNavigate={vi.fn()} />);

    // Non-consecutive: all 3 should show
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
  });

  it('calls onNavigate with correct CFI when an item is clicked', () => {
    const sessions: ReadingSession[] = [{
      cfiRange: 'epubcfi(/6/14!/4/2/1:0)',
      startTime: Date.now(),
      endTime: Date.now(),
      type: 'page',
      label: 'Chapter One'
    }];
    (useBookProgress as any).mockReturnValue({
      completedRanges: [],
      readingSessions: sessions
    });

    const onNavigate = vi.fn();
    render(<ReadingHistoryPanel bookId="book1" engine={mockEngine} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByText('Chapter One'));
    expect(onNavigate).toHaveBeenCalledWith('epubcfi(/6/14!/4/2/1:0)');
  });

  it('falls back to completedRanges when no readingSessions', () => {
    (useBookProgress as any).mockReturnValue({
      completedRanges: ['cfi1', 'cfi2', 'cfi3']
    });

    mockBook.spine.get.mockReturnValue(null);
    mockBook.locations.percentageFromCfi.mockReturnValue(0.5);

    render(<ReadingHistoryPanel bookId="book1" engine={mockEngine} onNavigate={vi.fn()} />);

    // Legacy mode: all ranges with same label ("Segment at 50.0%") should be merged
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  it('renders history items with missing timestamp gracefully', () => {
      const mockProgress = {
          readingSessions: [
              {
                  cfiRange: 'epubcfi(/1)',
                  type: 'page',
                  label: 'Segment',
                  // Intentionally missing startTime
              }
          ]
      };
      vi.mocked(useBookProgress).mockReturnValue(mockProgress as any);

      render(
          <ReadingHistoryPanel
              bookId="test-book"
              engine={mockEngine}
              onNavigate={vi.fn()}
          />
      );

      // Should fallback cleanly, not show 'Invalid Date'
      expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('renders history items with invalid timestamp gracefully', () => {
      const mockProgress = {
          readingSessions: [
              {
                  cfiRange: 'epubcfi(/1)',
                  type: 'page',
                  label: 'Segment',
                  startTime: "Not a valid date string" as unknown as number
              }
          ]
      };
      vi.mocked(useBookProgress).mockReturnValue(mockProgress as any);

      render(
          <ReadingHistoryPanel
              bookId="test-book"
              engine={mockEngine}
              onNavigate={vi.fn()}
          />
      );

      // Should fallback cleanly, not show 'Invalid Date'
      expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });
});
