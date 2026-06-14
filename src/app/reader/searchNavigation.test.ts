/**
 * Exact-occurrence search navigation (Phase 7 §F, PR-S4's reader half):
 * display(href) → offset-resolved CFI → display(cfi) + temporary 'search'
 * highlight (auto-removed). Runs against the FakeReaderEngine — the port
 * contract is the only surface the navigator may touch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FakeReaderEngine } from '@domains/reader/engine/FakeReaderEngine';
import type { DetailedSearchResult } from '~types/search';
import { createSearchNavigator, SEARCH_HIGHLIGHT_MS } from './searchNavigation';

const result: DetailedSearchResult = {
  href: 'chapter2.xhtml',
  excerpt: '… More text here.',
  charOffset: 17, // 'More' within 'Another chapter. More text here.'
  matchLength: 4,
  occurrence: 1,
};

describe('createSearchNavigator', () => {
  let engine: FakeReaderEngine;

  beforeEach(() => {
    vi.useFakeTimers();
    engine = new FakeReaderEngine();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lands on the exact occurrence with a temporary highlight that auto-removes', async () => {
    const navigator = createSearchNavigator(() => engine);

    await navigator.navigate(result);

    // Section displayed…
    expect(engine.currentLocation()?.sectionHref).toBe('chapter2.xhtml');
    // …and the occurrence CFI got the 'search'-layer highlight.
    expect(engine.annotationLog).toHaveLength(1);
    expect(engine.annotationLog[0].className).toBe('search-highlight');
    expect(engine.annotationLog[0].cfiRange).toBe('epubcfi(/6/4!/4/2/1:0)');

    // Auto-removal after the flash window.
    vi.advanceTimersByTime(SEARCH_HIGHLIGHT_MS + 1);
    expect(engine.annotationLog).toHaveLength(0);
  });

  it('degrades to section-level display when no rendered view resolves the offset', async () => {
    vi.spyOn(engine, 'getContentViews').mockReturnValue([]);
    const navigator = createSearchNavigator(() => engine);

    await navigator.navigate(result);

    expect(engine.currentLocation()?.sectionHref).toBe('chapter2.xhtml');
    expect(engine.annotationLog).toHaveLength(0); // no CFI → no highlight
  });

  it('replaces a pending highlight on re-navigation (one flash at a time)', async () => {
    const navigator = createSearchNavigator(() => engine);

    await navigator.navigate(result);
    await navigator.navigate({ ...result, href: 'chapter1.xhtml', charOffset: 0, matchLength: 5 });

    expect(engine.annotationLog).toHaveLength(1);
    expect(engine.annotationLog[0].cfiRange).toBe('epubcfi(/6/2!/4/2/1:0)');

    vi.advanceTimersByTime(SEARCH_HIGHLIGHT_MS + 1);
    expect(engine.annotationLog).toHaveLength(0);
  });

  it('dispose() clears the pending highlight and timer (reader unmount)', async () => {
    const navigator = createSearchNavigator(() => engine);

    await navigator.navigate(result);
    expect(engine.annotationLog).toHaveLength(1);

    navigator.dispose();
    expect(engine.annotationLog).toHaveLength(0);

    // The cancelled timer must not fire into the engine again.
    vi.advanceTimersByTime(SEARCH_HIGHLIGHT_MS + 1);
    expect(engine.annotationLog).toHaveLength(0);
  });

  it('is a no-op without an engine (reader still booting)', async () => {
    const navigator = createSearchNavigator(() => null);
    await expect(navigator.navigate(result)).resolves.toBeUndefined();
  });
});
