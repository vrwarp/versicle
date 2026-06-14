# Subsystem analysis: Audio/TTS UI layer (tts-ui)

Analyzed: 2026-06-09. Repo root: `/Users/btsai/claude/versicle` (worktree `.claude/worktrees/amazing-davinci-d7336e`). All paths relative to repo root.

## What it is

The presentation layer for audiobook/TTS playback: the in-reader "Audio Deck" sheet (transport + queue + voice settings), the floating bottom pill (CompassPill via ReaderControlBar), the headless controller that paints the spoken-sentence highlight into the epub.js iframe, the TTS tab of global settings, and the pronunciation-lexicon / segmentation-rule editors. It talks to the playback engine almost entirely through `useTTSStore` (a Zustand facade whose runtime state is replicated from a Web-Worker-resident `AudioPlayerService`), with several bypass paths that call the `getAudioPlayer()` singleton directly.

## File inventory

| File | Lines | Role |
|---|---|---|
| `src/components/reader/UnifiedAudioPanel.tsx` | 231 | "Audio Deck" Sheet: play/pause/seek, rate slider, voice select, flow toggles, queue/settings tab switch; opens LexiconManager |
| `src/components/reader/ReaderTTSController.tsx` | 210 | Render-null controller: paints/cleans `tts-highlight` annotations on the epub.js rendition, visibility reconciliation, TTS keyboard shortcuts |
| `src/components/reader/TTSQueue.tsx` | 117 | Sentence queue list with "follow the reader" auto-scroll heuristic |
| `src/components/reader/TTSQueueItem.tsx` | 41 | Memoized queue row (click → `jumpTo`) |
| `src/components/reader/TTSAbbreviationSettings.tsx` | 332 | Segmentation rule lists (abbreviations / always-merge / sentence-starters) + Bible lexicon toggle; contains generic `StringListManager`; mounted only by GlobalSettingsDialog |
| `src/components/settings/TTSSettingsTab.tsx` | 316 | Pure-props settings tab: provider select, API keys, background audio, Piper voice download/delete, min sentence length |
| `src/components/reader/LexiconManager.tsx` | 681 | Pronunciation-rule CRUD dialog: scope/language filters, reorder, CSV import/export, test-with-trace, audio preview |
| `src/components/audio/AudioReaderHUD.tsx` | 76 | **DEAD** — fixed-bottom HUD (CompassPill + SatelliteFAB), never imported |
| `src/components/audio/SatelliteFAB.tsx` | 49 | **DEAD** — floating play/pause FAB, only used by dead AudioReaderHUD (plus its own test) |
| `src/components/ui/CompassPill.tsx` | 828 | 7-variant god pill: `active`/`summary`/`compact`(audio) + `annotation` + `sync-alert` + `audio-triage` + `vocab-triage` |
| `src/components/reader/ReaderControlBar.tsx` | 267 | Mounted globally in `RootLayout`; selects CompassPill variant, handles annotation actions, mounts a LexiconManager |
| `src/hooks/useTTS.ts` | 67 | Loads voices on mount; syncs the visible section into the engine queue when idle; invalidates pause-gesture on section change |
| `src/hooks/useSectionDuration.ts` | 69 | Estimates time-remaining/progress from queue char counts (CJK-aware CPM heuristic) |
| `src/store/useTTSStore.ts` | 528 | Zustand facade: persisted settings (localStorage), per-language profiles, engine command forwarding, runtime state replicated from engine |

Supporting cast referenced for coupling evidence: `src/layouts/RootLayout.tsx`, `src/components/GlobalSettingsDialog.tsx`, `src/components/reader/ReaderView.tsx`, `src/lib/tts/engine/mainThreadAudioPlayer.ts`.

## How it works (data & control flow)

**State downstream (engine → UI).** `App.tsx:222` calls `useTTSStore.getState().initialize()` after Yjs sync. `initialize()` (useTTSStore.ts:233-258) subscribes to `getAudioPlayer()` — a `WorkerEngineHandle` singleton (mainThreadAudioPlayer.ts:29-34) — and copies `(status, activeCfi, currentIndex, queue, error, downloadInfo)` into the store on every engine tick, deriving `isPlaying = playing|loading|completed`. All components subscribe to the store with `useShallow` narrow selectors; none subscribe to the engine directly. Replication of settings the *other* way (store → worker) is handled by `src/lib/tts/engine/replicationSpec.ts`, which subscribes to the whole `useTTSStore`.

