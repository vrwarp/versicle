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

describe('selectors performance', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should maintain object reference stability for unchanged books when progress updates', () => {
        // 1. Setup Data
        // Use distinct lastInteraction to ensure stable sort order
        const books = {
            'book1': { bookId: 'book1', title: 'Book 1', addedAt: 100, lastInteraction: 300 },
            'book2': { bookId: 'book2', title: 'Book 2', addedAt: 100, lastInteraction: 200 },
            'book3': { bookId: 'book3', title: 'Book 3', addedAt: 100, lastInteraction: 100 },
        };

        const staticMetadata = {
            'book1': { title: 'Book 1 Static' },
            'book2': { title: 'Book 2 Static' },
            'book3': { title: 'Book 3 Static' },
        };

        let progress = {
            'book1': { 'dev1': { percentage: 0.1, lastRead: 1000 } },
            'book2': { 'dev1': { percentage: 0.2, lastRead: 2000 } },
            'book3': { 'dev1': { percentage: 0.3, lastRead: 3000 } },
        };

        // 2. Setup Mocks
        const offloadedBookIds = new Set();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useBookStore).mockImplementation((cb: any) => cb({ books }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useLibraryStore).mockImplementation((cb: any) => cb({ staticMetadata, offloadedBookIds }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useReadingListStore).mockImplementation((cb: any) => cb({ entries: {} }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useReadingStateStore).mockImplementation((cb: any) => cb({ progress }));

        // 3. First Render
        const { result, rerender } = renderHook(() => useAllBooks());

        const firstRender = result.current;
        const book1_ref1 = firstRender.find(b => b.id === 'book1');
        const book2_ref1 = firstRender.find(b => b.id === 'book2');

        expect(firstRender).toHaveLength(3);

        // 4. Update Progress for Book 1 ONLY
        progress = {
            ...progress,
            'book1': { 'dev1': { percentage: 0.5, lastRead: 4000 } }
        };

        // Re-render
        rerender();

        const secondRender = result.current;
        const book1_ref2 = secondRender.find(b => b.id === 'book1');
        const book2_ref2 = secondRender.find(b => b.id === 'book2');

        // Assertions
        expect(book1_ref2).not.toBe(book1_ref1); // Changed
        expect(book2_ref2).toBe(book2_ref1);     // Unchanged (Stable)
    });

    it('should update object reference when metadata changes, even if progress is unchanged', () => {
        // This test verifies the REGRESSION fix.
        // If metadata changes, baseBooks changes, so we MUST return a new object.

        // 1. Setup Data
        let books = {
            'book1': { bookId: 'book1', title: 'Original Title', addedAt: 100, lastInteraction: 100 },
        };
        const staticMetadata = {};
        const progress = {
            'book1': { 'dev1': { percentage: 0.1, lastRead: 1000 } },
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useLibraryStore).mockImplementation((cb: any) => cb({ staticMetadata, offloadedBookIds: new Set() }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useReadingListStore).mockImplementation((cb: any) => cb({ entries: {} }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useReadingStateStore).mockImplementation((cb: any) => cb({ progress }));
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useBookStore).mockImplementation((cb: any) => cb({ books }));

        // 2. First Render
        const { result, rerender } = renderHook(() => useAllBooks());
        const ref1 = result.current[0];
        expect(ref1.title).toBe('Original Title');

        // 3. Update Metadata (Title)
        books = {
            'book1': { bookId: 'book1', title: 'New Title', addedAt: 100, lastInteraction: 100 },
        };
        // Mock must return new books
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        vi.mocked(useBookStore).mockImplementation((cb: any) => cb({ books }));

        // Re-render
        rerender();

        const ref2 = result.current[0];

        // 4. Assertions
        expect(ref2.title).toBe('New Title'); // Sanity check
        expect(ref2).not.toBe(ref1);          // MUST be a new reference
    });
});
