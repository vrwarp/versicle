/**
 * libraryViewStore hook suite (Phase 7 PR-L5: re-pointed from the
 * render-time module cache to the derived libraryViewStore — assertions
 * preserved, running against the REAL input stores per the harness
 * philosophy; renamed from selectors.test.ts when the façade died).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAllBooks, useLastReadBookId } from './libraryViewStore';
import { useLibraryStore } from './useLibraryStore';
import { useBookStore } from './useBookStore';
import { useReadingStateStore } from './useReadingStateStore';
import { useReadingListStore } from './useReadingListStore';
import { useLocalHistoryStore } from './useLocalHistoryStore';
import type { UserInventoryItem, UserProgress, ReadingListEntry } from '~types/user-data';
import { makeBookMetadata, makeInventoryItem } from '@test/harness';
import { getDeviceId } from '@lib/device-id';

// Mock device ID (deterministic resolution)
vi.mock('@lib/device-id', () => ({
  getDeviceId: vi.fn(),
}));

const seedBooks = (books: Record<string, UserInventoryItem>) => {
  act(() => {
    useBookStore.setState({ books });
  });
};

const seedProgress = (progress: Record<string, Record<string, UserProgress>>) => {
  act(() => {
    useReadingStateStore.setState({ progress });
  });
};

const seedEntries = (entries: Record<string, ReadingListEntry>) => {
  act(() => {
    useReadingListStore.setState({ entries });
  });
};

const entry = (overrides: Partial<ReadingListEntry> & Pick<ReadingListEntry, 'filename'>): ReadingListEntry => ({
  title: overrides.filename,
  author: 'Author',
  percentage: 0,
  lastUpdated: 1,
  ...overrides,
});

const progressOf = (percentage: number, lastRead = 100, currentCfi?: string): UserProgress => ({
  bookId: 'irrelevant',
  percentage,
  lastRead,
  currentCfi,
  completedRanges: [],
});

describe('selectors', () => {
  beforeEach(() => {
    vi.mocked(getDeviceId).mockReturnValue('device-1');
    act(() => {
      useBookStore.setState({ books: {} });
      useLibraryStore.setState({ staticMetadata: {}, offloadedBookIds: new Set() });
      useReadingStateStore.setState({ progress: {} });
      useReadingListStore.setState({ entries: {} });
    });
  });

  describe('useAllBooks', () => {
    it('should prioritize customTitle from Yjs over static metadata', () => {
      seedBooks({
        b1: makeInventoryItem({ bookId: 'b1', title: 'Snapshot Title', customTitle: 'Custom Title' }),
      });
      act(() => {
        useLibraryStore.getState().setStaticMetadata('b1', makeBookMetadata({ id: 'b1', title: 'Static Title' }));
      });

      const { result } = renderHook(() => useAllBooks());
      expect(result.current[0].title).toBe('Custom Title');
    });

    it('should fallback to static metadata title if customTitle is missing', () => {
      seedBooks({ b1: makeInventoryItem({ bookId: 'b1', title: 'Snapshot Title' }) });
      act(() => {
        useLibraryStore.getState().setStaticMetadata('b1', makeBookMetadata({ id: 'b1', title: 'Static Title' }));
      });

      const { result } = renderHook(() => useAllBooks());
      expect(result.current[0].title).toBe('Static Title');
    });

    it('should fallback to reading list progress if device progress is missing', () => {
      seedBooks({ b1: makeInventoryItem({ bookId: 'b1', sourceFilename: 'book.epub' }) });
      seedEntries({ 'book.epub': entry({ filename: 'book.epub', percentage: 0.42, lastUpdated: 777 }) });

      const { result } = renderHook(() => useAllBooks());
      expect(result.current[0].progress).toBe(0.42);
      expect(result.current[0].lastRead).toBe(777);
    });

    it('regression: the bookId FK join wins even when filename and fuzzy keys diverge (Phase 7 §D)', () => {
      seedBooks({
        b1: makeInventoryItem({ bookId: 'b1', title: 'Completely Different', author: 'Nobody', sourceFilename: 'renamed.epub' }),
      });
      seedEntries({
        'original.epub': entry({
          filename: 'original.epub',
          title: 'Unrelated Title',
          author: 'Unrelated Author',
          percentage: 0.9,
          bookId: 'b1',
        }),
      });

      const { result } = renderHook(() => useAllBooks());
      expect(result.current[0].progress).toBe(0.9);
      expect(result.current[0].readingListEntry?.filename).toBe('original.epub');
    });

    it('should fallback to title/author matching for reading list progress if sourceFilename is missing', () => {
      seedBooks({ b1: makeInventoryItem({ bookId: 'b1', title: 'Moby Dick', author: 'Melville' }) });
      seedEntries({
        'moby.epub': entry({ filename: 'moby.epub', title: 'Moby Dick', author: 'Melville', percentage: 0.3 }),
      });

      const { result } = renderHook(() => useAllBooks());
      expect(result.current[0].progress).toBe(0.3);
    });

    it('should match reading list entry when book title has file extension stripped during normalization', () => {
      seedBooks({ b1: makeInventoryItem({ bookId: 'b1', title: 'Moby Dick.epub', author: 'Melville' }) });
      seedEntries({
        'm.epub': entry({ filename: 'm.epub', title: 'Moby Dick', author: 'Melville', percentage: 0.25 }),
      });

      const { result } = renderHook(() => useAllBooks());
      expect(result.current[0].progress).toBe(0.25);
    });

    it('should match reading list entry when title uses underscores instead of spaces', () => {
      seedBooks({ b1: makeInventoryItem({ bookId: 'b1', title: 'Moby_Dick', author: 'Melville' }) });
      seedEntries({
        'm.epub': entry({ filename: 'm.epub', title: 'Moby Dick', author: 'Melville', percentage: 0.5 }),
      });

      const { result } = renderHook(() => useAllBooks());
      expect(result.current[0].progress).toBe(0.5);
    });

    it('should match reading list entry when title has bracketed edition metadata', () => {
      seedBooks({ b1: makeInventoryItem({ bookId: 'b1', title: 'Moby Dick [Deluxe Edition]', author: 'Melville' }) });
      seedEntries({
        'm.epub': entry({ filename: 'm.epub', title: 'Moby Dick', author: 'Melville', percentage: 0.6 }),
      });

      const { result } = renderHook(() => useAllBooks());
      expect(result.current[0].progress).toBe(0.6);
    });

    it('should match reading list entry when book has title but no author', () => {
      seedBooks({ b1: makeInventoryItem({ bookId: 'b1', title: 'Moby Dick', author: '' }) });
      seedEntries({
        'm.epub': entry({ filename: 'm.epub', title: 'Moby Dick', author: '', percentage: 0.7 }),
      });

      const { result } = renderHook(() => useAllBooks());
      expect(result.current[0].progress).toBe(0.7);
    });

    it('should maintain object reference stability for unchanged books when progress updates', () => {
      seedBooks({
        'book-a': makeInventoryItem({ bookId: 'book-a', title: 'Book A', lastInteraction: 100 }),
        'book-b': makeInventoryItem({ bookId: 'book-b', title: 'Book B', lastInteraction: 100 }),
      });
      seedProgress({
        'book-a': { 'device-1': progressOf(0, 100) },
        'book-b': { 'device-1': progressOf(0, 100) },
      });

      const { result } = renderHook(() => useAllBooks());
      const firstRender = result.current;
      const bookA_v1 = firstRender.find((b) => b.id === 'book-a');
      const bookB_v1 = firstRender.find((b) => b.id === 'book-b');
      expect(bookA_v1).toBeDefined();
      expect(bookB_v1).toBeDefined();

      act(() => {
        useReadingStateStore.setState((state) => ({
          progress: { ...state.progress, 'book-a': { 'device-1': progressOf(0.5, 200) } },
        }));
      });

      const secondRender = result.current;
      const bookA_v2 = secondRender.find((b) => b.id === 'book-a');
      const bookB_v2 = secondRender.find((b) => b.id === 'book-b');

      expect(bookA_v2?.progress).toBe(0.5);
      expect(bookA_v2).not.toBe(bookA_v1);
      // Book B did NOT change, must be the SAME object reference (the
      // per-book memoization the old module cache provided).
      expect(bookB_v2?.progress).toBe(0);
      expect(bookB_v2).toBe(bookB_v1);
    });

    it('should maintain object reference stability for unchanged books when another book is updated in inventory', () => {
      const bookA = makeInventoryItem({ bookId: 'book-a', title: 'Book A', lastInteraction: 100 });
      const bookB = makeInventoryItem({ bookId: 'book-b', title: 'Book B', lastInteraction: 100 });
      seedBooks({ 'book-a': bookA, 'book-b': bookB });

      const { result } = renderHook(() => useAllBooks());
      const firstRender = result.current;
      const bookB_v1 = firstRender.find((b) => b.id === 'book-b');

      act(() => {
        useBookStore.setState({
          books: {
            'book-a': { ...bookA, title: 'Book A Updated', lastInteraction: 200 },
            'book-b': bookB, // SAME reference
          },
        });
      });

      const secondRender = result.current;
      const bookA_v2 = secondRender.find((b) => b.id === 'book-a');
      const bookB_v2 = secondRender.find((b) => b.id === 'book-b');

      expect(bookA_v2?.title).toBe('Book A Updated');
      // Book B kept its store reference → same result reference (WeakMap phase-1 cache).
      expect(bookB_v2).toBe(bookB_v1);
    });

    it('should rebuild cache when staticMetadata dependencies change, avoiding stale cache reads', () => {
      seedBooks({ 'book-a': makeInventoryItem({ bookId: 'book-a', title: 'Book A', lastInteraction: 100 }) });

      const { result } = renderHook(() => useAllBooks());
      const bookA_v1 = result.current.find((b) => b.id === 'book-a');
      expect(bookA_v1?.title).toBe('Book A');

      act(() => {
        useLibraryStore.getState().setStaticMetadata('book-a', makeBookMetadata({ id: 'book-a', title: 'Book A - Static Meta' }));
      });

      const bookA_v2 = result.current.find((b) => b.id === 'book-a');
      expect(bookA_v2?.title).toBe('Book A - Static Meta');
      expect(bookA_v2).not.toBe(bookA_v1);
    });

    it('should not recreate the result when nothing changed (render predictability)', () => {
      seedBooks({ 'book-a': makeInventoryItem({ bookId: 'book-a', title: 'Book A', lastInteraction: 100 }) });

      const { result, rerender } = renderHook(() => useAllBooks());
      const firstRender = result.current;

      // Force a re-render without changing ANY dependencies. The derived
      // store's state is untouched, so identity MUST hold (no React cache
      // semantics involved at all anymore).
      rerender();

      const secondRender = result.current;
      expect(firstRender).toStrictEqual(secondRender);
      expect(firstRender).toBe(secondRender);
      expect(firstRender[0]).toBe(secondRender[0]);
    });
  });

  describe('useLastReadBookId', () => {
    beforeEach(() => {
      act(() => {
        useLocalHistoryStore.setState({ lastReadBookId: null });
      });
    });

    it('should return null if no progress exists and no local history', () => {
      const { result } = renderHook(() => useLastReadBookId());
      expect(result.current).toBeNull();
    });

    it('should prioritize local history if available', () => {
      act(() => {
        useLocalHistoryStore.setState({ lastReadBookId: 'local-book' });
      });
      seedProgress({ other: { 'device-1': progressOf(0.5, 999_999) } });

      const { result } = renderHook(() => useLastReadBookId());
      expect(result.current).toBe('local-book');
    });

    it('should fallback to progress scan if local history is missing', () => {
      seedProgress({
        older: { 'device-1': progressOf(0.5, 100) },
        newer: { 'device-1': progressOf(0.5, 200) },
      });

      const { result } = renderHook(() => useLastReadBookId());
      expect(result.current).toBe('newer');
    });

    it('should ignore books not read on current device even if read recently on others', () => {
      seedProgress({
        'mine-old': { 'device-1': progressOf(0.5, 100) },
        'theirs-new': { 'device-2': progressOf(0.9, 999) },
      });

      const { result } = renderHook(() => useLastReadBookId());
      expect(result.current).toBe('mine-old');
    });
  });
});
