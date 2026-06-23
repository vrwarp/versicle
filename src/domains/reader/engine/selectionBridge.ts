/**
 * selectionBridge — THE selection pipeline (Phase 6 §2b "Selection
 * semantics", prep/phase6-reader-engine.md PR-4 / D3).
 *
 * Extracted verbatim from useEpubReader's `attachListeners`: a per-document
 * listener that re-checks the selection after a 10ms delay (click races),
 * resolves the CFI via `contents.cfiFromRange`, and reports ONE selection per
 * gesture. This path exists because epub.js's own debounced `selected` event
 * is unreliable on WebKit, and it is the SINGLE source of selection events —
 * the parallel epub.js `selected` listener was dropped in the same change that
 * landed this module (D3: "selections can fire twice"), pinned by
 * useEpubReader_Selection.test.tsx.
 *
 * The gesture ends on `mouseup` for desktop drag-selection, but on Android
 * (Capacitor WebView) a long-press selection is a TOUCH gesture finalized via
 * the native selection handles — `mouseup` is not reliably delivered there, so
 * the gesture also has to be picked up on `touchend`. (Dropping epub.js's
 * selectionchange-based `selected` pipeline in D3 left mouseup as the only
 * trigger, which is why long-press selection stopped opening the compass on
 * Android.) Both events funnel through one resolver with a per-gesture CFI
 * de-dupe so "one selection per gesture" still holds when a platform emits
 * both.
 *
 * Also owns the contextmenu suppression (Android long-press) that shared the
 * legacy listener-attachment guard.
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

  // De-dupe across the end-of-gesture events: a single Android long-press can
  // surface through both touchend AND a synthesized mouseup, and we must not
  // report the same selection twice. Cleared when the selection collapses so
  // re-selecting the same text fires again.
  let lastCfi: string | null = null;

  const emitSelection = () => {
    const selection = contents.window.getSelection();
    if (!selection || selection.isCollapsed) {
      lastCfi = null;
      return;
    }
    if (selection.rangeCount === 0) return;

    let range;
    try {
      range = selection.getRangeAt(0);
    } catch {
      // Handle IndexSizeError if selection was cleared
      return;
    }

    if (!range) return;
    const cfi = contents.cfiFromRange(range);
    if (cfi && cfi !== lastCfi) {
      lastCfi = cfi;
      onSelection(cfi, range, contents);
    }
  };

  // Re-check selection existence after a short delay to handle race
  // conditions where a click event might have cleared it (the legacy 10ms
  // mouseup guard, applied to both gesture-end events).
  const scheduleEmit = () => {
    setTimeout(emitSelection, 10);
  };

  // Desktop: drag-selection ends on mouseup.
  doc.addEventListener('mouseup', scheduleEmit);
  // Android / touch: long-press selection ends on touchend (mouseup is not
  // reliably delivered for handle-driven selection in the WebView).
  doc.addEventListener('touchend', scheduleEmit);
}
