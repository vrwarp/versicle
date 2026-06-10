# App shell, routing, settings & shared UI (app-shell-ui)

Analysis date: 2026-06-10. All paths relative to repo root. Line numbers from current worktree (branch `claude/amazing-davinci-d7336e`).

## What it is

The application shell: bootstrap (`src/main.tsx`, `src/App.tsx`), the two-route React Router tree, the root layout (`src/layouts/RootLayout.tsx`), global error/fallback surfaces (`ErrorBoundary`, `SafeModeView`, `ObsoleteLockView`), back-button handling (`BackNavigationManager` + `useBackNavigationStore` + `useNavigationGuard`), theming (`ThemeSelector`, `ThemeSynchronizer`), the global settings dialog and its tabs (`GlobalSettingsDialog` + `src/components/settings/`), the design system (`src/components/ui/`), the notes browsing UI (`src/components/notes/`), and shared lib utilities (`constants.ts`, `utils.ts`, `logger.ts`, `useDebounce`, `useSidebarState`).

## File inventory

| File | Role |
|---|---|
| `src/main.tsx` (143) | Entry point. Mounts `<App/>`; exposes 4 stores + 2 TTS verification hooks on `window`; initializes Capacitor SocialLogin eagerly. |
| `src/App.tsx` (372) | Boot orchestrator: router definition, SW wait, DB init, Yjs wait, device registration, heartbeat, Drive auto-scan, migration boot interceptor, unhandledrejection handler, SafeMode/loading/error gating. |
| `src/layouts/RootLayout.tsx` (27) | Root route layout: mounts BackNavigationManager, SyncToastPropagator, ThemeSynchronizer, GlobalSettingsDialog, ToastContainer, ReaderControlBar, `<Outlet/>`. |
| `src/components/ErrorBoundary.tsx` (114) | Class error boundary; special-cases migration `AWAITING_CONFIRMATION`; embeds DataRecoveryView. |
| `src/components/SafeModeView.tsx` (49) | DB-init-failure fallback with retry / destructive reset. |
| `src/components/ObsoleteLockView.tsx` (56) | Full-screen non-dismissible lock when cloud schema is newer; inline-styled overlay. |
| `src/components/BackNavigationManager.tsx` (128) | Bridges Capacitor `backButton` + React Router `useBlocker` to the handler stack. |
| `src/store/useBackNavigationStore.ts` (60) | Priority-sorted back-handler registry (`BackButtonPriority` enum). |
| `src/hooks/useNavigationGuard.ts` (23) | Register/unregister a back handler for a component's lifetime. |
| `src/components/ThemeSelector.tsx` (56) | 3-button theme picker (light/sepia/dark), hardcoded colors. |
| `src/components/ThemeSynchronizer.tsx` (31) | Syncs `usePreferencesStore.currentTheme` to `<html>` class. |
| `src/components/GlobalSettingsDialog.tsx` (718) | God container: 20+ useState, subscribes to 10 stores, owns handlers for all 9 tabs. |
| `src/components/settings/*` | Extracted tab presenters: General (203), TTS (316), GenAI (283), Sync (661), Recovery (162), DataManagement (192), Diagnostics (227), DataRecoveryView (136), CheckpointDiffView (195), JsonDiffViewer (106). |
| `src/components/ui/` | Design system: Button/Input/Label/Select/Tabs/Badge/Progress/Checkbox/Switch/Slider/Popover/DropdownMenu/ScrollArea/PasswordInput (sound shadcn-style primitives); Modal (110), Dialog (54, wraps Modal), Sheet (139); Toast (100) + ToastContainer (22); **CompassPill (828)**. |
| `src/store/useToastStore.ts` (42) | Single-slot global toast state. |
| `src/store/useUIStore.ts` (26) | `isGlobalSettingsOpen` + `obsoleteLock` only. |
| `src/components/notes/` | GlobalNotesView (174), BookNotesBlock (120), AnnotationCard (153), NotesSearchBar (41), ReassignBookDialog (132). |
| `src/hooks/useGroupedAnnotations.ts` (40) | Filter + group + sort annotations by book. |
| `src/hooks/useSidebarState.ts` (57) | Module-level Zustand store for reader side-panel + back-guard integration. |
| `src/hooks/useDebounce.ts` (17) | Standard debounce hook. |
| `src/lib/constants.ts` (14) | Only `CURRENT_BOOK_VERSION` (ingestion pipeline version — arguably misfiled here). |
| `src/lib/utils.ts` (24) | `cn()` + two CJK helpers. |
| `src/lib/logger.ts` (129) | Two logger APIs: legacy `Logger` singleton + `createLogger` ScopedLogger. |
| `src/App.css` (39) | **Dead Vite template boilerplate** (logo spin animation). |
| `src/components/audio/` | AudioReaderHUD (no consumers — dead), SatelliteFAB (only consumed by dead HUD). |
| Root-level dialogs | `ReadingListDialog.tsx` (372), `SmartLinkDialog.tsx` (220), `EditReadingListEntryDialog.tsx` (166) — grab-bag in `src/components/` root. |

