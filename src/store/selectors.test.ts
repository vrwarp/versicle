import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAllBooks, useLastReadBookId } from './selectors';
import { useLibraryStore } from './useLibraryStore';
import { useBookStore } from './useBookStore';
import { useReadingStateStore } from './useReadingStateStore';
import { useReadingListStore } from './useReadingListStore';
import { getDeviceId } from '../lib/device-id';

// Mock stores
vi.mock('./useLibraryStore', () => ({
  useLibraryStore: vi.fn(),
}));

vi.mock('./useBookStore', () => ({
  useBookStore: vi.fn(),
}));

vi.mock('./useReadingStateStore', () => ({
  useReadingStateStore: vi.fn(),
  isValidProgress: (p: any) => !!(p && p.percentage > 0.005),
  getMostRecentProgress: (bookProgress: any) => {
    if (!bookProgress) return null;
    let max: any = null;
    for (const k in bookProgress) {
      const p = bookProgress[k];
      if (p && p.percentage > 0.005) {
        if (!max || p.lastRead > max.lastRead) max = p;
      }
    }
    return max;
  },
}));

vi.mock('./useReadingListStore', () => ({
  useReadingListStore: vi.fn(),
}));

// Mock device ID
vi.mock('../lib/device-id', () => ({
  getDeviceId: vi.fn(),
}));