**Commands upstream (UI → engine).** Two parallel paths:
1. Store actions: `play/pause/stop/seek/jumpTo/setRate/setVoice/loadVoices/downloadVoice/...` (useTTSStore.ts:260-445) each call `getAudioPlayer().<method>()` then update persisted settings.
2. Direct singleton calls bypassing the store: `LexiconManager.tsx:204` (`preview`), `ReaderView.tsx:485` (`setBookId`), `:903/:905` (`skipToNextSection/skipToPreviousSection`), `:1011` (`jumpTo`), `:1297` (`clearPauseGesture`), and `useTTS.ts:18,32,55` (`clearPauseGesture`, `loadSectionBySectionId`).

**The pill.** `RootLayout.tsx:21` mounts `<ReaderControlBar />` app-wide. ReaderControlBar computes a variant from priority logic (compassState override > sync-alert > annotation > reader-active > playing > last-read summary > queue fallback, ReaderControlBar.tsx:92-112) and renders one `CompassPill`. Audio transport inside CompassPill goes through `useTTSStore.play/pause`; chapter navigation is sent as a `window` CustomEvent `reader:chapter-nav` (CompassPill.tsx:318-322) which ReaderView listens for (ReaderView.tsx:896-915) and translates to either `getAudioPlayer().skipTo*Section()` (TTS active) or `rendition.prev/next()`. "Play from selection" goes the opposite direction through a callback stashed in Zustand (`useReaderUIStore.playFromSelection`, registered at ReaderView.tsx:1019-1022, invoked at ReaderControlBar.tsx:166-168).

**The Audio Deck.** ReaderView renders a Radix `Sheet` whose content is `UnifiedAudioPanel` (ReaderView.tsx:1210-1223). The panel reads/writes only `useTTSStore` and renders `TTSQueue` (queue follows `currentIndex` with a visibility-based autoscroll heuristic) or a settings view (rate, voice filtered by `activeLanguage`, sanitization/preroll toggles).

**Highlight sync.** `ReaderTTSController` (rendered by ReaderView at :1117-1122) reacts to `activeCfi` changes: calls `rendition.display(activeCfi)`, sweeps orphaned `g.tts-highlight` SVG nodes by reaching into epub.js internals (`views()[i].pane.element`), re-adds the highlight annotation, and repeats the same dance on `visibilitychange`. It also owns TTS keyboard shortcuts (arrows = sentence jump while playing, space = play/pause, escape = stop).

**Settings.** `GlobalSettingsDialog` subscribes to ~18 fields of `useTTSStore` (GlobalSettingsDialog.tsx:167-199), derives `isVoiceReady` with a local effect (:201-215), and forwards everything as ~20 props into the presentational `TTSSettingsTab` (:540-564). The dialog also mounts `TTSAbbreviationSettings` (:677), which subscribes to the store directly — both patterns live in the same dialog.

**Lexicon.** `LexiconManager` reads rules from `useLexiconStore` (Yjs-backed) and writes through the `LexiconService` singleton; preview playback bypasses the store via `getAudioPlayer().preview()`. Three separate instances are mounted: UnifiedAudioPanel.tsx:228, ReaderControlBar.tsx:259-264, ReaderView.tsx:1383.

## Technical debt

### TD-1. CompassPill: 828-line, 7-variant god component in the `ui/` primitives folder
- **Severity:** critical (structural — blocks safe modification)
- **Category:** architecture
- **Evidence:** `src/components/ui/CompassPill.tsx:26` declares `variant: 'active' | 'summary' | 'compact' | 'annotation' | 'sync-alert' | 'audio-triage' | 'vocab-triage'`. One component implements: TTS transport (:757-828), library continue-reading card (:526-563), immersive transport (:566-618), annotation color/note editor (:372-523), sync alert (:621-669), audio-bookmark triage with direct CRDT mutation (`removeAnnotation`/`addAnnotation`, :274-281), and a Chinese vocab-triage tile grid with embedded dictionary lookup (:672-755, plus `VocabTile` and `getCompoundWord` helpers :42-159). It imports five domain stores + `useChineseDictionary` (:2-9), takes `rendition?: any` (:38), and calls `useReaderUIStore.getState().setCompassState(...)`/`resetCompassState()` imperatively inside JSX handlers (:445, :689, :746).
- **Impact:** Every feature team (audio, annotations, Chinese, sync) edits the same file; any change risks the other six modes. The file's placement in `ui/` inverts the layering (a "primitive" that knows about annotations, vocabulary, TTS and sync). Render-phase `setState` sync (:220-230) and variant-priority logic split between here and ReaderControlBar make behavior hard to reason about. This is the single biggest obstacle to making the audio UI independently modifiable.
- **Fix:** Extract a dumb `PillShell` visual container into `ui/`. Split each variant into its own component owned by its feature (`features/audio/AudioPill` + `CompactAudioPill` + `SummaryPill`, `features/annotations/AnnotationPill` + `TriagePill`, `features/chinese/VocabTriagePill`, `features/sync/SyncAlertPill`). ReaderControlBar becomes a small variant router (or each feature mounts its own pill into a shared slot).

