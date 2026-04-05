import { describe, it, expect, vi, beforeEach, Mock } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAllBooks, useLastReadBookId } from './selectors';
import { useLibraryStore } from './useLibraryStore';
import { useBookStore } from './useBookStore';
import { useReadingStateStore } from './useReadingStateStore';
import { useReadingListStore } from './useReadingListStore';
import { useLocalHistoryStore } from './useLocalHistoryStore';
import type { UserProgress } from '../types/db';
import { getDeviceId } from '../lib/device-id';
import type { BookMetadata } from '../types/db';

// Mock stores
vi.mock('./useLocalHistoryStore', () => ({
  useLocalHistoryStore: vi.fn(),
}));

vi.mock('./useLibraryStore', () => ({
  useLibraryStore: vi.fn(),
}));

vi.mock('./useBookStore', () => ({
  useBookStore: vi.fn(),
}));

vi.mock('./useReadingStateStore', () => ({
  useReadingStateStore: vi.fn(),
  isValidProgress: (p: UserProgress | null | undefined) => !!(p && p.percentage > 0.005),
  getMostRecentProgress: (bookProgress: Record<string, UserProgress> | undefined) => {
    if (!bookProgress) return null;
    let max: UserProgress | null = null;
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
      (useBookStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector(mockBookState);
      });

      // Mock implementation of useLibraryStore
      (useLibraryStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector(mockLibraryState);
      });

      // Mock reading state
      (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
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

      (useBookStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector(mockBookState);
      });

      (useLibraryStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector(mockLibraryState);
      });

      (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
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

      (useBookStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector(mockBookState);
      });
      (useLibraryStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector(mockLibraryState);
      });
      (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector({ progress: {} }); // No device progress
      });
      (useReadingListStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector(mockReadingListState);
      });

      const { result } = renderHook(() => useAllBooks());

      expect(result.current).toHaveLength(1);
      expect(result.current[0].progress).toBe(0.75);
    });

    it('should fallback to title/author matching for reading list progress if sourceFilename is missing', () => {
      const mockBookState = {
        books: {
          'b1': {
            bookId: 'b1',
            title: '  The Great Gatsby ',
            author: ' F. Scott Fitzgerald',
            // sourceFilename is explicitly missing
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
          'old-filename.epub': {
            filename: 'old-filename.epub',
            percentage: 0.85,
            lastUpdated: 200,
            // Testing case insensitivity and whitespace handling
            title: 'the great gatsby',
            author: 'f. scott fitzgerald  '
          }
        }
      };

      (useBookStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector(mockBookState);
      });
      (useLibraryStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector(mockLibraryState);
      });
      (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector({ progress: {} }); // No device progress
      });
      (useReadingListStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector(mockReadingListState);
      });

      const { result } = renderHook(() => useAllBooks());

      expect(result.current).toHaveLength(1);
      expect(result.current[0].progress).toBe(0.85);
    });

    it('should match reading list entry when book title has file extension stripped during normalization', () => {
      const mockBookState = {
        books: {
          'b1': {
            bookId: 'b1',
            title: 'All Systems Red',
            author: 'Martha Wells',
            addedAt: 100,
            lastInteraction: 100,
            status: 'unread',
            tags: []
          }
        }
      };

      const mockReadingListState = {
        entries: {
          'All Systems Red.epub': {
            filename: 'All Systems Red.epub',
            percentage: 0.60,
            lastUpdated: 300,
            title: 'All Systems Red.epub',
            author: 'Martha Wells'
          }
        }
      };

      (useBookStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockBookState));
      (useLibraryStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ staticMetadata: {}, offloadedBookIds: new Set() }));
      (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ progress: {} }));
      (useReadingListStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockReadingListState));

      const { result } = renderHook(() => useAllBooks());
      expect(result.current).toHaveLength(1);
      expect(result.current[0].progress).toBe(0.60);
    });

    it('should match reading list entry when title uses underscores instead of spaces', () => {
      const mockBookState = {
        books: {
          'b1': {
            bookId: 'b1',
            title: 'The Three Body Problem',
            author: 'Liu Cixin',
            addedAt: 100,
            lastInteraction: 100,
            status: 'unread',
            tags: []
          }
        }
      };

      const mockReadingListState = {
        entries: {
          'The_Three_Body_Problem.epub': {
            filename: 'The_Three_Body_Problem.epub',
            percentage: 0.40,
            lastUpdated: 300,
            title: 'The_Three_Body_Problem',
            author: 'Liu Cixin'
          }
        }
      };

      (useBookStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockBookState));
      (useLibraryStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ staticMetadata: {}, offloadedBookIds: new Set() }));
      (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ progress: {} }));
      (useReadingListStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockReadingListState));

      const { result } = renderHook(() => useAllBooks());
      expect(result.current).toHaveLength(1);
      expect(result.current[0].progress).toBe(0.40);
    });

    it('should match reading list entry when title has bracketed edition metadata', () => {
      const mockBookState = {
        books: {
          'b1': {
            bookId: 'b1',
            title: 'Dune',
            author: 'Frank Herbert',
            addedAt: 100,
            lastInteraction: 100,
            status: 'unread',
            tags: []
          }
        }
      };

      const mockReadingListState = {
        entries: {
          'dune-deluxe.epub': {
            filename: 'dune-deluxe.epub',
            percentage: 0.95,
            lastUpdated: 300,
            title: 'Dune [Deluxe Edition]',
            author: 'Frank Herbert'
          }
        }
      };

      (useBookStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockBookState));
      (useLibraryStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ staticMetadata: {}, offloadedBookIds: new Set() }));
      (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ progress: {} }));
      (useReadingListStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockReadingListState));

      const { result } = renderHook(() => useAllBooks());
      expect(result.current).toHaveLength(1);
      expect(result.current[0].progress).toBe(0.95);
    });

    it('should match reading list entry when book has title but no author', () => {
      const mockBookState = {
        books: {
          'b1': {
            bookId: 'b1',
            title: 'Orphan Book',
            // No author field
            addedAt: 100,
            lastInteraction: 100,
            status: 'unread',
            tags: []
          }
        }
      };

      const mockReadingListState = {
        entries: {
          'orphan.epub': {
            filename: 'orphan.epub',
            percentage: 0.30,
            lastUpdated: 300,
            title: 'Orphan Book',
            author: 'Unknown Author'
          }
        }
      };

      (useBookStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockBookState));
      (useLibraryStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ staticMetadata: {}, offloadedBookIds: new Set() }));
      (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ progress: {} }));
      (useReadingListStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockReadingListState));

      const { result } = renderHook(() => useAllBooks());
      expect(result.current).toHaveLength(1);
      expect(result.current[0].progress).toBe(0.30);
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
      let mockProgress: Record<string, Record<string, Partial<UserProgress>>> = {
        'book-a': { 'device-1': { percentage: 0, lastRead: 100 } },
        'book-b': { 'device-1': { percentage: 0, lastRead: 100 } }
      };

      (useBookStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockBookState));
      (useLibraryStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockLibraryState));

      // Dynamic mock for reading state
      (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ progress: mockProgress }));
      (useReadingListStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ entries: {} }));
      (getDeviceId as Mock).mockReturnValue('device-1');

      const { result, rerender } = renderHook(() => useAllBooks());

      const firstRender = result.current;
      const bookA_v1 = firstRender.find((b: BookMetadata) => b.id === 'book-a');
      const bookB_v1 = firstRender.find((b: BookMetadata) => b.id === 'book-b');

      expect(bookA_v1).toBeDefined();
      expect(bookB_v1).toBeDefined();

      // Update progress for Book A
      mockProgress = {
        ...mockProgress,
        'book-a': { 'device-1': { percentage: 0.5, lastRead: 200 } }
      };

      rerender();

      const secondRender = result.current;
      const bookA_v2 = secondRender.find((b: BookMetadata) => b.id === 'book-a');
      const bookB_v2 = secondRender.find((b: BookMetadata) => b.id === 'book-b');

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

      (useBookStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockBookState));
      (useLibraryStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockLibraryState));
      (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ progress: mockProgress }));
      (useReadingListStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ entries: {} }));

      const { result, rerender } = renderHook(() => useAllBooks());

      const firstRender = result.current;
      const bookA_v1 = firstRender.find((b: BookMetadata) => b.id === 'book-a');
      const bookB_v1 = firstRender.find((b: BookMetadata) => b.id === 'book-b');

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
      const bookA_v2 = secondRender.find((b: BookMetadata) => b.id === 'book-a');
      const bookB_v2 = secondRender.find((b: BookMetadata) => b.id === 'book-b');

      // Book A changed, should be new object
      expect(bookA_v2.title).toBe('Book A Updated');
      expect(bookA_v2).not.toBe(bookA_v1);

      // Book B did NOT change (same reference in store), should be SAME object reference in result
      // This validates the Phase 1 WeakMap optimization
      expect(bookB_v2).toBe(bookB_v1);
    });

    it('should rebuild cache when staticMetadata dependencies change, avoiding stale cache reads', () => {
      const bookA = { bookId: 'book-a', title: 'Book A', lastInteraction: 100, status: 'unread', tags: [] };
      const mockBookState = {
        books: { 'book-a': bookA }
      };

      let mockLibraryState = { staticMetadata: {}, offloadedBookIds: new Set() };
      const mockProgress = { 'book-a': {} };

      (useBookStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockBookState));
      (useLibraryStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector(mockLibraryState));
      (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ progress: mockProgress }));
      (useReadingListStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => selector({ entries: {} }));

      const { result, rerender } = renderHook(() => useAllBooks());

      const firstRender = result.current;
      const bookA_v1 = firstRender.find((b: BookMetadata) => b.id === 'book-a');
      expect(bookA_v1.title).toBe('Book A');

      // Update static metadata
      mockLibraryState = {
        staticMetadata: {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          'book-a': { id: 'book-a', title: 'Book A - Static Meta' } as any
        },
        offloadedBookIds: new Set()
      };

      rerender();

      const secondRender = result.current;
      const bookA_v2 = secondRender.find((b: BookMetadata) => b.id === 'book-a');

      // We expect the new title from static metadata, proving the cache was invalidated and rebuilt
      expect(bookA_v2.title).toBe('Book A - Static Meta');
      expect(bookA_v2).not.toBe(bookA_v1);
    });
  });

  describe('useLastReadBookId', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Default: no local history
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useLocalHistoryStore).mockImplementation((selector: any) => selector({ lastReadBookId: null }));
    });

    it('should return null if no progress exists and no local history', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingStateStore).mockImplementation((selector: any) => {
        return selector({ progress: {} });
      });
      (getDeviceId as Mock).mockReturnValue('device-1');

      const { result } = renderHook(() => useLastReadBookId());
      expect(result.current).toBeNull();
    });

    it('should prioritize local history if available', () => {
      // Local history has 'local-book'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useLocalHistoryStore).mockImplementation((selector: any) => selector({ lastReadBookId: 'local-book' }));

      // Reading state has 'remote-book' which is newer (should be ignored)
      const mockProgress = {
        'remote-book': { 'device-1': { lastRead: 2000, percentage: 0.5 } },
        'local-book': { 'device-1': { lastRead: 1000, percentage: 0.1 } }
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingStateStore).mockImplementation((selector: any) => {
        // If local ID is present, the selector should ideally return null (conditional subscription).
        // But our test mock implementation blindly runs the selector.
        return selector({ progress: mockProgress });
      });
      vi.mocked(getDeviceId).mockReturnValue('device-1');

      const { result } = renderHook(() => useLastReadBookId());
      expect(result.current).toBe('local-book');
    });

    it('should fallback to progress scan if local history is missing', () => {
      // Local history empty
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useLocalHistoryStore).mockImplementation((selector: any) => selector({ lastReadBookId: null }));

      const mockProgress = {
        'book1': {
          'device-1': { lastRead: 1000, percentage: 0.1 },
          'device-2': { lastRead: 2000, percentage: 0.5 } // Newer, but different device
        },
        'book2': {
          'device-1': { lastRead: 1500, percentage: 0.2 }, // Newest on device-1
        }
      };

      (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector({ progress: mockProgress });
      });
      (getDeviceId as Mock).mockReturnValue('device-1');

      const { result } = renderHook(() => useLastReadBookId());
      expect(result.current).toBe('book2');
    });

    it('should ignore books not read on current device even if read recently on others', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useLocalHistoryStore).mockImplementation((selector: any) => selector({ lastReadBookId: null }));

      const mockProgress = {
        'book1': {
          'device-1': { lastRead: 1000, percentage: 0.1 }
        },
        'book3': {
          'device-2': { lastRead: 5000, percentage: 0.9 } // Very new, but wrong device
        }
      };

      (useReadingStateStore as unknown as Mock).mockImplementation((selector: (state: unknown) => unknown) => {
        return selector({ progress: mockProgress });
      });
      (getDeviceId as Mock).mockReturnValue('device-1');

      const { result } = renderHook(() => useLastReadBookId());
      expect(result.current).toBe('book1');
    });
  });
});