describe('selectors', () => {
  describe('useAllBooks', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should prioritize customTitle from Yjs over static metadata', () => {
      const mockBookState = {
        books: {
          'b1': {
            bookId: 'b1',
            title: 'Snapshot Title',
            customTitle: 'Renamed Title',
            addedAt: 100,
            lastInteraction: 100,
            status: 'unread',
            tags: []
          }
        }
      };

      const mockLibraryState = {
        staticMetadata: {
          'b1': {
            bookId: 'b1',
            title: 'Static Title',
            author: 'Author'
          }
        },
        offloadedBookIds: new Set()
      };

      // Mock implementation of useBookStore
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useBookStore).mockImplementation((selector: any) => {
        return selector(mockBookState);
      });

      // Mock implementation of useLibraryStore
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useLibraryStore).mockImplementation((selector: any) => {
        return selector(mockLibraryState);
      });

      // Mock reading state
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingStateStore).mockImplementation((selector: any) => {
        return selector({ progress: {} });
      });

      const { result } = renderHook(() => useAllBooks());

      expect(result.current).toHaveLength(1);
      expect(result.current[0].title).toBe('Renamed Title');
    });

    it('should fallback to static metadata title if customTitle is missing', () => {
      const mockBookState = {
        books: {
          'b1': {
            bookId: 'b1',
            title: 'Snapshot Title',
            // No customTitle
            addedAt: 100,
            lastInteraction: 100,
            status: 'unread',
            tags: []
          }
        }
      };

      const mockLibraryState = {
        staticMetadata: {
          'b1': {
            bookId: 'b1',
            title: 'Static Title',
            author: 'Author'
          }
        },
        offloadedBookIds: new Set()
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useBookStore).mockImplementation((selector: any) => {
        return selector(mockBookState);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useLibraryStore).mockImplementation((selector: any) => {
        return selector(mockLibraryState);
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingStateStore).mockImplementation((selector: any) => {
        return selector({ progress: {} });
      });

      const { result } = renderHook(() => useAllBooks());

      expect(result.current).toHaveLength(1);
      expect(result.current).toHaveLength(1);
      expect(result.current[0].title).toBe('Static Title');
    });

    it('should fallback to reading list progress if device progress is missing', () => {
      const mockBookState = {
        books: {
          'b1': {
            bookId: 'b1',
            title: 'Book 1',
            sourceFilename: 'book1.epub',
            addedAt: 100,
            lastInteraction: 100,
            status: 'unread',
            tags: []
          }
        }
      };

      const mockLibraryState = {
        staticMetadata: {},
        offloadedBookIds: new Set()
      };

      const mockReadingListState = {
        entries: {
          'book1.epub': {
            filename: 'book1.epub',
            percentage: 0.75,
            lastUpdated: 200,
            title: 'Book 1',
            author: 'Author'
          }
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useBookStore).mockImplementation((selector: any) => {
        return selector(mockBookState);
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useLibraryStore).mockImplementation((selector: any) => {
        return selector(mockLibraryState);
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingStateStore).mockImplementation((selector: any) => {
        return selector({ progress: {} }); // No device progress
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingListStore).mockImplementation((selector: any) => {
        return selector(mockReadingListState);
      });

      const { result } = renderHook(() => useAllBooks());

      expect(result.current).toHaveLength(1);
      expect(result.current[0].progress).toBe(0.75);
    });

    it('should maintain object reference stability for unchanged books when progress updates', () => {
      // Setup: 2 books. Book A and Book B.
      const mockBookState = {
        books: {
          'book-a': { bookId: 'book-a', title: 'Book A', lastInteraction: 100, status: 'unread', tags: [] },
          'book-b': { bookId: 'book-b', title: 'Book B', lastInteraction: 100, status: 'unread', tags: [] }
        }
      };

      const mockLibraryState = { staticMetadata: {}, offloadedBookIds: new Set() };

      // Initial progress: both 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let mockProgress: any = {
        'book-a': { 'device-1': { percentage: 0, lastRead: 100 } },
        'book-b': { 'device-1': { percentage: 0, lastRead: 100 } }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useBookStore).mockImplementation((selector: any) => selector(mockBookState));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useLibraryStore).mockImplementation((selector: any) => selector(mockLibraryState));

      // Dynamic mock for reading state
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingStateStore).mockImplementation((selector: any) => selector({ progress: mockProgress }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingListStore).mockImplementation((selector: any) => selector({ entries: {} }));
      vi.mocked(getDeviceId).mockReturnValue('device-1');

      const { result, rerender } = renderHook(() => useAllBooks());

      const firstRender = result.current;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bookA_v1 = firstRender.find((b: any) => b.id === 'book-a');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bookB_v1 = firstRender.find((b: any) => b.id === 'book-b');

      expect(bookA_v1).toBeDefined();
      expect(bookB_v1).toBeDefined();

      // Update progress for Book A
      mockProgress = {
        ...mockProgress,
        'book-a': { 'device-1': { percentage: 0.5, lastRead: 200 } }
      };

      rerender();

      const secondRender = result.current;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bookA_v2 = secondRender.find((b: any) => b.id === 'book-a');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bookB_v2 = secondRender.find((b: any) => b.id === 'book-b');

      // Book A changed progress, should be new object
      expect(bookA_v2?.progress).toBe(0.5);
      expect(bookA_v2).not.toBe(bookA_v1);

      // Book B did NOT change progress, should be SAME object reference
      expect(bookB_v2?.progress).toBe(0);
      expect(bookB_v2).toBe(bookB_v1); // This validates the optimization
    });

    it('should maintain object reference stability for unchanged books when another book is updated in inventory', () => {
      // Setup: 2 books. Book A and Book B.
      // We need stable references for Book A and Book B inside the mock state to simulate real store behavior.
      const bookA = { bookId: 'book-a', title: 'Book A', lastInteraction: 100, status: 'unread', tags: [] };
      const bookB = { bookId: 'book-b', title: 'Book B', lastInteraction: 100, status: 'unread', tags: [] };

      let mockBookState = {
        books: {
          'book-a': bookA,
          'book-b': bookB
        }
      };

      const mockLibraryState = { staticMetadata: {}, offloadedBookIds: new Set() };
      const mockProgress = { 'book-a': {}, 'book-b': {} };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useBookStore).mockImplementation((selector: any) => selector(mockBookState));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useLibraryStore).mockImplementation((selector: any) => selector(mockLibraryState));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingStateStore).mockImplementation((selector: any) => selector({ progress: mockProgress }));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingListStore).mockImplementation((selector: any) => selector({ entries: {} }));

      const { result, rerender } = renderHook(() => useAllBooks());

      const firstRender = result.current;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bookA_v1 = firstRender.find((b: any) => b.id === 'book-a');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bookB_v1 = firstRender.find((b: any) => b.id === 'book-b');

      expect(bookA_v1).toBeDefined();
      expect(bookB_v1).toBeDefined();

      // Update Book A (new object reference)
      const bookA_updated = { ...bookA, title: 'Book A Updated', lastInteraction: 200 };

      mockBookState = {
        books: {
          'book-a': bookA_updated,
          'book-b': bookB // Book B is SAME reference
        }
      };

      rerender();

      const secondRender = result.current;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bookA_v2 = secondRender.find((b: any) => b.id === 'book-a');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bookB_v2 = secondRender.find((b: any) => b.id === 'book-b');

      // Book A changed, should be new object
      expect(bookA_v2.title).toBe('Book A Updated');
      expect(bookA_v2).not.toBe(bookA_v1);

      // Book B did NOT change (same reference in store), should be SAME object reference in result
      // This validates the Phase 1 WeakMap optimization
      expect(bookB_v2).toBe(bookB_v1);
    });
  });

  describe('useLastReadBookId', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return null if no progress exists', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingStateStore).mockImplementation((selector: any) => {
        return selector({ progress: {} });
      });
      vi.mocked(getDeviceId).mockReturnValue('device-1');

      const { result } = renderHook(() => useLastReadBookId());
      expect(result.current).toBeNull();
    });

    it('should return book with latest timestamp on current device', () => {
      const mockProgress = {
        'book1': {
          'device-1': { lastRead: 1000, percentage: 0.1 },
          'device-2': { lastRead: 2000, percentage: 0.5 } // Newer, but different device
        },
        'book2': {
          'device-1': { lastRead: 1500, percentage: 0.2 }, // Newest on device-1
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingStateStore).mockImplementation((selector: any) => {
        return selector({ progress: mockProgress });
      });
      vi.mocked(getDeviceId).mockReturnValue('device-1');

      const { result } = renderHook(() => useLastReadBookId());
      expect(result.current).toBe('book2');
    });

    it('should ignore books not read on current device even if read recently on others', () => {
      const mockProgress = {
        'book1': {
          'device-1': { lastRead: 1000, percentage: 0.1 }
        },
        'book3': {
          'device-2': { lastRead: 5000, percentage: 0.9 } // Very new, but wrong device
        }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingStateStore).mockImplementation((selector: any) => {
        return selector({ progress: mockProgress });
      });
      vi.mocked(getDeviceId).mockReturnValue('device-1');

      const { result } = renderHook(() => useLastReadBookId());
      expect(result.current).toBe('book1');
    });
  });
});
