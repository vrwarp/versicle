/**
 * useTocController — the synthetic-TOC state machine (Phase 6 §5, PR-9).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useTocController } from './useTocController';
import { useReaderUIStore } from '@store/useReaderUIStore';
import type { BookMetadata, NavigationItem } from '~types/book';

/**
 * The Smart TOC seam. The real hook calls the `setSyntheticToc` setter the
 * controller hands it once an AI enhancement pass finishes; capturing that
 * setter is the only way a test can put a synthetic TOC into the controller's
 * state that did NOT come from metadata — and that is what makes "the metadata
 * sync did not re-run" observable (see the regression block below).
 */
const { smartToc } = vi.hoisted(() => ({
  smartToc: { setter: null as ((toc: NavigationItem[]) => void) | null },
}));

vi.mock('@hooks/useSmartTOC', () => ({
  useSmartTOC: (
    _engine: unknown,
    _bookId: unknown,
    _toc: unknown,
    setSyntheticToc: (toc: NavigationItem[]) => void,
  ) => {
    smartToc.setter = setSyntheticToc;
    return { enhanceTOC: vi.fn(), isEnhancing: false, progress: null };
  },
}));

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
   * book without a synthetic TOC. It is now keyed on the two fields it reads.
   *
   * Note what a REFERENCE assertion can and cannot see. For the empty case the
   * old code minted a fresh `[]`, so a stable reference does pin the fix. For a
   * POPULATED TOC it pins nothing: the old effect re-set the caller's own array
   * and React bails out of a same-value setState, so the reference held either
   * way. The populated case therefore observes the narrowed DEPENDENCY LIST
   * instead — it puts a value into the state that did not come from metadata
   * (via the Smart TOC setter, exactly as an AI enhancement pass does) and
   * checks that a progress-only change does not re-run the sync and overwrite
   * it.
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

    it('does not re-run the metadata sync — an enhanced TOC survives a progress write', async () => {
      const syntheticToc: NavigationItem[] = [{ id: 's1', href: 'c1.xhtml', label: 'One' }];
      const { result, rerender } = renderHook(
        (props: { bookMetadata: BookMetadata }) =>
          useTocController({ bookId: 'book-1', engine: null, ...props }),
        { initialProps: { bookMetadata: metadata({ syntheticToc, progress: 0.1 }) } },
      );
      await flush();
      expect(result.current.syntheticToc).toBe(syntheticToc);

      // A Smart TOC enhancement pass lands a different list.
      const enhanced: NavigationItem[] = [{ id: 's1', href: 'c1.xhtml', label: 'One — enhanced' }];
      expect(smartToc.setter).not.toBeNull();
      act(() => smartToc.setter!(enhanced));
      expect(result.current.syntheticToc).toBe(enhanced);

      // A page turn: a brand-new metadata object, not one TOC field moved.
      rerender({
        bookMetadata: metadata({ syntheticToc, progress: 0.2, currentCfi: 'epubcfi(/6/4)' }),
      });
      await flush();

      // Keyed on the whole object, the sync re-ran and reset the list to the
      // metadata's copy — which also clobbered the enhancement.
      expect(result.current.syntheticToc).toBe(enhanced);
    });

    it('still adopts a synthetic TOC that actually changed', async () => {
      const first: NavigationItem[] = [{ id: 's1', href: 'c1.xhtml', label: 'One' }];
      const second: NavigationItem[] = [{ id: 's2', href: 'c2.xhtml', label: 'Two' }];
      const { result, rerender } = renderHook(
        (props: { bookMetadata: BookMetadata }) =>
          useTocController({ bookId: 'book-1', engine: null, ...props }),
        { initialProps: { bookMetadata: metadata({ syntheticToc: first }) } },
      );
      await flush();
      expect(result.current.syntheticToc).toBe(first);

      rerender({ bookMetadata: metadata({ syntheticToc: second }) });
      await flush();

      expect(result.current.syntheticToc).toBe(second);
    });
  });
});
