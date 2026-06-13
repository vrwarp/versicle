/**
 * Search-result navigation (Phase 7 §F, PR-S4's reader half — the named
 * post-merge follow-up): land on the EXACT occurrence with a temporary
 * highlight, through the ReaderEngine port only.
 *
 * Replaces `scrollToText` + the 500ms timer (the P1-vetoed artifact): instead
 * of re-finding the query text in the rendered DOM after an arbitrary delay,
 * the result's `charOffset`/`matchLength` resolve to a DOM Range against the
 * rendered section's text nodes (`findRangeForOffset` — the indexed corpus IS
 * the concatenated text-node stream), the view's `cfiFromRange` produces the
 * occurrence CFI, and `display(cfi)` lands the reader on the page containing
 * it. The temporary highlight rides the reserved 'search' layer of the
 * HighlightLayerManager and auto-removes. Resolution failure (stale corpus vs
 * re-rendered content) degrades to the section-level `display(href)` that has
 * already happened — the doc's sanctioned fallback.
 */
import type { DetailedSearchResult } from '~types/search';
import type { ReaderEngine } from '@domains/reader/engine/ReaderEngine';
import { resolveResultCfi } from '@domains/search';

/** How long the navigate-to-match highlight stays before auto-removal. */
export const SEARCH_HIGHLIGHT_MS = 2500;

export interface SearchNavigator {
  /** Display the result's section, then the exact occurrence (when resolvable). */
  navigate(result: DetailedSearchResult): Promise<void>;
  /** Clear any pending highlight + timer (reader unmount). */
  dispose(): void;
}

const sameSection = (viewHref: string, resultHref: string): boolean => {
  const a = viewHref.split('#')[0];
  const b = resultHref.split('#')[0];
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
};

export function createSearchNavigator(
  getEngine: () => ReaderEngine | null,
  opts: { highlightMs?: number } = {},
): SearchNavigator {
  const highlightMs = opts.highlightMs ?? SEARCH_HIGHLIGHT_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearHighlight = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    getEngine()?.highlights.clear('search');
  };

  return {
    async navigate(result) {
      const engine = getEngine();
      if (!engine) return;

      // 1. Render the section — also the fallback landing position.
      await engine.display(result.href);

      // 2. Resolve the exact occurrence against the now-rendered section.
      const views = engine.getContentViews();
      const view = views.find((v) => sameSection(v.sectionHref, result.href)) ?? views[0];
      if (!view?.document?.body) return;

      const resolved = resolveResultCfi(result, view.document.body, (range) =>
        view.cfiFromRange(range),
      );
      if (!resolved.cfi) return; // degraded: section-level landing

      // 3. Land on the match's page + flash the temporary highlight.
      await engine.display(resolved.cfi);
      clearHighlight();
      const live = getEngine();
      if (!live) return;
      live.highlights.add('search', resolved.cfi);
      timer = setTimeout(() => {
        timer = null;
        getEngine()?.highlights.clear('search');
      }, highlightMs);
    },
    dispose: clearHighlight,
  };
}
