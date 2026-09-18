/**
 * useTocController — the synthetic-TOC state machine (Phase 6 §5, PR-9).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTocController } from './useTocController';
import { useReaderUIStore } from '@store/useReaderUIStore';
import type { BookMetadata, NavigationItem } from '~types/book';

const metadata = (over: Partial<BookMetadata> = {}): BookMetadata => ({
  id: 'book-1',
  title: 'A Book',
  author: 'An Author',
  addedAt: 0,
  ...over,
});

/** One microtask + one commit — the effect defers its sync a microtask. */
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

describe('useTocController', () => {
  beforeEach(() => {
    useReaderUIStore.getState().reset();
  });

  it('adopts the synthetic TOC and preference from metadata', async () => {
    const syntheticToc: NavigationItem[] = [{ id: 's1', href: 'c1.xhtml', label: 'One' }];
    const { result } = renderHook(() =>
      useTocController({
        bookId: 'book-1',
        engine: null,
        bookMetadata: metadata({ syntheticToc, useSyntheticToc: true }),
      }),
    );

    await waitFor(() => expect(result.current.useSyntheticToc).toBe(true));
    expect(result.current.syntheticToc).toBe(syntheticToc);
  });

  it('keeps an explicit user toggle across a metadata change', async () => {
    const { result, rerender } = renderHook(
      (props: { bookMetadata: BookMetadata }) =>
        useTocController({ bookId: 'book-1', engine: null, ...props }),
      { initialProps: { bookMetadata: metadata({ useSyntheticToc: false }) } },
    );
    await flush();

    act(() => result.current.onUseSyntheticTocChange(true));
    rerender({ bookMetadata: metadata({ useSyntheticToc: false }) });
    await flush();

    expect(result.current.useSyntheticToc).toBe(true);
  });

  /**
   * perf: `bookMetadata` comes from the live library projection, so its
   * identity moves on EVERY progress write (page turn / TTS sentence). The
   * effect used to be keyed on that object and to `setSyntheticToc([])` with a
   * fresh array inside a microtask — a new state value each time, so every page
   * turn re-rendered ReaderSidebars and re-ran two findTocItem walks for any
   * book without a synthetic TOC.
   */
  describe('regression: a progress-only metadata change keeps the synthetic TOC stable', () => {
    it('returns the same empty array reference across a metadata identity change', async () => {
      const { result, rerender } = renderHook(
        (props: { bookMetadata: BookMetadata }) =>
          useTocController({ bookId: 'book-1', engine: null, ...props }),
        { initialProps: { bookMetadata: metadata({ progress: 0.1 }) } },
      );
      await flush();

      const before = result.current.syntheticToc;
      expect(before).toEqual([]);

      // A progress write: a brand-new metadata object, same TOC fields.
      rerender({ bookMetadata: metadata({ progress: 0.2, currentCfi: 'epubcfi(/6/4)' }) });
      await flush();

      expect(result.current.syntheticToc).toBe(before);
    });

    it('returns the same populated array reference across a metadata identity change', async () => {
      const syntheticToc: NavigationItem[] = [{ id: 's1', href: 'c1.xhtml', label: 'One' }];
      const { result, rerender } = renderHook(
        (props: { bookMetadata: BookMetadata }) =>
          useTocController({ bookId: 'book-1', engine: null, ...props }),
        { initialProps: { bookMetadata: metadata({ syntheticToc, progress: 0.1 }) } },
      );
      await flush();

      const before = result.current.syntheticToc;
      expect(before).toBe(syntheticToc);

      rerender({ bookMetadata: metadata({ syntheticToc, progress: 0.2 }) });
      await flush();

      expect(result.current.syntheticToc).toBe(before);
    });
  });
});
