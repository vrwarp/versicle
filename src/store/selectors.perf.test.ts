import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAllBooks } from './selectors';
import { useLibraryStore } from './useLibraryStore';
import { useBookStore } from './useBookStore';
import { useReadingStateStore } from './useReadingStateStore';
import { useReadingListStore } from './useReadingListStore';

// Mock stores
vi.mock('./useLibraryStore', () => ({
  useLibraryStore: vi.fn(),
}));

vi.mock('./useBookStore', () => ({
  useBookStore: vi.fn(),
}));

vi.mock('./useReadingStateStore', () => ({
  useReadingStateStore: vi.fn(),
}));

vi.mock('./useReadingListStore', () => ({
  useReadingListStore: vi.fn(),
}));

// Mock device ID
vi.mock('../lib/device-id', () => ({
  getDeviceId: vi.fn(),
}));

describe('useAllBooks Performance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should maintain object reference stability for unchanged books when progress updates for another book', () => {
    const mockBookState = {
      books: {
        'book1': { bookId: 'book1', title: 'Book 1', addedAt: 100, lastInteraction: 100, status: 'unread', tags: [] },
        'book2': { bookId: 'book2', title: 'Book 2', addedAt: 100, lastInteraction: 100, status: 'unread', tags: [] }
      }
    };

    const mockLibraryState = {
      staticMetadata: {},
      offloadedBookIds: new Set()
    };

    const mockReadingListState = { entries: {} };

    // Initial Progress State
    let progressState = {
      progress: {
        'book1': { 'device-1': { percentage: 0.1, lastRead: 100, completedRanges: [], currentCfi: 'cfi1' } },
        'book2': { 'device-1': { percentage: 0.2, lastRead: 100, completedRanges: [], currentCfi: 'cfi2' } }
      }
    };

    // Setup Mocks
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useBookStore).mockImplementation((selector: any) => selector(mockBookState));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useLibraryStore).mockImplementation((selector: any) => selector(mockLibraryState));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useReadingListStore).mockImplementation((selector: any) => selector(mockReadingListState));

    // Dynamic mock for reading state to allow updates
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useReadingStateStore).mockImplementation((selector: any) => selector(progressState));

    // First Render
    const { result, rerender } = renderHook(() => useAllBooks());

    const firstRenderBooks = result.current;
    const book1_v1 = firstRenderBooks.find(b => b.id === 'book1');
    const book2_v1 = firstRenderBooks.find(b => b.id === 'book2');

    expect(book1_v1?.progress).toBe(0.1);
    expect(book2_v1?.progress).toBe(0.2);

    // UPDATE: Change progress for Book 1 ONLY
    progressState = {
      progress: {
        'book1': { 'device-1': { percentage: 0.5, lastRead: 200, completedRanges: [], currentCfi: 'cfi1-new' } }, // Changed
        'book2': { 'device-1': { percentage: 0.2, lastRead: 100, completedRanges: [], currentCfi: 'cfi2' } }   // Unchanged
      }
    };

    // Re-render
    rerender();

    const secondRenderBooks = result.current;
    const book1_v2 = secondRenderBooks.find(b => b.id === 'book1');
    const book2_v2 = secondRenderBooks.find(b => b.id === 'book2');

    expect(book1_v2?.progress).toBe(0.5); // Should reflect update

    // VERIFY REFERENCE STABILITY
    // Book 1 changed, so it MUST be a new object
    expect(book1_v2).not.toBe(book1_v1);

    // Book 2 DID NOT change, so it SHOULD be the SAME object reference
    // Currently, this fails because we map over all books and create new objects
    expect(book2_v2).toBe(book2_v1);
  });
});
