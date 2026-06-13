/**
 * selectionBridge — THE selection pipeline (Phase 6 §2b "Selection
 * semantics", prep/phase6-reader-engine.md PR-4 / D3).
 *
 * Extracted verbatim from useEpubReader's `attachListeners`: a per-document
 * mouseup listener that re-checks the selection after a 10ms delay (click
 * races), resolves the CFI via `contents.cfiFromRange`, and reports ONE
 * selection per gesture. This mouseup path exists for WebKit reliability
 * (epub.js's own debounced `selected` event is unreliable there) and is the
 * SINGLE source of selection events — the parallel epub.js `selected`
 * listener was dropped in the same change that landed this module (D3:
 * "selections can fire twice"), pinned by useEpubReader_Selection.test.tsx.
 *
 * Also owns the contextmenu suppression (Android long-press) that shared
 * the legacy listener-attachment guard.
 */
import type { Contents } from 'epubjs';

export type SelectionHandler = (cfiRange: string, range: Range, contents: Contents) => void;

/**
 * Attaches the bridge to one section document. Idempotent per Contents
 * instance (the legacy `_listenersAttached` guard, verbatim — epub.js
 * re-fires content hooks on re-render of the same Contents).
 */
export function attachSelectionBridge(contents: Contents, onSelection: SelectionHandler): void {
  const doc = contents.document;
  if (!doc) return;

  // Prevent duplicate listeners (typed expando on the epubjs Contents)
  const flagged = contents as Contents & { _listenersAttached?: boolean };
  if (flagged._listenersAttached) return;
  flagged._listenersAttached = true;

  // Prevent default context menu (especially for Android)
  doc.addEventListener('contextmenu', (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  });

  doc.addEventListener('mouseup', () => {
    const selection = contents.window.getSelection();
    if (!selection || selection.isCollapsed) return;

    setTimeout(() => {
      // Re-check selection existence after delay to handle race conditions
      // where a click event might have cleared it.
      if (selection.rangeCount === 0 || selection.isCollapsed) return;

      let range;
      try {
        range = selection.getRangeAt(0);
      } catch {
        // Handle IndexSizeError if selection was cleared
        return;
      }

      if (!range) return;
      const cfi = contents.cfiFromRange(range);
      if (cfi) {
        onSelection(cfi, range, contents);
      }
    }, 10);
  });
}
