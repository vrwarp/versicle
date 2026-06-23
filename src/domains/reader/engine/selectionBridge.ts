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
 * (Capacitor WebView) a long-press selection is a TOUCH gesture and the native
 * selection UI SWALLOWS the trailing `mouseup`/`touchend` — they are not
 * delivered to JS while the selection handles are up. The only signal that
 * reliably fires when the native selection is created/adjusted is the
 * document's `selectionchange` (debounced so handle-dragging settles first).
 * That is the same signal epub.js's `selected` pipeline used before D3 dropped
 * it — which is exactly why long-press selection stopped opening the compass on
 * Android. So we listen for all three: `mouseup` + `touchend` (fast desktop /
 * delivered-touch path) and `selectionchange` (the Android path). They funnel
 * through ONE resolver with a per-gesture CFI de-dupe, so "one selection per
 * gesture" still holds when a platform emits several of them.
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

  // De-dupe across the trigger events: one gesture can surface through
  // mouseup, touchend AND selectionchange, and we must not report the same
  // selection more than once. Cleared when the selection collapses so
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

  // Fast path (desktop drag / a delivered touchend): re-check after a short
  // delay so a click that clears the selection wins the race (legacy 10ms
  // mouseup guard).
  const scheduleEmit = () => {
    setTimeout(emitSelection, 10);
  };

  // Android path: the native long-press UI swallows mouseup/touchend, so we
  // resolve off selectionchange instead. Debounced so dragging the selection
  // handles settles before we read the range (and so a single word-select that
  // fires several selectionchanges collapses to one emit). The CFI de-dupe
  // then absorbs any overlap with the fast path on platforms that fire both.
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleEmitDebounced = () => {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(emitSelection, 250);
  };

  // Desktop: drag-selection ends on mouseup.
  doc.addEventListener('mouseup', scheduleEmit);
  // Touch platforms that DO deliver it: gesture ends on touchend.
  doc.addEventListener('touchend', scheduleEmit);
  // Android / WebView: the only reliable signal when mouseup/touchend are
  // swallowed by the native selection UI.
  doc.addEventListener('selectionchange', scheduleEmitDebounced);
}