### TD-2. Entire `src/components/audio/` directory is dead code (including a maintained test)
- **Severity:** high
- **Category:** dead-code
- **Evidence:** `AudioReaderHUD` is exported (`src/components/audio/AudioReaderHUD.tsx:10`) and imported by **nothing** (repo-wide grep: only its own definition). `SatelliteFAB` is consumed only by the dead HUD (`AudioReaderHUD.tsx:8,51`) and its own test `SatelliteFAB.test.tsx` (88 lines). The HUD duplicates ReaderControlBar's job (fixed-bottom CompassPill container with variant logic — AudioReaderHUD.tsx:45-74 vs ReaderControlBar.tsx:230-257).
- **Impact:** The HUD contains a behavior — auto-pause TTS when entering the library (`AudioReaderHUD.tsx:26-30`) — that *never runs*. Either the product silently lost that behavior or it migrated elsewhere; nobody can tell. Tests keep passing on dead code, inflating perceived coverage. The HUD/ControlBar pair is a textbook "parallel abstraction left behind by an AI iteration".
- **Fix:** Delete `src/components/audio/` (HUD, FAB, FAB test). Decide explicitly whether auto-pause-on-library is wanted; if yes, implement it where playback routing actually lives (store or a small `useLibraryAudioPolicy` hook) with a test.

### TD-3. Dead `rendition` prop chain makes the audio-triage selection-refinement feature unreachable
- **Severity:** high
- **Category:** correctness / dead-code
- **Evidence:** `RootLayout.tsx:21` mounts `<ReaderControlBar />` with no props; `ReaderControlBar.tsx:19` declares `rendition?: unknown` (always `undefined`) and forwards it (:254). `CompassPill.tsx:249-312` (audio-triage confirm) only refines the bookmark CFI from the user's adjusted selection `if (rendition)` (:257-272) — which is never true. ReaderView sets up this flow at `ReaderView.tsx:692-695` (sets `compassState.variant='audio-triage'` and programmatically selects the range at :686-688) expecting the pill to read the selection back.
- **Impact:** The "review bookmark → adjust selection → confirm" feature always falls back to the original dragnet CFI; the programmatic selection ReaderView creates is cosmetic. Users' adjustments are silently discarded — a shipped feature that cannot work, plus an `any`-typed prop that misleads every future reader of the code.
- **Fix:** When splitting CompassPill (TD-1), give the triage pill a real channel to reader services (see TD-4) instead of a prop that the only mount point can't supply; or move triage confirmation into ReaderView, which owns the rendition.

### TD-4. Ad-hoc cross-tree communication: window CustomEvent + callback-in-store
- **Severity:** high
- **Category:** architecture
- **Evidence:** Chapter nav: `CompassPill.tsx:318-322` dispatches `new CustomEvent('reader:chapter-nav', …)` on `window`; `ReaderView.tsx:896-915` listens and re-routes to `getAudioPlayer().skipTo*Section()` or `rendition.prev/next()`. Play-from-selection: `useReaderUIStore.ts:19` stores an optional function `playFromSelection?: (cfi) => void`, registered by `ReaderView.tsx:1019-1022`, invoked by `ReaderControlBar.tsx:166-168` via `getState()`.
- **Impact:** Two different untyped indirection mechanisms solving the same problem (a globally-mounted pill needs reader-scoped services). Both silently no-op when ReaderView is unmounted; neither is discoverable from types; storing functions in a Zustand store breaks devtools/persistence assumptions and hides the dependency graph.
- **Fix:** Define a typed `ReaderCommands` interface (`nextChapter`, `prevChapter`, `playFromCfi`, `getSelection`), provided by ReaderView through React context or a dedicated non-persisted controller registry, consumed by the pill components. Delete the CustomEvent and the store-resident callback.

