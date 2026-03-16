import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLibraryStore, useBookStore } from './useLibraryStore';

describe('LibraryStore race conditions', () => {
  beforeEach(() => {
    useBookStore.setState({ books: {} });
  });

  it('should not overwrite concurrent additions or updates when hydrating static metadata', async () => {
    // 1. Setup mock DB
    const mockDb = {
      getBookMetadata: vi.fn(async (id) => {
        // Simulate a slow DB read
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { id, title: `Book ${id} from DB` };
      }),
      getOffloadedStatus: vi.fn(async () => new Map()),
    };

    const useLibraryStore = createLibraryStore(mockDb as any);

    // 2. Put a book in the sync store so hydrate has something to do
    useBookStore.setState({
      books: {
        'old-book': { bookId: 'old-book', title: 'Old Book' } as any,
        'existing-book': { bookId: 'existing-book', title: 'Existing Book' } as any
      }
    });

    // 3. Start hydration (reads from DB)
    const hydratePromise = useLibraryStore.getState().hydrateStaticMetadata();

    // 4. Concurrently, something else adds a new book AND updates an existing book
    useLibraryStore.setState((state) => ({
      staticMetadata: {
        ...state.staticMetadata,
        'new-book': { id: 'new-book', title: 'New Book' } as any,
        'existing-book': { id: 'existing-book', title: 'Existing Book Updated Concurrently' } as any
      }
    }));

    // 5. Wait for hydration to finish
    await hydratePromise;

    // 6. The new book should not have been wiped out!
    const state = useLibraryStore.getState();
    expect(state.staticMetadata['new-book']).toBeDefined();

    // 7. The existing book should retain its concurrent update, NOT be overwritten by the stale DB read
    expect(state.staticMetadata['existing-book']?.title).toBe('Existing Book Updated Concurrently');

    // 8. The untouched old book should be loaded from the DB
    expect(state.staticMetadata['old-book']?.title).toBe('Book old-book from DB');
  });
});
