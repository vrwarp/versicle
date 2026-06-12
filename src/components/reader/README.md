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
* **`PinyinOverlay.tsx`** — decorative pinyin geometry portal; positions
  come from `domains/chinese` via the app controller; known-character
  suppression compares canonical (simplified) keys (CRDT v7).
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
* **`ReaderControlBar.tsx`** — the CompassPill host mounted from
  `RootLayout` (talks to the reader via the ReaderCommands registry).

Related: the Chinese reading feature module lives at `src/domains/chinese/`
(engine/dictionary/vocabulary); its store-coupled UI (`VocabTriageCard`)
lives at `src/components/chinese/` per the domains-no-store boundary.
