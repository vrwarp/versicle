import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { createLibraryStore, useBookStore } from './useLibraryStore';

describe('LibraryStore offload error reverting predictability', () => {
  beforeEach(() => {
    useBookStore.setState({ books: {} });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not remove offloaded state if offload fails but book was already offloaded', async () => {
    const mockDb = {
      offloadBook: vi.fn(async () => {
        throw new Error("DB Error");
      }),
    };

    // Suppress console.error in this test specifically since it tests an error branch
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const useLibraryStore = createLibraryStore(mockDb as any);
    useLibraryStore.setState({ offloadedBookIds: new Set(['book1']) });

    await useLibraryStore.getState().offloadBook('book1');

    const state = useLibraryStore.getState();
    // It should remain offloaded even if the redundant call fails
    expect(state.offloadedBookIds.has('book1')).toBe(true);
  });
});