### TD-5. Leaky engine boundary: components bypass the `useTTSStore` facade with direct singleton calls
- **Severity:** high
- **Category:** architecture
- **Evidence:** The store exposes transport actions (`play/pause/stop/seek/jumpTo` — useTTSStore.ts:260-268, 437-442), yet: `ReaderView.tsx:1011` calls `getAudioPlayer().jumpTo(bestIndex)` (the store action exists!); `ReaderView.tsx:485,903,905,1297` call `setBookId`, `skipToNextSection`, `skipToPreviousSection`, `clearPauseGesture` directly (no store equivalents exist); `LexiconManager.tsx:4,204` imports the engine composition root to call `preview()`; `useTTS.ts:18,32,55` holds the raw player for `clearPauseGesture`/`loadSectionBySectionId`.
- **Impact:** Two command paths into the engine means no single choke point for logging, gating (e.g., `engineReady`), or test seams. Every new feature must guess which path to use; UI tests must mock both the store *and* the singleton module. It also couples presentation files to `lib/tts/engine/mainThreadAudioPlayer` (the engine composition root).
- **Fix:** Make `useTTSStore` (or a thin `useAudioCommands()` hook over it) the *complete* command facade — add `setBookId`, `skipSection(dir)`, `loadSection`, `preview`, `clearPauseGesture` actions — and add an ESLint `no-restricted-imports` rule banning `mainThreadAudioPlayer` from `src/components/**` and `src/hooks/**`.