## How it works (data & control flow)

### Bootstrap sequence
1. `main.tsx` module scope: exposes stores + TTS verification hooks on `window` (runs in production too, main.tsx:34-112), fires `initializeSocialLogin()` (main.tsx:126) and subscribes to Google client-ID changes, then mounts `<App/>` under StrictMode.
2. `App` runs **four sibling effects whose relative order is load-bearing but implicit** (declaration order):
   - SW wait (App.tsx:106-117): `waitForServiceWorkerController()` → `setSwInitialized(true)`.
   - Global `unhandledrejection` handler (App.tsx:120-139) → toasts for `StorageFullError`/`QuotaExceededError`.
   - Migration boot interceptor (App.tsx:143-200): reads `MigrationStateService`; `RESTORING_BACKUP` → rollback+reload; `AWAITING_CONFIRMATION` → halt sync init (modal shown later via `migrationPending` state captured in a `useState` initializer at App.tsx:89-101); otherwise cleans dangling/zombie checkpoints and calls `getFirestoreSyncManager().initialize()`.
   - Main init (App.tsx:203-300): `getDB()` → `waitForYjsSync()` → `tts.initialize()` → conditional Drive auto-scan → device registration → **100ms-poll loop waiting for books** (App.tsx:271-274) → `hydrateStaticMetadata()` → `dbStatus='ready'`. A 5-minute device heartbeat starts before init completes (App.tsx:287-290).
3. Render gates: `dbStatus==='error'` → SafeModeView; `swError` → inline error div; loading → spinner; ready → `ObsoleteLockView` + optional `WorkspaceMigrationConfirmModal` + `RouterProvider`.

### Routing
Two routes only: `/` → LibraryView, `read/:id` → ReaderView (App.tsx:38-74), each wrapped in `ErrorBoundary`. The Notes view is **not a route**: LibraryView switches on `activeContext` from `usePreferencesStore` (LibraryView.tsx:499, 638), which is a **Yjs-synced preference**.

### Back navigation
Components register prioritized handlers via `useNavigationGuard`; `BackNavigationManager` consumes the top handler for both Capacitor hardware back and browser POP (via `useBlocker`). Consumers: GlobalSettingsDialog (OVERLAY), LibraryView, useSidebarState (UI_ELEMENT).

### Settings
`GlobalSettingsDialog` is mounted unconditionally in RootLayout. It holds all state/handlers and passes props down to extracted tab presenters — except `SyncSettingsTab`, `DeviceManager`, `DiagnosticsTab`, and the inline `dictionary` tab, which reach into stores/services directly, so the container/presenter split is half-done.

### Toasts
`useToastStore` holds a single `{message,type,duration,isVisible}` slot; 81 `showToast(` call sites; `ToastContainer` renders one fixed `Toast`.

### CompassPill
A single 828-line component with **seven variants** (`active|summary|compact|annotation|sync-alert|audio-triage|vocab-triage`) that lives in `components/ui/` but subscribes to `useTTSStore`, `useReaderUIStore`, `useAnnotationStore`, `useBookStore`, `useVocabularyStore`, `useChineseDictionary`, `useSectionDuration`, accepts an epub.js `rendition: any`, mutates the annotation CRDT directly (CompassPill.tsx:275-288), and dispatches a `window` CustomEvent `'reader:chapter-nav'` that ReaderView listens for (CompassPill.tsx:320, ReaderView.tsx:913).

