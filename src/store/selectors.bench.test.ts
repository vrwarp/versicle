import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAllBooks } from './selectors';
import { useLibraryStore } from './useLibraryStore';
import { useBookStore } from './useBookStore';
import { useReadingStateStore } from './useReadingStateStore';

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

// Mock device ID
vi.mock('../lib/device-id', () => ({
  getDeviceId: vi.fn().mockReturnValue('device-1'),
}));

describe('selectors benchmark', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should maintain object reference stability for unchanged books when progress updates', () => {
      // Setup 2 books
      const mockBookState = {
        books: {
          'book1': { bookId: 'book1', title: 'Book 1', author: 'Author 1', addedAt: 100, lastInteraction: 100 },
          'book2': { bookId: 'book2', title: 'Book 2', author: 'Author 2', addedAt: 200, lastInteraction: 200 }
        }
      };

      const mockLibraryState = {
        staticMetadata: {},
        offloadedBookIds: new Set()
      };

      // Initial Progress
      let mockProgress = {
        'book1': { 'device-1': { percentage: 0.1, lastRead: 1000, currentCfi: 'cfi1', bookId: 'book1', completedRanges: [] } },
        'book2': { 'device-1': { percentage: 0.5, lastRead: 2000, currentCfi: 'cfi2', bookId: 'book2', completedRanges: [] } }
      };

      // Mock implementations
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useBookStore).mockImplementation((selector: any) => selector(mockBookState));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useLibraryStore).mockImplementation((selector: any) => selector(mockLibraryState));

      // Dynamic mock for reading state
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.mocked(useReadingStateStore).mockImplementation((selector: any) => selector({ progress: mockProgress }));

      // 1. Initial Render
      const { result, rerender } = renderHook(() => useAllBooks());

      const firstRender = result.current;
      const book1_v1 = firstRender.find(b => b.id === 'book1');
      const book2_v1 = firstRender.find(b => b.id === 'book2');

      expect(book1_v1).toBeDefined();
      expect(book2_v1).toBeDefined();

      // 2. Update Progress for Book 1 ONLY
      mockProgress = {
        'book1': { 'device-1': { percentage: 0.2, lastRead: 3000, currentCfi: 'cfi3', bookId: 'book1', completedRanges: [] } },
        // Book 2 is UNCHANGED
        'book2': { 'device-1': { percentage: 0.5, lastRead: 2000, currentCfi: 'cfi2', bookId: 'book2', completedRanges: [] } }
      };

      // Rerender
      rerender();

      const secondRender = result.current;
      const book1_v2 = secondRender.find(b => b.id === 'book1');
      const book2_v2 = secondRender.find(b => b.id === 'book2');

      // Verify Book 1 changed (correct behavior)
      expect(book1_v2?.progress).toBe(0.2);
      expect(book1_v2).not.toBe(book1_v1); // Reference changed

      // Verify Book 2 stability
      // EXPECTATION: Book 2 reference should be the SAME because its data didn't change.
      // CURRENTLY: This fails (it creates a new object).
      // AFTER FIX: This should pass.

      // Check if reference is same
      const isBook2SameReference = book2_v2 === book2_v1;

      // This is a test for the optimization.
      // If we haven't optimized yet, this assertion will fail.
      // We want to write the test to expect the OPTIMIZED behavior.
      expect(isBook2SameReference).toBe(true);
    });
});
