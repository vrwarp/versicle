import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLibraryStore, useBookStore } from './useLibraryStore';

describe('LibraryStore remove race conditions', () => {
  beforeEach(() => {
    useBookStore.setState({ books: {} });
  });

  it('should not restore concurrently removed books when hydrating static metadata', async () => {
    // 1. Setup mock DB
    const mockDb = {
      getBookMetadata: vi.fn(async (id) => {
        // Simulate a slow DB read
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { id, title: `Book ${id} from DB` };
      }),
      getOffloadedStatus: vi.fn(async () => new Map()),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useLibraryStore = createLibraryStore(mockDb as any);

    // 2. Put a book in the sync store so hydrate has something to do
    useBookStore.setState({
      books: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'book-to-remove': { bookId: 'book-to-remove', title: 'Book To Remove' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'existing-book': { bookId: 'existing-book', title: 'Existing Book' } as any
      }
    });

    useLibraryStore.setState({
      staticMetadata: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'book-to-remove': { id: 'book-to-remove', title: 'Book To Remove' } as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'existing-book': { id: 'existing-book', title: 'Existing Book' } as any
      }
    });

    // 3. Start hydration (reads from DB)
    const hydratePromise = useLibraryStore.getState().hydrateStaticMetadata();

    // 4. Concurrently, something else removes the book from BOTH stores
    useBookStore.setState((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { ['book-to-remove']: removed, ...remaining } = state.books;
      return { books: remaining };
    });
    useLibraryStore.setState((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { ['book-to-remove']: removed, ...remaining } = state.staticMetadata;
      return { staticMetadata: remaining };
    });

    // 5. Wait for hydration to finish
    await hydratePromise;

    // 6. The removed book should not have been added back!
    const state = useLibraryStore.getState();
    expect(state.staticMetadata['book-to-remove']).toBeUndefined();
    expect(state.staticMetadata['existing-book']).toBeDefined();
  });
});
