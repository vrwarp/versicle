# Reader Components

Regenerated at Phase 6 exit (prep/phase6-reader-engine.md PR-14). The
1,400-line `ReaderView.tsx` is gone: `ReaderShell.tsx` is pure composition
over named modules, and every epub.js touch goes through the ReaderEngine
port (`src/domains/reader/engine/` — contract C7; `EpubJsEngine` is the
sole runtime epubjs importer, lint-enforced).

## Layout

* **`ReaderShell.tsx`** — the reader route as composition (<200 lines, CI
  gate): engine construction + commands ride
  `src/app/reader/useReaderController`; everything else mounts from here.
* **`shell/`** — the decomposed ReaderView concerns:
  `ReaderChrome` (header/immersive), `ReaderSidebars` (+`useTocController`,
  `useDeviceMarkers`), `ReaderViewport`, `AnnotationLayer` (highlights +
  note markers on `engine.highlights`), `DebugHighlightLayer`,
  `ImportJumpPrompt`.
* **`panels/`** — `TOCPanel`, `SearchPanel` (engine-port consumers).
* **`tests/`** — the owning suites for this directory (D13: stray sibling
  test files merged here at Phase 6 exit).

## Components

* **`ReaderTTSController.tsx`** — TTS sentence highlight + keyboard gating
  (render-isolation keeper; rides the ReaderCommands context).
* **`HistoryHighlighter.tsx`** / **`useHistoryHighlights.ts`** — reading
  history highlight layer.
* **`PinyinOverlay.tsx`** — decorative pinyin geometry portal; known-character
  suppression compares canonical (simplified) keys (CRDT v7). Positions come
  from `domains/chinese` via the app controller, but as a SUBSCRIBABLE source
  consumed by the `PinyinOverlayHost` export (`useSyncExternalStore`), so a
  geometry update re-renders only this portal and never the shell. The span
  list is memoized on the positions + vocabulary; theme halo and user pinyin
  size ride CSS custom properties on the overlay root, so neither re-renders
  the (thousands of) spans.
* **`AnnotationMarkerOverlay.tsx`**, **`ReaderHighlightsStyles.tsx`** —
  geometry portal + the parent-document half of the ONE highlight styles
  registry (`domains/reader/engine/highlightStyles`).
* **`AnnotationList.tsx`**, **`ReadingHistoryPanel.tsx`**,
  **`SyncStatusPanel.tsx`**, **`ContentAnalysisLegend.tsx`**,
  **`ContentAnalysisReport.tsx`**, **`DeviceIcon.tsx`** — sidebars/panels.
* **`UnifiedAudioPanel.tsx`**, **`TTSQueue.tsx`**, **`TTSQueueItem.tsx`**,
  **`LexiconManager.tsx`**, **`TTSAbbreviationSettings.tsx`** — the
  Listening Room surfaces.
* **`VisualSettings.tsx`** — the Reading Room (visual + Chinese reading
  preferences).
* **`ReaderControlBar.tsx`** — the THIN pill variant router mounted from
  `RootLayout` (Phase 8 §C): one priority switch dispatching to the
  feature pills in `pills/` (AudioPill, SummaryPill, AnnotationPill,
  AudioTriagePill), `sync/SyncAlertPill`, and `chinese/VocabTriageCard`;
  talks to the reader via the ReaderCommands registry and restores focus
  across variant morphs (no more key={variant} remount).

Related: the Chinese reading feature module lives at `src/domains/chinese/`
(engine/dictionary/vocabulary); its store-coupled UI (`VocabTriageCard`)
lives at `src/components/chinese/` per the domains-no-store boundary.