## Technical debt

### D1. App.tsx is an un-sequenced boot orchestrator with implicit cross-effect ordering — **critical / architecture**
- Evidence: four sibling `useEffect`s (App.tsx:106, 120, 143, 203) where the migration interceptor (which decides whether sync may start) runs before the DB/Yjs init only because of declaration order; `getFirestoreSyncManager().initialize()` (App.tsx:199) fires before `getDB()`/`waitForYjsSync()` (App.tsx:208-218) with no explicit dependency. The "HALT" semantics (App.tsx:162, 169) are comments, not enforced states. The device heartbeat starts before registration completes (App.tsx:287-290 vs 254-261). Boot also embeds Drive-scan policy (App.tsx:225-244), device-profile assembly (App.tsx:246-252), and checkpoint GC (App.tsx:184-195) inline.
- Impact: any reordering, added await, or React lifecycle change (e.g., StrictMode double-invoke, concurrent features) can silently break migration safety ("do NOT initialize sync") — the exact class of race the migration state machine exists to prevent. New boot steps get appended ad hoc; nobody can tell what depends on what.
- Fix: extract an explicit `bootSequence()` state machine (async function or small orchestrator module) with named, ordered phases: `interceptMigration → openDB → awaitYjs → initSync → registerDevice → startHeartbeat → hydrate → backgroundTasks(driveScan, checkpointGC)`. App.tsx becomes a thin renderer of boot status. Make "halt" a returned state, not an early-return inside an effect.

### D2. Busy-wait polls in the boot path — **high / correctness**
- Evidence: App.tsx:271-274 polls `useBookStore.getState().books` every 100ms up to 10 attempts; an empty library always eats the full 1s timeout and a populated-but-slow sync silently proceeds anyway. `waitForServiceWorkerController` (src/lib/serviceWorkerUtils.ts:12-28) is also poll/timeout based and **never rejects** — the `catch` + `setSwError` path in App.tsx:110-113 is effectively dead code, so the "Service Worker failed" UI (App.tsx:326-341) is unreachable while the SW gate is actually soft (timeout → proceed without controller).
- Impact: +1s cold start for new users; misleading dead error UI; "wait for store hydration" by polling is fragile against timing changes (the same pattern caused the Yjs race tests elsewhere in the repo).
- Fix: replace book-poll with an explicit hydration signal from the Yjs bridge (promise resolved by the middleware after first replication, as `waitForYjsSync` already does for the doc). Either make the SW wait genuinely fail (reject on timeout) and keep the error UI, or delete the error UI and document the soft gate.

### D3. GlobalSettingsDialog is a 718-line god container with a half-finished presenter split — **high / architecture**
- Evidence: 20+ `useState` hooks and subscriptions to 10 stores (GlobalSettingsDialog.tsx:61-238); owns handlers for backup (320-342), CSV import (377-427), DB repair (269-291), metadata regeneration (293-318), checkpoints (429-439), Firebase config (362-375), GenAI logs (346-360). Tabs receive 15-25 props each (e.g., TTSSettingsTab gets 19 props, lines 540-564) — yet `SyncSettingsTab` ALSO imports 5 stores/services directly (SyncSettingsTab.tsx:18-47, 100-120), `DiagnosticsTab` is fully self-contained, and the `devices`/`dictionary` tabs are inline JSX (642-681). Leftover AI artifacts: `{/* ... (existing imports) */}` in rendered JSX (GlobalSettingsDialog.tsx:503), `// ... inside component ...` (SyncSettingsTab.tsx:99). `RecoverySettingsTab` is always passed `recoveryStatus={null}` (line 654) — vestigial prop. Tests must mock ~15 modules to render it (GlobalSettingsDialog.predictability.test.tsx:6-38).
- Impact: every settings change touches the god file; two contradictory patterns (props-drilled vs self-contained tabs) mean contributors guess; the dialog subscribes to TTS/GenAI/sync stores app-wide even when closed (it is always mounted in RootLayout.tsx:18).
- Fix: pick the self-contained-tab pattern (DiagnosticsTab is the model): each tab owns its state/handlers and store access; the container shrinks to tab registry + navigation + `useNavigationGuard`. Lazy-render tab content on activation (already conditional) and lazy-mount the dialog body when `isGlobalSettingsOpen`. Define a `SettingsTab` registration type (`{id, label, component, danger?}`) so adding a tab is one entry.

