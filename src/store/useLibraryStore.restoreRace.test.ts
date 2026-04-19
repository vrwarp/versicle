import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createLibraryStore, useBookStore } from './useLibraryStore';

describe('LibraryStore restore race conditions', () => {
  beforeEach(() => {
    useBookStore.setState({ books: {} });
  });

  it('should not resurrect concurrently removed books during restoreBook', async () => {
    // 1. Setup mock DB
    const mockDb = {
      getBookMetadata: vi.fn().mockResolvedValue(undefined),
      importBookWithId: vi.fn(async (id) => {
        // Simulate a slow DB import
        await new Promise((resolve) => setTimeout(resolve, 50));
        return { bookId: id, schemaVersion: 1, title: `Book ${id} from DB` };
      }),
      getBookIdByFilename: vi.fn().mockResolvedValue(undefined),
      addBook: vi.fn(),
      deleteBook: vi.fn(),
      offloadBook: vi.fn(),
      restoreBook: vi.fn(),
      getOffloadedStatus: vi.fn(),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useLibraryStore = createLibraryStore(mockDb as any);

    // 2. Put a book in the sync store
    useBookStore.setState({
      books: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'zombie-book': { bookId: 'zombie-book', title: 'Zombie Book' } as any
      }
    });

    useLibraryStore.setState({
        offloadedBookIds: new Set(['zombie-book']),
        staticMetadata: {
             // eslint-disable-next-line @typescript-eslint/no-explicit-any
             'zombie-book': { id: 'zombie-book', title: 'Zombie Book' } as any
        }
    });

    // 3. Start restoreBook (reads from DB and imports)
    const file = new File([''], 'test.epub', { type: 'application/epub+zip' });
    const restorePromise = useLibraryStore.getState().restoreBook('zombie-book', file);

    // 4. Concurrently, remove the book
    useLibraryStore.getState().removeBook('zombie-book');

    // 5. Wait for restore to finish
    await restorePromise;

    // 6. The removed book should not have been added back to staticMetadata!
    const state = useLibraryStore.getState();
    expect(state.staticMetadata['zombie-book']).toBeUndefined();
  });
});
