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

interface FlaggedWindow extends Window {
  __versicleProgrammaticSelectionAt?: number;
}

/** How long after a programmatic selection mutation we treat selectionchange
 *  as app-driven rather than a user gesture. Comfortably covers the bridge's
 *  250ms selectionchange debounce. */
const PROGRAMMATIC_SELECTION_MS = 500;

/**
 * Mark that the app is about to mutate the iframe selection programmatically
 * (engine.selectRange for audio-bookmark triage, engine.clearSelection on
 * dismiss). Those mutations fire `selectionchange` too; without this flag the
 * bridge would treat them as a user gesture and clobber the triage pill or
 * re-arm a popover the user just dismissed (review H1). Call it BEFORE the
 * removeAllRanges/addRange.
 */
export function markProgrammaticSelection(win: Window | null | undefined): void {
  if (win) (win as FlaggedWindow).__versicleProgrammaticSelectionAt = Date.now();
}

function isProgrammaticSelection(win: Window): boolean {
  const at = (win as FlaggedWindow).__versicleProgrammaticSelectionAt;
  return typeof at === 'number' && Date.now() - at < PROGRAMMATIC_SELECTION_MS;
}

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
    // The Contents (and its window) can be torn down before a pending
    // debounce / re-check fires (section change, book close) — bail rather
    // than throw (review H2).
    const win = contents.window as Window | undefined;
    if (!win || !contents.document) return;

    // Ignore selection mutations the app made itself (engine.selectRange for
    // audio-bookmark triage; clearSelection on dismiss). Treating those as a
    // user gesture would clobber the triage pill or re-arm a just-dismissed
    // popover (review H1).
    if (isProgrammaticSelection(win)) return;

    const selection = win.getSelection();
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

    let cfi: string | undefined;
    try {
      cfi = contents.cfiFromRange(range);
    } catch {
      // cfiFromRange can throw on a detached/torn-down range.
      return;
    }
    if (cfi && cfi !== lastCfi) {
      lastCfi = cfi;
      onSelection(cfi, range, contents);
    }
  };

  // Fast path (desktop drag / a delivered touchend). Re-check at two delays:
  // the 10ms guard lets a click that clears the selection win the race
  // (desktop), and a longer re-check catches Android, where the native
  // selection commits slightly AFTER the touch-end event — at +10ms the range
  // can still read collapsed. De-duped, so the second check is a no-op when the
  // first already reported.
  const scheduleEmit = () => {
    setTimeout(emitSelection, 10);
    setTimeout(emitSelection, 300);
  };

  // Android path: the native long-press UI often swallows mouseup/touchend, so
  // we ALSO resolve off selectionchange — the one signal guaranteed to fire
  // when the native selection is created/adjusted. Debounced so dragging the
  // selection handles settles before we read the range (and so a single
  // word-select that fires several selectionchanges collapses to one emit). The
  // CFI de-dupe absorbs any overlap with the fast path.
  let changeTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleEmitDebounced = () => {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(emitSelection, 250);
  };

  // Desktop: drag-selection ends on mouseup.
  doc.addEventListener('mouseup', scheduleEmit);
  // Touch platforms that DO deliver it: gesture ends on touchend.
  doc.addEventListener('touchend', scheduleEmit);
  // Android / WebView: the reliable signal when mouseup/touchend are swallowed
  // by the native selection UI, or fire before the selection commits.
  doc.addEventListener('selectionchange', scheduleEmitDebounced);
}