### D4. CompassPill: 828-line seven-variant god component masquerading as a design-system primitive — **high / architecture**
- Evidence: `src/components/ui/CompassPill.tsx` declares `variant: 'active'|'summary'|'compact'|'annotation'|'sync-alert'|'audio-triage'|'vocab-triage'` (line 26); imports 5 stores + Chinese dictionary + section-duration hooks (lines 2-9); takes `rendition?: any` (line 38) and reads epub.js internals `rendition.manager?.getContents()` (lines 259-268); mutates annotations directly (275-288); contains a Chinese vocab-tile sub-feature with compound-word lookup (lines 42-159, 672-755); communicates with ReaderView via a window CustomEvent (line 320 → ReaderView.tsx:913). Its sibling render-site, ReaderControlBar (267 lines), re-derives variant priority logic (ReaderControlBar.tsx:92-112) and is itself mounted globally in RootLayout while never receiving `rendition` (RootLayout.tsx:21 renders `<ReaderControlBar />`), so the audio-triage selection-refinement path is dead in the only live mount. Three test files (686 lines) pin its behavior, two of which are single-bug regression files (`CompassPill_Accessibility`, `CompassPill_NoteRecall`).
- Impact: a "ui/" primitive that depends on the reader, TTS, annotations, vocabulary, and Chinese dictionary inverts the design-system layering; any reader/TTS refactor breaks "ui"; variants can't be reasoned about independently; dead `rendition` code path invites false confidence.
- Fix: split into a dumb `Pill` shell primitive (layout, blur, progress bar) in `ui/`, plus per-variant feature components colocated with their feature (reader: ActivePill/CompactPill/AnnotationBar; sync: SyncAlertPill; chinese: VocabTriagePanel; notes/audio: AudioTriagePill). Replace the `reader:chapter-nav` CustomEvent with a store action or callback prop. Move variant-priority selection into one place (the control bar) and delete the dead `rendition` plumbing or pass a real rendition.

### D5. Per-device UI state (`activeContext`) is synced via Yjs; Notes view is not addressable — **high / correctness**
- Evidence: `activeContext: 'library' | 'notes'` lives in the SYNCED section of `usePreferencesStore` (usePreferencesStore.ts:29, store wrapped in `yjs()` middleware, line 89); LibraryView switches views on it (LibraryView.tsx:499, 638). Routes are only `/` and `read/:id` (App.tsx:38-74).
- Impact: switching to Notes on the phone flips the desktop's library view next sync — cross-device UI flapping; Notes has no URL (no deep-link, no back-button semantics from the router; back behavior must be re-implemented via the guard store); refresh on Notes is governed by remote state.
- Fix: make Notes a route (`/notes`), delete `activeContext` from synced preferences (data migration: ignore the key on read; Yjs key can be left orphaned or pruned by the existing schema-migration machinery). Per-device view prefs that should persist belong in localStorage, not the CRDT.

### D6. Three overlapping modal abstractions with backwards documentation — **medium / duplication**
- Evidence: `ui/Modal.tsx` (full shadcn-style Radix Dialog parts), `ui/Dialog.tsx` (a 54-line *props-based* wrapper around Modal), `ui/Sheet.tsx` (same Radix primitive, side-drawer). 12 files consume Dialog, 8 consume Modal, and `ReadingListDialog.tsx` imports **both** (lines 2-4). `ui/README.md` describes the relationship inverted: "Modal.tsx: A higher-level wrapper around Dialog" (README line for Modal), and claims Tabs is used "in Global Settings" when the settings dialog actually uses a hand-rolled Button sidebar (GlobalSettingsDialog.tsx:491-524) and Tabs' only consumer is TOCPanel.
- Impact: contributors pick one of two APIs arbitrarily; styling/accessibility fixes must be applied twice; the README actively misleads.
- Fix: keep Modal (compound parts) as the single primitive; reduce Dialog to a documented convenience built on it (or inline its 12 call sites and delete it); rewrite `ui/README.md` from reality.