### TD-6. Three simultaneously-mounted LexiconManager instances
- **Severity:** medium
- **Category:** duplication / performance
- **Evidence:** Mount points: `UnifiedAudioPanel.tsx:228`, `ReaderControlBar.tsx:259-264` (global, always mounted via RootLayout), `ReaderView.tsx:1383`. The component body runs even when closed (`UiDialog` is render-controlled by `isOpen`, Dialog.tsx:40, but LexiconManager's own hooks/`useMemo` rule filtering at LexiconManager.tsx:51-70 execute on every `useLexiconStore` change for every instance). Each instance keeps independent `editingRule`/`scope`/`testInput` state, and the `initialTerm` initialization is duplicated render-phase `setState` logic (:74-87).
- **Impact:** In a reader session 2-3 copies of a 681-line dialog re-filter the rules map on every lexicon change; three independent "open" states for what is conceptually one dialog; the pronounce-from-selection flow exists twice (ReaderControlBar's `pronounce` action vs ReaderView's `lexiconOpen` state).
- **Fix:** One instance, mounted once (e.g., in RootLayout or the reader layout), driven by store state `{open, initialTerm}` (a `useLexiconDialogStore` slice or part of reader UI store). Callers call `openLexicon(term?)`.

### TD-7. `LexiconManager` duplicates its entire rule-edit form inline (god file)
- **Severity:** medium
- **Category:** duplication
- **Evidence:** The edit-in-list form (`LexiconManager.tsx:376-447`) and the add-new form (:503-575) are near-identical ~70-line JSX blocks (same inputs, same match-type select, same language select, same priority checkbox, same save/cancel buttons, same `data-testid`s — which therefore appear twice in the DOM when both render). The file also mixes service orchestration (CSV import deletes+rewrites rules one-by-one in a loop, :250-262) with presentation.
- **Impact:** Every form change must be made twice; duplicated `data-testid="lexicon-input-original"` makes tests ambiguous. The sequential `saveRule` loop on import is O(n) async round-trips with no batching or error handling — a half-failed import leaves the rule set partially replaced (the old rules were already deleted at :250-252).
- **Fix:** Extract `RuleEditorForm` (used for both add and edit); move CSV import/export into `LexiconService` as an atomic `replaceRules(scope, rules)` operation; split the test/trace panel into its own component.

### TD-8. Seek buttons advertise time-based seeking the engine doesn't implement
- **Severity:** medium
- **Category:** correctness
- **Evidence:** `UnifiedAudioPanel.tsx:100,106` — `onClick={() => seek(-15)}` with `aria-label={providerId === 'local' ? "Previous Sentence" : "Rewind 15s"}`. The store forwards to `getAudioPlayer().seek(seconds)` (useTTSStore.ts:440-442); `AudioPlayerService.seek(offset)` (AudioPlayerService.ts:924-941) uses **only the sign** of the offset — it always does sentence prev/next (or chapter boundary cross). There is no 15-second path for any provider.
- **Impact:** Mislabeled controls (accessibility labels actively wrong for cloud providers); the UI hardcodes provider-conditional behavior (`providerId === 'local'`) that doesn't correspond to engine reality — a trap for anyone "fixing" either side.
- **Fix:** Rename the action `seekSentence(direction: 1 | -1)` end-to-end and label both buttons "Previous/Next sentence"; if time-based seek is wanted for audio-element providers, implement it in the engine first.

### TD-9. ReaderTTSController: copy-pasted DOM-sweep workarounds and forced page jumps
- **Severity:** medium
- **Category:** correctness / hygiene
- **Evidence:** `ReaderTTSController.tsx` contains the same "remove orphaned `g.tts-highlight`" sweep three times (:58-73, :96-107, :132-143), each reaching into epub.js internals (`(rendition as any).views()[i].pane.element`); 12 `eslint-disable @typescript-eslint/no-explicit-any` lines in 210 lines of code. `rendition.display(activeCfi)` fires on *every* sentence change (:53) — comments acknowledge this is patching epub.js annotation races ("epub.js occasionally orphans nested SVG annotations…", :58-59; "Failsafe dom-sweep", :96).
- **Impact:** Highlight lifecycle is maintained by three diverging copies of a workaround; the `display()` call on every sentence forces a relocation/repaint and is the kind of thing that causes scroll jumps in scrolled mode. Untyped rendition access means epub.js upgrades break silently.
- **Fix:** Extract a single `TtsHighlighter` class (in the reader/epubjs adapter layer) with `show(cfi)`/`clear()` and one orphan-sweep implementation; give the controller a typed minimal rendition interface. Only call `display()` when the active CFI is off-screen.

### TD-10. Default abbreviation list duplicated between store and settings UI
- **Severity:** medium
- **Category:** duplication
- **Evidence:** `useTTSStore.ts:225-228` and `TTSAbbreviationSettings.tsx:263-266` both hardcode the identical 14-item list (`'Mr.', 'Mrs.', … 'i.e.'`). By contrast `DEFAULT_ALWAYS_MERGE`/`DEFAULT_SENTENCE_STARTERS` are correctly imported from `TextSegmenter` in both places (useTTSStore.ts:6, TTSAbbreviationSettings.tsx:4).
- **Impact:** The "Reset" button's defaults and the store's initial state can silently drift; the asymmetry with the other two lists shows it already half-happened.
- **Fix:** Export `DEFAULT_ABBREVIATIONS` from `TextSegmenter` (where the other defaults live) and import it in both.

### TD-11. Inconsistent state-access patterns + duplicated domain types in the settings tab
- **Severity:** medium
- **Category:** architecture / type-safety
- **Evidence:** `TTSSettingsTab` is fully props-driven — 20 props wired by `GlobalSettingsDialog.tsx:540-564` from an 18-field `useShallow` selection (:167-199) plus a derived `isVoiceReady` effect (:201-215) — while sibling `TTSAbbreviationSettings` (mounted by the *same dialog*, :677) subscribes to `useTTSStore` directly, as does every reader-side component. `TTSSettingsTab.tsx:17-19` re-declares `TTSProviderId`, `TTSApiKeyProvider`, `BackgroundAudioMode` as local string-literal unions duplicating the inline unions in `useTTSStore.ts:59,88,100-101`, and re-exports `TTSVoice` (:14). It still half-couples to the store anyway (`getDefaultMinSentenceLength` import, :11; `TTSProfile` inline type import, :25).
- **Impact:** Two conventions in one subsystem means every new settings control prompts a style debate and a GlobalSettingsDialog edit (that file is already an everything-orchestrator). Triple-defined provider unions will drift the day a provider is added (a new provider currently requires edits in: store type ×3, TTSSettingsTab type + `SelectItem` list, providerFactory).
- **Fix:** Define `TTSProviderId`/`BackgroundAudioMode` once in `lib/tts/providers/types.ts`; derive the settings UI's provider list from a provider registry. Standardize: each settings tab is a self-contained container subscribing to its own store slice; GlobalSettingsDialog only routes tabs.

### TD-12. Blocking native `alert()`/`confirm()` in import flows
- **Severity:** medium
- **Category:** hygiene
- **Evidence:** `TTSAbbreviationSettings.tsx:103,110,114,124` (`alert`, `window.confirm` ×2) and `LexiconManager.tsx:245` (`window.confirm`) — while the app ships its own `Dialog`/`Toast` systems used everywhere else (e.g., delete-voice confirmation uses `Dialog`, TTSSettingsTab.tsx:296-313).
- **Impact:** Inconsistent UX, unstylable/untranslatable, and synchronous blocking dialogs behave poorly inside the Capacitor Android WebView; also makes these flows hard to test (must stub globals).
- **Fix:** Replace with the existing `Dialog` confirmation pattern + toasts.

### TD-13. Test sprawl: duplicate suites, per-bug files, hand-rolled store mocks, tests for dead code
- **Severity:** medium
- **Category:** testing
- **Evidence:** Two parallel ReaderTTSController suites with different mocking idioms: `src/components/reader/ReaderTTSController.test.tsx` (mocks `useTTSStore` as plain `vi.fn()`) and `src/components/reader/tests/ReaderTTSController.test.tsx` (mocks with `Object.assign(vi.fn(), {getState})`). Per-bug file fragmentation: `TTSSettingsTab.test.tsx` + `TTSSettingsTab_Accessibility.test.tsx` + `TTSSettingsTab_Delete.test.tsx`; `TTSQueue.test.tsx` + `TTSQueue_AutoScroll.test.tsx`; `CompassPill.test.tsx` + `CompassPill_Accessibility.test.tsx` + `CompassPill_NoteRecall.test.tsx`. Every suite re-implements the full store state shape by hand (e.g., UnifiedAudioPanel.test.tsx:34-49). `SatelliteFAB.test.tsx` tests a component nothing renders (TD-2).
- **Impact:** Renaming one store field touches a dozen mock fixtures; duplicate suites rot independently; dead-code tests give false confidence. The mocking style (replacing the store module) means tests verify selector wiring, not behavior.
- **Fix:** One suite per component; share a `makeTtsStoreState(overrides)` fixture (or better, use the real store with an injected fake engine — the engine layer already has `FakeEngineContext`/`FakePlaybackBackend`); delete dead-code tests; fold `_Accessibility`/`_Delete`/`_AutoScroll` files into the main suites.

### TD-14. `useTTSStore.syncState` is dead, duplicating live derivation logic
- **Severity:** low
- **Category:** dead-code
- **Evidence:** Declared at `useTTSStore.ts:126-130`, implemented at :447-454, called nowhere (repo-wide grep: zero call sites). It duplicates the `isPlaying = status==='playing'||'loading'||'completed'` mapping that also lives in `initialize()`'s subscription (:243-245) — two copies of the same derivation in one file, one of them unreachable.
- **Impact:** Misleads readers into thinking there are two replication paths; the duplicated mapping invites a future drift bug if someone edits only one.
- **Fix:** Delete `syncState`; extract `deriveIsPlaying(status)` if the mapping is needed in more than one place.

### TD-15. Assorted hygiene/robustness nits
- **Severity:** low
- **Category:** hygiene
- **Evidence & impact:**
  - `TTSQueue.tsx:105` — `key={index}` on queue rows; with `memo` rows, index keys cause wrong-row reuse if items are ever inserted/removed mid-queue (currently queue only swaps wholesale, so latent).
  - `UnifiedAudioPanel.tsx:81-85` — `handleRefreshVoices` lacks `try/finally`; a rejected `loadVoices()` leaves the spinner stuck.
  - `UnifiedAudioPanel.tsx:178` uses `v.lang.startsWith(...)` while `TTSSettingsTab.tsx:179` defensively uses `v.lang?.startsWith(...)` — same data, two assumptions.
  - Hardcoded `en`/`zh` language lists in three places: `TTSSettingsTab.tsx:108-110`, `LexiconManager.tsx:308-312` (filter) and :409-412/:533-539 (rule editor ×2). Adding a language is a 4-file UI hunt.
  - Play gating inconsistent: UnifiedAudioPanel disables play until `engineReady` (:103) but `SatelliteFAB.tsx:18-25` (dead) and `CompassPill.tsx:324-332` don't check it — pre-boot taps silently no-op or queue against a degraded handle.
  - `TTSAbbreviationSettings.tsx` lives in `components/reader/` but is mounted only by `GlobalSettingsDialog` (settings layer) — misfiled.
  - `ReaderControlBar.tsx:251` navigates with `lastReadBook.id` while dead AudioReaderHUD used `.bookId`; `useBook` aliases both (selectors.ts: `id: book.bookId`), but the dual naming invites mistakes.
- **Fix:** Stable item keys (cfi or item id); `finally` for the spinner; one `SUPPORTED_TTS_LANGUAGES` constant; gate all transport entry points on `engineReady` in the store action itself; move the file; standardize on `bookId`.

## Problematic couplings

- **UI → engine composition root:** `LexiconManager.tsx:4`, `ReaderView.tsx:27`, `useTTS.ts:4` import `lib/tts/engine/mainThreadAudioPlayer` and invoke the singleton directly, bypassing the store facade (TD-5).
- **UI types from the engine god file:** `TTSQueueItem.tsx:2` and `useTTSStore.ts:5` import `TTSQueueItem`/`TTSStatus` types from `lib/tts/AudioPlayerService` (1242-line engine class file) instead of a types module.
- **`ui/` primitive → 5 domain stores:** `CompassPill.tsx:2-9` (TTS, reader UI, annotations, books, vocabulary stores + Chinese dictionary hook) — inverted layering (TD-1).
- **Bidirectional store↔engine coupling:** the presentation-facing `useTTSStore` is imported by engine internals (`replicationSpec.ts:16`, `createZustandEngineContext.ts:16`, `createWorkerEngineClient.ts:27`, `providerFactory.ts:12`) — the store is simultaneously the UI facade and the engine's settings source.
- **`lib/` reading a UI store:** `MaintenanceService.ts:142` pulls `sentenceStarters`/`sanitizationEnabled` from `useTTSStore` for non-UI work.
- **Raw epub.js internals from React:** `ReaderTTSController.tsx` and `ReaderView.tsx:651-738` manipulate `(rendition as any).views()/pane.element/annotations` — no adapter layer (TD-9).
- **Window event bus + callback-in-store between pill and reader** (TD-4).
- **Settings persistence split-brain (boundary note):** TTS settings persist to `localStorage` (`useTTSStore.ts:486`) while lexicon rules persist to the Yjs CRDT (`useLexiconStore`) — voice/rate/provider settings do not sync across devices but pronunciation rules do. Owned by the TTS-state subsystem, but the UI is where users will perceive the inconsistency.

## What's good (keep)

- **Single state-replication direction.** Engine → store → UI via one `subscribe` in `initialize()` (useTTSStore.ts:233-258); no component touches engine state directly. This is the right backbone — extend it, don't replace it.
- **Disciplined re-render hygiene.** Every component uses `useShallow` narrow selectors with explicit optimization comments (e.g., SatelliteFAB.tsx:9, ReaderControlBar.tsx:38-39, CompassPill.tsx:211). `ReaderTTSController` as a render-null component exists specifically to keep per-sentence updates out of ReaderView's tree (ReaderTTSController.tsx:13-17) — the isolation pattern is sound even if its internals need rework.
- **TTSQueue follow-scroll heuristic** (TTSQueue.tsx:38-83): only autoscrolls when the user was already following (current or previous item visible), so manual browsing isn't hijacked. Memoized `TTSQueueItem` rows. Keep behavior verbatim.
- **`TTSSettingsTab` as a pure presentational component** — its tests need zero store mocking; this is the model the other settings panes should converge to (with a thin per-tab container, not GlobalSettingsDialog, doing the wiring).
- **`StringListManager`** (TTSAbbreviationSettings.tsx:33-237): genuinely generic add/remove/reset/CSV list editor with validation hooks — reusable.
- **LexiconManager's test-with-trace UX** (apply rules to sample text, show per-rule transformation steps, click-to-edit the responsible rule, LexiconManager.tsx:582-677) — valuable feature, keep through the refactor.
- **Per-language TTS profiles with explicit migration** (useTTSStore.ts:10-18, 459-485) and the config-language vs active-language separation in TTSSettingsTab (:73-84).
- **Ubiquitous `data-testid`s** — keep them stable during refactor to preserve e2e coverage.

## Target design

```
src/features/audio-ui/
  facade/useAudioCommands.ts     # complete command surface over useTTSStore;
                                 # the ONLY importer of the engine handle outside lib/tts
  pill/AudioPill.tsx             # 'active' variant
  pill/CompactAudioPill.tsx      # 'compact'
  pill/SummaryPill.tsx           # 'summary' (continue reading)
  deck/AudioDeck.tsx             # UnifiedAudioPanel, slimmed
  deck/TransportControls.tsx
  deck/QueueList.tsx / QueueRow.tsx
  highlight/TtsHighlighter.ts    # single epub.js highlight lifecycle impl (typed adapter)
  highlight/TtsReaderBinding.tsx # render-null controller using TtsHighlighter + shortcuts
  settings/TtsSettingsContainer.tsx  # wires store -> presentational TTSSettingsTab
  settings/SegmentationRules.tsx     # ex-TTSAbbreviationSettings
  lexicon/LexiconDialog.tsx          # single instance, opened via store {open, initialTerm}
  lexicon/RuleEditorForm.tsx / RuleTestPanel.tsx
src/components/ui/PillShell.tsx  # dumb visual container shared by all pill variants
```

Principles:
1. **One command facade.** All playback commands (incl. `setBookId`, `skipSection`, `preview`, `clearPauseGesture`, `loadSection`) go through store actions / `useAudioCommands`; ESLint `no-restricted-imports` bans `mainThreadAudioPlayer` from components/hooks. Engine-side settings reads move off the store onto a narrow `TtsSettingsSource` interface so the store stops being a two-way coupling point.
2. **CompassPill dissolved.** `PillShell` in `ui/`; variant components live with their features (annotation, sync, vocab pills move out of this subsystem). `ReaderControlBar` becomes a ~50-line variant router with the existing priority logic, typed `ReaderCommands` from context instead of CustomEvents/callbacks-in-store.
3. **Honest transport semantics.** `seekSentence(±1)` replaces `seek(±15)`; labels match engine behavior; `engineReady` gating enforced once in the store action.
4. **Types defined once.** `TTSProviderId`, `BackgroundAudioMode`, `TTSQueueItem`, `TTSStatus` in `lib/tts/types.ts` (or providers/types); UI imports them; provider select options derive from the provider registry so adding a provider is a one-file change.
5. **Settings tabs are self-wiring containers**; GlobalSettingsDialog only routes tabs.
6. **Dead code removed**: `components/audio/`, `syncState`, the `rendition` prop chain, duplicate test files.

## Migration notes

No user-data migrations required — this is presentation-layer restructuring. `tts-storage` (localStorage, version 3) and the Yjs lexicon store are untouched; do **not** bump the persist version.

Suggested order (each step shippable):
1. **Delete dead code** (TD-2, TD-14, duplicate `ReaderTTSController.test.tsx`): zero user impact. Record the auto-pause-on-library decision in the PR.
2. **Close the facade** (TD-5): add missing store actions, switch the 7 direct `getAudioPlayer()` call sites, add the lint rule. Pure mechanical; engine behavior identical.
3. **Single LexiconDialog** (TD-6/TD-7): introduce `openLexicon(term?)` store action; replace the three mounts; extract `RuleEditorForm`. Keep all `data-testid`s so `tests/LexiconManager.test.tsx` ports with path changes only.
4. **Split CompassPill** (TD-1/TD-3/TD-4): extract `PillShell` first (pixel-identical), then peel variants one per PR, audio variants last (they have the most tests). Introduce `ReaderCommands` context before removing the `reader:chapter-nav` event; run both channels for one release if e2e depends on the event.
5. **Rework highlight controller** (TD-9): land `TtsHighlighter` with the existing behavior (including the orphan sweep — it papers over a real epub.js bug) but one implementation; add a regression test using a fake rendition.
6. **Settings cleanup** (TD-10/11/12/15): types module, provider registry, container-per-tab, dialog-based confirms.
7. **Test consolidation** (TD-13) continuously alongside each step: when a component moves, its `_Suffix` test files merge into one suite using the shared store fixture.

Behavioral parity checklist for QA: TTS keyboard shortcuts (arrows/space/escape, input-field exclusion); queue follow-scroll (manual scroll not hijacked; jump on chapter reset); highlight survives backgrounding/foregrounding (visibility reconciliation); pill variant priority (sync-alert > annotation > active/compact > summary); voice download/delete flows for Piper; pronounce-from-selection prefills the lexicon dialog; play button disabled until engine boot.
