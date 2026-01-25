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
