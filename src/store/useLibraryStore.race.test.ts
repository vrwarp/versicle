import { describe, it, expect, vi } from 'vitest';
import { createLibraryStore, useBookStore } from './useLibraryStore';
import { autoResetStores, makeLibraryDbDouble, makeBookMetadata, makeInventoryItem } from '@test/harness';

describe('LibraryStore race conditions', () => {
  autoResetStores(useBookStore);

  it('should not overwrite concurrent additions or updates when hydrating static metadata', async () => {
    // 1. Typed DB double from the harness (only the methods this flow uses)
    const mockDb = makeLibraryDbDouble({
      getBookMetadata: vi.fn(async (id: string) => {
        // Simulate a slow DB read
        await new Promise((resolve) => setTimeout(resolve, 50));
        return makeBookMetadata({ id, title: `Book ${id} from DB` });
      }),
      getOffloadedStatus: vi.fn(async () => new Map<string, boolean>()),
    });

    const useLibraryStore = createLibraryStore(mockDb);

    // 2. Put a book in the sync store so hydrate has something to do
    useBookStore.setState({
      books: {
        'old-book': makeInventoryItem({ bookId: 'old-book', title: 'Old Book' }),
        'existing-book': makeInventoryItem({ bookId: 'existing-book', title: 'Existing Book' }),
      },
    });

    // 3. Start hydration (reads from DB)
    const hydratePromise = useLibraryStore.getState().hydrateStaticMetadata();

    // 4. Concurrently, something else adds a new book AND updates an existing book
    useLibraryStore.setState((state) => ({
      staticMetadata: {
        ...state.staticMetadata,
        'new-book': makeBookMetadata({ id: 'new-book', title: 'New Book' }),
        'existing-book': makeBookMetadata({ id: 'existing-book', title: 'Existing Book Updated Concurrently' }),
      },
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
