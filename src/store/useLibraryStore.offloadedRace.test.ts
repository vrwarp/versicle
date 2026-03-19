import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLibraryStore, useBookStore } from './useLibraryStore';

describe('LibraryStore offloaded status race condition', () => {
  beforeEach(() => {
    useBookStore.setState({ books: {} });
  });

  it('should not overwrite concurrent removals from offloadedBookIds during hydration', async () => {
    // 1. Setup mock DB
    const mockDb = {
      getBookMetadata: vi.fn(async (id) => {
        return { id, title: `Book ${id} from DB` };
      }),
      getOffloadedStatus: vi.fn(async () => {
        // Simulate a slow DB read
        await new Promise((resolve) => setTimeout(resolve, 50));
        const map = new Map();
        map.set('book1', true); // DB says book1 is offloaded
        return map;
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useLibraryStore = createLibraryStore(mockDb as any);

    // 2. Setup initial sync store state
    useBookStore.setState({
      books: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'book1': { bookId: 'book1', title: 'Book 1' } as any
      }
    });

    // Assume initially it's known to be offloaded
    useLibraryStore.setState({ offloadedBookIds: new Set(['book1']) });

    // 3. Start hydration (reads from DB)
    const hydratePromise = useLibraryStore.getState().hydrateStaticMetadata();

    // 4. Concurrently, something else (like restoreBook) removes the offloaded status
    useLibraryStore.setState({
      offloadedBookIds: new Set()
    });

    // 5. Wait for hydration to finish
    await hydratePromise;

    // 6. The concurrent removal should NOT have been wiped out by the stale DB read!
    const state = useLibraryStore.getState();
    expect(state.offloadedBookIds.has('book1')).toBe(false);
  });
});
