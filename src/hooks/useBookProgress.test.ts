import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useBookProgress } from './useBookProgress';
import { dbService } from '../db/DBService';

vi.mock('../db/DBService', () => ({
  dbService: {
    getBookMetadata: vi.fn(),
  },
}));

vi.mock('../store/useReaderUIStore', () => ({
  useReaderUIStore: vi.fn((selector) => selector({ currentBookId: null })),
}));

// We need to mock useReadingStateStore to return empty progress
vi.mock('../store/useReadingStateStore', () => ({
  useReadingStateStore: vi.fn((selector) => selector({ progress: {} })),
}));

describe('useBookProgress predictability bug', () => {
  it('should not overwrite state with stale promise resolutions', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolveFirst: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let resolveSecond: any;

    // First call returns a promise that resolves later
    // Second call returns a promise that resolves immediately
    vi.mocked(dbService.getBookMetadata)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));

    const { result, rerender } = renderHook(({ bookId }) => useBookProgress(bookId), {
      initialProps: { bookId: 'book1' },
    });

    // Change bookId before first promise resolves
    rerender({ bookId: 'book2' });

    // Resolve second promise
    await act(async () => {
      resolveSecond({ progress: 50, currentCfi: 'cfi2', lastRead: 2 });
    });

    // Expect state to be for book2
    expect(result.current.percentage).toBe(50);
    expect(result.current.currentCfi).toBe('cfi2');

    // Resolve first promise (stale)
    await act(async () => {
      resolveFirst({ progress: 10, currentCfi: 'cfi1', lastRead: 1 });
    });

    // Expect state to STILL be for book2, not overwritten by stale book1
    expect(result.current.percentage).toBe(50);
    expect(result.current.currentCfi).toBe('cfi2');
  });
});