### D7. Single-slot toast store loses messages — **medium / correctness**
- Evidence: `useToastStore` overwrites `{message,type}` on every `showToast` (useToastStore.ts:39) with 81 call sites; concurrent toasts (e.g., StorageFullError from the unhandledrejection handler at App.tsx:126 racing a sync toast from SyncToastPropagator) silently replace each other. ToastContainer renders inside RootLayout (RootLayout.tsx:20), so toasts fired during boot (before `dbStatus==='ready'`) are never displayed.
- Impact: dropped error notifications — the QuotaExceeded path exists precisely because storage failures matter; users can miss the only signal.
- Fix: queue-based store (array of toasts with ids, stacked rendering, per-toast timers — Toast.tsx's pause-on-hover logic already exists and ports cleanly); render ToastContainer outside the router gate (next to `RouterProvider` in App.tsx).

### D8. Native `confirm()`/`alert()` for destructive flows, inconsistently with the design system — **medium / hygiene (UX-correctness adjacent)**
- Evidence: 18 `confirm(` and 7 `alert(` call sites in shipped code, including data-destroying ones: clear-all-data (GlobalSettingsDialog.tsx:241), DB reset (App.tsx:303), orphan pruning (GlobalSettingsDialog.tsx:276), workspace deletion (SyncSettingsTab.tsx:165), backup restore (GlobalSettingsDialog.tsx:442), annotation delete (AnnotationCard.tsx:23). Meanwhile dedicated confirm dialogs exist for other flows (DeleteBookDialog, OffloadBookDialog).
- Impact: `confirm()` is blocked/ugly in some WebViews, not themeable, not testable with the rest of the suite, and bypasses `useNavigationGuard` (hardware back during a native confirm is undefined); two confirmation idioms coexist.
- Fix: one `useConfirm()` promise-based hook + `ConfirmDialog` built on Modal; codemod all 18 sites; ESLint `no-alert` to lock it in.

### D9. Dead code: `src/components/audio/` HUD, App.css template boilerplate, ThemeSynchronizer 'custom' branch, swError UI — **medium / dead-code**
- Evidence: `AudioReaderHUD.tsx` has zero importers (grep: only itself); `SatelliteFAB.tsx` is only imported by the dead HUD (plus its own test, SatelliteFAB.test.tsx, which keeps it green and invisible). `src/App.css` is untouched Vite scaffold (logo spin keyframes, `.logo` classes) still imported by App.tsx:27. `ThemeSynchronizer.tsx:21-27` handles `currentTheme === 'custom'`, unreachable per the store type `'light'|'dark'|'sepia'` (usePreferencesStore.ts:19). The swError screen (App.tsx:326-341) is unreachable per D2.
- Impact: dead feature code with passing tests is the worst kind — it looks alive, gets maintained, and confuses the duplicate-pill question (HUD vs ReaderControlBar both render CompassPill fixed-bottom; only one is mounted).
- Fix: delete `components/audio/` (or wire it up if it was meant to replace ReaderControlBar — git history suggests it's a superseded parallel implementation), delete App.css contents, drop the unreachable branches.

### D10. Clear-all-data duplicates DB schema knowledge in the UI layer — **medium / correctness**
- Evidence: `handleClearAllData` (GlobalSettingsDialog.tsx:240-267) hand-lists eight object stores (`static_manifests`, `static_resources`, ..., `cache_tts_preparation`) and calls `localStorage.clear()`; `App.tsx:302-314` separately implements reset as `deleteDB('EpubLibraryDB')` with a hardcoded DB name. Neither clears the same surface (one clears stores + localStorage, the other deletes the DB wholesale; neither mentions checkpoints DB or y-idb persistence explicitly).
- Impact: adding an object store requires remembering to update a settings dialog; the two reset paths diverge — "Clear All Data" and SafeMode "Reset Database" do different things, risking partial wipes (data-loss/corruption adjacent).
- Fix: single `dbService.eraseEverything()` (and `DB_NAME` constant) owned by the persistence layer; both UI entry points call it.

### D11. Logger duality and 115 raw console call sites — **medium / hygiene**
- Evidence: `src/lib/logger.ts` exports both legacy `Logger` singleton (manual context arg, lines 34-86, zero non-test importers found for the `import { Logger }` form) and `createLogger` (45 importers). 115 raw `console.*` calls remain in non-test src (e.g., RecoverySettingsTab.tsx:38,55,71; SyncSettingsTab.tsx:130-201; main.tsx:126,130; ReaderTTSController.tsx:54-147).
- Impact: log-level filtering (`VITE_LOG_LEVEL`) doesn't apply to a third of the codebase; the dead legacy API invites new misuse.
- Fix: delete `GlobalLoggerService`/`Logger`; codemod raw console calls to `createLogger`; ESLint `no-console` (allow in logger.ts/sw).

### D12. Verification/test hooks and store handles shipped on `window` in production — **medium / security**
- Evidence: main.tsx:34-112 unconditionally assigns `window.useTTSStore`, `window.useAnnotationStore`, `window.useGoogleServicesStore`, `window.useReaderUIStore`, plus `__ttsWorkerSmokeTest`/`__ttsWorkerHandleTest` which can boot workers and drive the TTS engine. No `import.meta.env.DEV` guard.
- Impact: any injected script (or browser-extension content script) gets first-class handles to mutate user data stores including Google services config (`googleClientId`) — needless attack surface; also dead weight in the prod bundle.
- Fix: gate behind `if (import.meta.env.DEV || import.meta.env.VITE_E2E)`; move the smoke-test bodies into a lazily-imported dev-only module.

### D13. Back-navigation registry: ties are unspecified and browser-back swallows one handler per pop — **medium / correctness**
- Evidence: `registerHandler` sorts by priority only (useBackNavigationStore.ts:52-55) — equal-priority handlers (two open MODALs) execute in registration order, not stack (most-recent-first) order, so back can close the *bottom* modal first. `Array.prototype.sort` stability makes earliest-registered win among equals. `BackNavigationManager.shouldBlock` blocks on *any* handler regardless of priority (BackNavigationManager.tsx:61-75) despite the comment saying DEFAULT-priority handlers shouldn't block; `useNavigationGuard` re-registers on every render if `handler` isn't memoized (useNavigationGuard.ts:22 deps include `handler`), which reorders equal-priority entries over time.
- Impact: wrong overlay closes on hardware back when two same-priority surfaces are open; subtle ordering bugs appear/disappear with render timing.
- Fix: sort by `(priority desc, registrationSeq desc)` with a monotonically increasing seq; stabilize handlers via a ref inside `useNavigationGuard` so identity changes don't re-register; honor the documented "priority > DEFAULT" blocking rule.

### D14. Settings tabs' theme typing is structurally duplicated and drifts — **low / type-safety**
- Evidence: `'light'|'dark'|'sepia'` literal union re-declared in ThemeSelector.tsx:5-6, GeneralSettingsTab.tsx:6 (`ThemeType`), usePreferencesStore.ts:19,40, DeviceProfile (`theme` in profile built at App.tsx:247); ThemeSynchronizer additionally handles a `'custom'` value outside the union. `BookNotesBlock.tsx:64` casts `book as any` into BookCover and passes no-op `onDelete/onOffload/onRestore` to satisfy an over-demanding prop contract.
- Impact: adding a theme touches 5 files; `as any` hides a real interface mismatch (BookCover demands action handlers a read-only context doesn't have).
- Fix: export one `Theme` type from the preferences store; give BookCover optional action props or a `readOnly` variant.

### D15. Test sprawl pins implementation details of shell components — **low / testing**
- Evidence: per-bug test files: `CompassPill_Accessibility.test.tsx`, `CompassPill_NoteRecall.test.tsx`, `GlobalSettingsDialog.predictability.test.tsx`, `ReadingListDialog.empty.test.tsx`, `App_Capacitor.test.tsx`, `App_SW_Wait.test.tsx` (the latter two living at `src/` root); hook test sprawl `use-local-storage*.test.*` — 7 files for one hook. The GlobalSettingsDialog tests mock every store module wholesale (predictability.test.tsx:6-38), so any container refactor breaks them even when behavior is preserved.
- Impact: refactors of D1/D3/D4 will be fought by tests that encode current structure, not behavior.
- Fix: when restructuring, fold per-bug files into behavior-oriented suites colocated with the new components; prefer rendering with real stores (zustand is cheap to instantiate) over module mocks.

## Problematic couplings

- **RootLayout → reader feature**: the app shell imports `ReaderControlBar` from `components/reader/` (RootLayout.tsx:2,21), mounting reader/TTS/annotation logic (and a global `LexiconManager`, ReaderControlBar.tsx:259) on every route including the library. Shell should not depend on a feature; the pill bar should be contributed by features.
- **ui/ → feature stores**: `ui/CompassPill.tsx` imports `useTTSStore`, `useReaderUIStore`, `useAnnotationStore`, `useBookStore`, `useVocabularyStore`, `useChineseDictionary` (CompassPill.tsx:2-9) — design-system layer depends on five feature domains.
- **CompassPill ↔ ReaderView via window CustomEvent** `'reader:chapter-nav'` (CompassPill.tsx:320, ReaderView.tsx:913) — invisible global channel.
- **Data layer → UI store**: `store/yjs-provider.ts:71` calls `useUIStore.getState().setObsoleteLock(true)` — sync internals write UI state directly (works, but the dependency direction should be an event/callback the shell subscribes to).
- **App.tsx → sync/drive/device/TTS internals**: boot directly drives `MigrationStateService`, `CheckpointService`, `FirestoreSyncManager`, `DriveScannerService`, `useDeviceStore`, `useTTSStore.initialize()` (App.tsx:29-31, 198-244) — shell knows every subsystem's startup recipe.
- **GeneralSettingsTab → library feature** (`ImportProgressUI`, GeneralSettingsTab.tsx:4) and **GlobalSettingsDialog → reader feature** (`TTSAbbreviationSettings`, `LexiconManager`, GlobalSettingsDialog.tsx:15-16): settings shell imports feature UIs directly rather than features registering settings panels.
- **ErrorBoundary → sync/migration**: ErrorBoundary.tsx:5-6 special-cases `MigrationStateService`/`CriticalMigrationFailureView`; generic error infrastructure hardcodes one feature's failure mode.

## What's good (keep)

- **The back-navigation design**: a priority registry (`useBackNavigationStore`) + one bridge component (`BackNavigationManager`) + a tiny hook (`useNavigationGuard`) is the right shape for unifying Android hardware back, browser back, and overlay dismissal. Fix the tie-break, keep the architecture.
- **The shadcn-style primitives** in `ui/` (Button/Input/Select/Sheet/Popover/DropdownMenu/Progress/Switch/Slider/Badge/Tabs/ScrollArea/PasswordInput): thin, consistent, Radix-based, CSS-variable themed, accessible (aria labels, focus rings throughout). This is a solid design-system foundation.
- **`useSidebarState`'s documented rationale** (useSidebarState.ts:13-26): store-based panel state with an explicit back-guard, including the WebKit history-race explanation — a model comment for why a design exists.
- **The migration boot interceptor concept** (halt sync on `AWAITING_CONFIRMATION`, rollback on `RESTORING_BACKUP`, zombie checkpoint GC) is the right safety posture — it just needs to live in an explicit sequencer (D1).
- **Settings tab presenters** Recovery/DataManagement/General/Diagnostics are clean, prop-driven or self-contained, well-labeled, accessible — the extraction direction was correct, just unfinished.
- **ObsoleteLockView** as a non-dismissible schema lock protecting migrated cloud data from stale clients — sound local-first guard (restyle it with the design system, keep the behavior).
- **notes/ decomposition** (View → Block → Card + grouping hook with memoized rendering) is appropriately sized and a good template for other features.
- **ScopedLogger** (`createLogger`) with env-based level filtering — keep this half, delete the legacy half.
- ErrorBoundary offering the Data Recovery tool from the crash screen is genuinely user-protective.

## Target design

1. **Boot**: `src/app/boot.ts` — explicit, testable async sequencer producing typed phases (`'migration-halt' | 'restoring' | 'loading' | 'ready' | 'failed'`); `App.tsx` ≤100 lines rendering on boot state. Subsystems register their own startup tasks (`registerBootTask({phase, run})`) so App stops importing sync/drive/TTS internals.
2. **Routing**: route table in `src/app/routes.tsx`: `/` (library), `/notes`, `/read/:id`, `/settings/:tab?` (the settings dialog driven by URL, preserving deep-linking and back semantics; the navigation-guard keeps hardware-back closing it). Lazy route elements for reader and settings.
3. **Shell layout**: RootLayout renders only shell concerns (theme sync, toasts, back manager, outlet) plus a `GlobalOverlayOutlet` into which features mount their persistent UI (the pill bar registers from the reader/TTS feature, not from the layout).
4. **Settings**: registry-based — features export `SettingsPanel` descriptors `{id, label, icon, component, order, danger}`; the dialog is a dumb shell with sidebar + lazy panel mount + per-panel error boundary. All panels self-contained (DiagnosticsTab pattern). One confirm abstraction (`useConfirm`) replaces native dialogs.
5. **Design system**: `ui/` may import only `lib/utils` and Radix — enforced with an ESLint boundary rule (`import/no-restricted-paths`). CompassPill split per D4 into `ui/Pill` + feature pills. Modal is the single dialog primitive; Dialog becomes a thin documented convenience or is removed; Toast becomes a stacked queue.
6. **State boundaries**: `useUIStore` grows into the shell UI store (settings-open, obsolete-lock, overlay registry); ephemeral per-device prefs (activeContext, view modes if desired) move out of the Yjs doc into localStorage-backed store slices.
7. **Logging/hygiene**: single `createLogger` API, `no-console`/`no-alert` lint rules; `lib/constants.ts` either becomes the real shared-constants home (DB names, route paths, z-index scale) or is dissolved.

## Migration notes

Ordering chosen so each step ships independently without breaking users:

1. **Zero-risk deletions first**: `components/audio/` (HUD+FAB+test), App.css boilerplate, `Logger` singleton, ThemeSynchronizer `'custom'` branch, vestigial `recoveryStatus` prop, AI comment artifacts. No data impact.
2. **Boot sequencer (D1/D2)**: pure refactor of App.tsx; preserve exact current ordering initially (migration interceptor before sync init before hydration), then replace the book-poll with a hydration promise from the Yjs bridge. Guard with the existing `App_SW_Wait`/`App_Capacitor` tests rewritten against boot states rather than render internals. No persisted-data changes.
3. **Toast queue (D7)**: additive store change — keep `showToast` signature, change internals to a queue; move ToastContainer above the router gate.
4. **Confirm dialog (D8)**: introduce `useConfirm`, migrate the destructive sites first (clear-all, restore, workspace delete), then the rest; add `no-alert` lint.
5. **Settings registry (D3)**: convert one tab at a time to self-contained (Sync and Devices already are in practice); the container shrinks incrementally; finally swap the hand-rolled sidebar for the registry. URL-driven `/settings/:tab` last (pure addition; keep `useUIStore.isGlobalSettingsOpen` as a shim that navigates).
6. **CompassPill split (D4)**: extract `ui/Pill` shell; move variants out one at a time starting with the self-contained ones (sync-alert, summary, compact), ending with annotation/vocab-triage; replace the CustomEvent with a `useReaderUIStore` action when ReaderView's listener is migrated. ReaderControlBar's variant-priority switch becomes the single dispatcher. Keep `data-testid`s stable so Playwright journeys survive.
7. **Notes route + activeContext de-sync (D5)**: add `/notes` route rendering GlobalNotesView; LibraryView's Select navigates instead of writing the preference. **Data migration**: stop reading/writing `activeContext` from the Yjs preferences map; leave the orphaned key in place (harmless) or prune it in the next schema-version bump via the existing migration machinery — never repurpose it, since old clients still write it.
8. **Clear-all unification (D10)**: implement `dbService.eraseEverything()` enumerating stores from the schema definition; point both App.tsx reset and the settings Danger Zone at it; verify in an integration test that a post-wipe boot lands in the empty-library state (this is the data-loss-sensitive step — test against a populated fixture DB including checkpoints and y-idb data).
9. **window-handle gating (D12)**: wrap main.tsx exposures in a DEV/E2E env check; update Playwright config to set the env flag. Verify the production bundle drops the hooks (the repo already has a bundle analyzer wired for main + TTS worker chunks).
10. **Lint enforcement last**: ESLint boundary rules (`ui/` import whitelist, `no-console`, `no-alert`) once the codemods are done, so CI locks the new shape in.
