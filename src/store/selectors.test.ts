import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAllBooks } from './selectors';
import { useLibraryStore } from './useLibraryStore';
import { useReadingStateStore } from './useReadingStateStore';

// Mock stores
vi.mock('./useLibraryStore', () => ({
  useLibraryStore: vi.fn(),
}));

vi.mock('./useReadingStateStore', () => ({
  useReadingStateStore: vi.fn(),
}));

describe('selectors', () => {
  describe('useAllBooks', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should prioritize customTitle from Yjs over static metadata', () => {
      const mockState = {
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
        },
        staticMetadata: {
          'b1': {
            bookId: 'b1',
            title: 'Static Title',
            author: 'Author'
          }
        },
        offloadedBookIds: new Set()
      };

      // Mock implementation of useLibraryStore to return state slice
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useLibraryStore).mockImplementation((selector: any) => {
        return selector(mockState);
      });

      // Mock reading state
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingStateStore).mockImplementation((selector: any) => {
        return selector({ progress: {} });
      });

      const result = useAllBooks();

      expect(result).toHaveLength(1);
      expect(result[0].title).toBe('Renamed Title');
    });

    it('should fallback to static metadata title if customTitle is missing', () => {
        const mockState = {
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
          },
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
        vi.mocked(useLibraryStore).mockImplementation((selector: any) => {
          return selector(mockState);
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useReadingStateStore).mockImplementation((selector: any) => {
          return selector({ progress: {} });
        });

        const result = useAllBooks();

        expect(result).toHaveLength(1);
        expect(result[0].title).toBe('Static Title');
      });
  });
});
