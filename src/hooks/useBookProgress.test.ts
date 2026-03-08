import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBookProgress } from './useBookProgress';
import { dbService } from '../db/DBService';
import { useReadingStateStore } from '../store/useReadingStateStore';
import { useReaderUIStore } from '../store/useReaderUIStore';

// We do not mock useReadingStateStore entirely so we can use its state updates in other tests
vi.mock('../db/DBService', () => ({
  dbService: {
    getBookMetadata: vi.fn(() => Promise.resolve(null)),
  },
}));

vi.mock('../lib/device-id', () => ({
  getDeviceId: vi.fn(() => 'device2'), // Change this to device2 to test local priority vs most recent
}));

describe('useBookProgress predictability bug', () => {
  beforeEach(() => {
      useReadingStateStore.setState({ progress: {} });
      useReaderUIStore.setState({ currentBookId: null });
      vi.clearAllMocks();
  });

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

  it('causes re-render when ANY book progress changes if subscribed to allProgress (bug)', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useReaderUIStore.setState({ currentBookId: 'book1' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const book2Progress = { 'device1': { percentage: 20, currentCfi: 'cfi2', lastRead: 1 } as any };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useReadingStateStore.setState({ progress: { 'book1': { 'device1': { percentage: 10, currentCfi: 'cfi1', lastRead: 1 } as any }, 'book2': book2Progress } as any });

      let renderCount = 0;
      renderHook(() => {
          renderCount++;
          return useBookProgress('book2');
      });

      const initialRenderCount = renderCount;

      act(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          useReadingStateStore.setState({ progress: { 'book1': { 'device1': { percentage: 11, currentCfi: 'cfi1.5', lastRead: 2 } as any }, 'book2': book2Progress } as any });
      });

      // the bug was that changing book1 caused book2's useBookProgress to re-render.
      // We expect it NOT to re-render since we used useShallow on `state.progress?.[bookId]`
      // and the inner object is referentially equal.
      expect(renderCount).toBe(initialRenderCount);
  });

  it('extracts the correct most recent progress across devices', () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useReaderUIStore.setState({ currentBookId: 'book1' } as any);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useReadingStateStore.setState({ progress: { 'book1': { 'device1': { percentage: 10, currentCfi: 'cfi1', lastRead: 1 } as any, 'device2': { percentage: 50, currentCfi: 'cfi2', lastRead: 2 } as any } } as any });

      const { result } = renderHook(() => useBookProgress('book1'));

      expect(result.current.percentage).toBe(50);
      expect(result.current.currentCfi).toBe('cfi2');
  });
});
