# Phase 8 design — shell, settings, a11y/i18n choke points, PWA/build finishers

**Read at HEAD:** `2de2c597c22c131c5c47f9f6817d334ec0dd1a2b` (branch `claude/amazing-davinci-d7336e`,
2026-06-12 — `feat(net): TTS providers route through egress()`).
**Geography warning for the implementing agent:** this doc was prepared while TWO chains
are actively committing: **P6 (reader)** on the main tree (recon in progress: ReaderEngine
port, HighlightLayerManager, ReaderCommands, kernel/cfi adoption) and **P7 T1/T2
(library/search)** on a worktree (LibraryService, libraryViewStore, LibraryView rewrite).
Both move files this phase touches — `ReaderView.tsx`, `ReaderControlBar.tsx`,
`CompassPill.tsx` consumers, `LibraryView.tsx`, `selectors.ts`. **Every line number below is
HEAD-of-2026-06-12 truth; re-run the §Reality-check greps at execution entry and re-measure
the two "re-measure" items (§RC-4, §RC-5) before trusting scope.**

Inputs: `plan/overhaul/README.md` §Roadmap P8 + §Program rules;
`proposals/strangler-incremental.md` §Phase 8 (:641-656), seam catalog §G/§H, risk #11;
`analysis/app-shell-ui.md`; `analysis/gap-accessibility-keyboard-screen-.md`;
`analysis/gap-internationalization-string-ex.md`; `docs/adr/0001-i18n-strategy.md`;
`prep/phase7-library-google.md` §I (CSP split) + §Follow-ups; `prep/phase5-tts-strangler.md`
§Follow-ups (piper runtime caching, settings-registry provider panel); the CURRENT tree.

---

## Reality check

The three analyses (2026-06-10, written against `3b0cfcff`) describe a tree five phases old.
Everything below is re-verified at `2de2c597`.

### Shell / routing / boot

1. **Boot is sequenced; the route-splitting precondition is MET.** `App.tsx` is 98 lines
   rendering boot states (`src/App.tsx:21-96`); ordering lives in `src/app/bootstrap.ts` +
   `src/app/boot/registerBootTasks.ts` (the one file allowed to import subsystem boot
   modules). Strangler §D's "safe only now that side effects are gone" gate is satisfied —
   no module-scope subsystem boot remains. Residual: `src/main.tsx:58-144` still assigns
   store handles + two TTS verification hooks to `window` UNGATED in prod (analysis D12
   half-open; the `window.useTTSStore` shim is explicitly P9-retired per its own comment,
   `main.tsx:14-17` and phase5 §Follow-ups). P8 must not break those Playwright consumers.
2. **Routes at HEAD: `/` and `read/:id` only** (`src/app/routes.tsx:12-47`), both EAGER
   static imports (`LibraryView`, `ReaderView` at :7-8). No `/notes`, no `/settings/:tab`.
   Notes is still a synced-preference view switch (RC-10).
3. **Firebase is in the entry static closure.** `src/app/sync/createSync.ts:31` statically
   imports `FirestoreBackend` (→ `firebase/firestore`, `firebase/auth`);
   `registerBootTasks.ts` statically imports `syncInit` → createSync; only `MockBackend` is
   dynamic (`createSync.ts:137`). Google/GenAI: `wireGoogleDomain` is statically wired at
   registration time (`registerBootTasks.ts:31`, `src/app/google/wireGoogle.ts`). epubjs
   rides the eager `ReaderView` import. These are the three first-use dynamic-import
   targets. What 5c already shed: the 2,899-line Bible TS file became lazy JSON — **~85 KB
   off the entry chunk** (`c0121e54`), pinned by check 3 of
   `scripts/check-worker-chunk.mjs:212-273`, which ALREADY computes the entry static closure
   (`collectStaticClosure` :239-257 against `index-*.js` :257) — the P8 budget check extends
   this script rather than inventing a new walker.
4. **CompassPill at HEAD: ALL SEVEN variants still live in `ui/`** —
   `src/components/ui/CompassPill.tsx:27` declares
   `'active'|'summary'|'compact'|'annotation'|'sync-alert'|'audio-triage'|'vocab-triage'`;
   the file is 830 lines (was 828). The strangler's split ("audio pills with Phase 5, vocab
   triage with Phase 6, annotation/sync with Phase 8", strangler :331-334) has moved
   **nothing** — P5 shipped without touching CompassPill. The `reader:chapter-nav`
   CustomEvent is alive (`CompassPill.tsx:322` → `ReaderView.tsx:912-913`); ReaderControlBar
   still re-derives variant priority (`ReaderControlBar.tsx:93-112`) and still remounts the
   pill via `key={variant}` (`:236` — the focus-destroying remount, a11y item 8).
   **RE-MEASURE at entry:** P6 owns vocab-triage (chinese module) + ReaderCommands; whatever
   it actually moves shrinks P8's §C scope.
5. **GlobalSettingsDialog: 742 lines** (was 718), 9 tabs as hand-rolled sidebar Buttons
   (`GlobalSettingsDialog.tsx:514-542` — no tablist semantics, a11y item 7), content
   conditionals at :549-732. `DiagnosticsTab` is fully self-contained (imports only
   `useAudioCommands` + ui primitives — `DiagnosticsTab.tsx:1-27`) — the model. The
   provider-settings panel must render from the 5a ProviderDescriptor registry (phase5
   §Follow-ups P8 row). **RE-MEASURE:** P7-A5 already moved GenAI log/consent surfaces.
6. **Toast: single-slot store unchanged** (`src/store/useToastStore.ts:34-41`; 41 lines);
   **81 `showToast(` call sites** at HEAD (same count as the analyses). New since the
   analyses: `src/app/sync/wireSyncEvents.ts` is THE single sync-domain presentation
   subscriber (P4 §D3; domains-side toast-import ban at error) — the key-based migration has
   one choke point for all sync copy. `ToastContainer` still mounts inside `RootLayout`
   (`RootLayout.tsx:20`), i.e. BELOW the router gate — boot-time toasts are dropped.
7. **Native dialogs: 12 `confirm(` + 7 `alert(` sites** (analyses said 18+7 / "24" — P3/P4
   deletions shrank it). Destructive ones include `App.tsx:26` (reset-all in the SafeMode
   path) and `App.tsx:36` (alert), workspace deletion in `SyncSettingsTab`, clear-all-data
   in `GlobalSettingsDialog`. No `useConfirm` exists anywhere yet.
8. **Keyboard: both window registries still alive.** `useReaderNavigation.ts:115` +
   `ReaderTTSController.tsx:220`. The P0 interim predicate sits at
   `useReaderNavigation.ts:92-99` and **names this phase**: "Interim mitigation until the
   Phase 8 KeyboardShortcutService replaces both." TTS status now reads from the 5b
   `useTTSPlaybackStore` (:96). The structural home must absorb: window listener + rendition
   bridge (`:118-121`), `e.repeat` guard (:79), input-field guard (:82-90), and the
   TTS-active scope the predicate fakes.
9. **`kernel/locale/` already exists** — but contains only `segmenterCache.ts` (moved in
   P3-4). The formatter module lands beside it (README geography: kernel = "locale/
   formatters"; the gap report's `lib/locale/` address is superseded). **16 `toLocale*`
   sites** at HEAD (re-counted; same total, moved lines): `ReadingListDialog.tsx:59`,
   `SyncStatusPanel.tsx:86`, `ReadingHistoryPanel.tsx:120-121`, `AnnotationList.tsx:112`,
   `RecoverySettingsTab.tsx:119`, `GenAISettingsTab.tsx:260`, `DiagnosticsTab.tsx:85,177`,
   `RemoteSessionsSubMenu.tsx:72`, `AnnotationCard.tsx:113`, `SyncPulseIndicator.tsx:59`,
   `DriveImportDialog.tsx:77`, `DeviceList.tsx:85`, `export-notes.ts:5,12`. Three
   relative-time impls (`DeviceList.tsx:80-86`, `DriveImportDialog.tsx:12-24`,
   `SyncPulseIndicator.tsx:59`) and the byte-size copies (`BookListItem.tsx:31-37` + 4
   ad-hoc) are all current. `index.html:2` still `lang="en"`; zero `documentElement.lang`
   writes; zero `lang=` JSX attributes.
10. **`activeContext` is still a SYNCED preference** (`usePreferencesStore.ts:28,83`, in
    `syncedKeys` :122) and `LibraryView` still switches on it (:490,503,550,629). Removal
    interacts with RC-17 (version ledger).

### PWA / build / CSP / fonts

11. **Single manifest is ALREADY TRUE.** `public/manifest.webmanifest` died in P1; the only
    manifest is VitePWA's (`vite.config.ts:184-201`). What P8 actually does is *verify* +
    finish it. **Net-new finding:** `includeAssets: ['favicon.ico', 'apple-touch-icon.png',
    'mask-icon.svg']` (`vite.config.ts:183`) references files that DON'T EXIST — `public/`
    has `favico.ico` (typo), no apple-touch-icon, no mask-icon. The manifest also lacks
    `lang`/`dir`/`id`.
12. **SW update flow is abrupt by construction:** `registerType: 'autoUpdate'`
    (`vite.config.ts:174`) + `self.skipWaiting()` (`src/sw.ts:11`) + `clientsClaim()`
    (:12). No `virtual:pwa-register` usage anywhere — registration is implicit. The
    prompt-style flow is greenfield.
13. **The SW boot gate is already soft, and its error UI is dead code** — verified:
    `waitForServiceWorkerController` (`src/lib/serviceWorkerUtils.ts`) returns (never
    rejects) on both the 3 s `ready` timeout and controller-poll exhaustion, so
    `useServiceWorkerGate`'s `swError` (`src/app/boot/useServiceWorkerGate.ts:22-25`) and
    App's "Critical Error" screen (`App.tsx:50-65`) are unreachable. The gate's own
    docstring ("surfaces a dedicated critical-error screen if the wait fails") is wrong.
    P8 makes the softness honest (delete the dead screen, document the degradation) rather
    than inventing a hard gate.
14. **Runtime caching gaps at HEAD's vendored paths:** precache covers only
    `**/*.{js,css,html}` (+ `globIgnores` excludes `**/piper/onnxruntime/*.wasm`,
    `vite.config.ts:181`; 4 MB cap :176). NOT cached anywhere: `/fonts/*.ttf` (388 K + 476 K),
    `/dict/cedict.json` (**14 MB** — over the cap even if globbed), `/piper/onnxruntime/*.wasm`
    (~10 MB each) + `.data` files. Piper VOICE MODELS (HF downloads via
    `egress('hf-piper-models')`) are already runtime-cached by `PiperRuntime` itself in
    Cache Storage `'piper-voices-v1'` (`PiperRuntime.ts:31,187-207`) — Workbox routes must
    NOT double-cache those. `cleanupOutdatedCaches()` (sw.ts:9) only touches workbox
    precache names — safe. The cover route fetch-handler (`sw.ts:16-25`) must survive
    untouched (P3 sw-contract).
15. **CSP strict flip: the wildcard is documented and located.** `src/kernel/net/csp.ts`
    renders the policy from the registry; the legacy `https:` scheme wildcard sits in
    `connectSrcSources()` (:49, comment "dropped at the P8 strict flip") and in `img-src`
    (:40); the header comment (:18-24) records the deliberate P7/P8 split and the gate:
    "after Piper offline behavior is verified." Copies fed by the one renderer:
    `nginx.conf` (via `scripts/generate-csp.mjs`, committed output), vite preview headers
    (`vite.config.ts:157`), build-time `index.html` meta (`cspMetaPlugin`,
    `vite.config.ts:22-33`). The registry==CSP test (`src/kernel/net/csp.test.ts`) pins all
    copies. **What the flip can break, per the registry** (`destinations.ts`): nothing that
    routes through `egress()` — every fetch-mediated host is enumerated (`gemini`,
    `google-tts`, `openai-tts`, `lemonfox-tts`, `hf-piper-catalog`, `hf-piper-models`,
    `drive`, `google-oauth`, `firebase`); `cdnjs-onnxruntime` was deleted when 5a vendored
    the runtime. The two real hazards: (a) **BYO-Firebase `authDomain`** — the `firebase`
    entry's hosts include the *user-configured* authDomain only as the current build/device
    knows it (P7 risk #4): nginx + the build-time meta cannot enumerate another user's
    project host; (b) **remote EPUB resources in the reader iframe** — `img-src https:`
    currently lets un-sanitized remote images load; the P7 sanitizer rewrite (tracking-pixel
    fixture) is the functional replacement, and it ships with P6/P7's sanitizer work —
    verify it landed before dropping `img-src https:`.
16. **Fonts: the OFL violation is inventoried, and the "persisted preference" turns out to
    be (almost) vacuous.** `third-party/inventory.json:38-44` records the modified PT Sans
    Narrow Web TTFs as a KNOWN OFL-1.1 RFN violation (name table, filenames,
    `src/index.css:3,10` family, `.font-pinyin` :281-282) and notes the fonttools
    glyph-injection script is NOT in the repo (derivative unreproducible). Crucially: the
    synced `fontFamily` preference only ever takes `'serif'|'sans-serif'|'monospace'` from
    the UI (`VisualSettings.tsx:214-216`); `'PT Sans Narrow'` is reachable only through CSS
    class + @font-face, never stored per-user by any shipped UI. The README rule-4 ledger
    slot "font-preference rename (P8)" therefore over-provisions: a defensive read-time
    value normalization suffices (§Design I); **no CRDT bump**.
17. **CRDT version ledger at HEAD:** current v6 (`src/app/migrations.ts`, registry
    `CRDT_MIGRATIONS`); **v7 is claimed by P7's reading-list `bookId` linking** and the
    husk-clear/dual-write retirement was renumbered to **v8 (P9)** — see
    `prep/phase7-library-google.md` :819-825. P8 owns NO version number: `activeContext`
    leaves `syncedKeys` (write/read stops; the Y.Map husk stays, harmless) and its prune
    rides v8 alongside the v6 preference husks.
18. **Motion: zero `prefers-reduced-motion` anywhere** (`App.css` and `tailwind.config.js`
    were deleted in P1 — the only query died with the boilerplate). `tailwindcss-animate` /
    `tw-animate-css` still NOT installed — the `animate-in/fade-in/slide-in-*` classes in
    Modal/Sheet/Popover/Toast/CompassPill remain silent no-ops; real always-on motion
    (TTSQueue smooth-scroll `TTSQueue.tsx:79`, `animate-spin/pulse`, `--animate-ping-slow`
    `index.css:53-62`) ignores user preference.
19. **A11y tooling from P0 is live but soft:** jsx-a11y recommended at **warn**
    (`eslint.config.js:89,110` `downgradeToWarn`), vitest-axe in the harness
    (`src/test/harness/axe.ts`), `@axe-core/playwright` spec
    (`verification/test_a11y_axe.spec.ts`). No `no-alert`/`no-console` rules yet. The
    per-directory flip-to-error model (ADR §5 / master plan rule 3) is the P8 mechanism.
20. **i18n ADR is binding** (`docs/adr/0001-i18n-strategy.md`): choke-point APIs take
    `(messageKey, params)`; errors already carry `code` + params (C10 taxonomy,
    `src/types/errors.ts`); the `errors.*` namespace keys 1:1 by code; the catalog must be
    importable from plain TS and the TTS worker; **library choice is deferred to "the phase
    that needs it (Phase 8 at the earliest)"** — §Design D resolves this.
21. **Store registry is the registry pattern to copy** (`src/store/registry.ts` + generated
    README): declarative descriptors, generated docs, lint-enforced single registration
    point. The settings registry (§B) and shortcut registry (§E) clone the shape.
    `useUIStore` is 26 lines (`isGlobalSettingsOpen` + `obsoleteLock`) — it becomes the
    shell-UI store, not a new store.

---

## Design

P8 lands at final addresses (README §2): shell composition in `src/app/`
(routes/settings/shortcuts), primitives in `src/components/ui/` (PillShell, Toast, Confirm),
formatters in `src/kernel/locale/`, SW work in `src/sw.ts` + `vite.config.ts`. Feature pill
variants land in their owning feature dirs (reader/sync/notes), not in `ui/`.

### A. Routes + code splitting + the entry-chunk budget

**Route table** (`src/app/routes.tsx`):

```
/                 → LibraryView (EAGER — it is the boot surface)
/notes            → React.lazy(GlobalNotesView)
/read/:id         → React.lazy(ReaderView)        // pulls epubjs out of entry
/settings/:tab?   → settings registry shell (lazy panels per §B); renders as the
                    existing dialog OVER the current location (background-location
                    pattern) so it stays an overlay, now URL-addressable
```

- Each lazy element keeps its per-route `ErrorBoundary`; a shared `Suspense` fallback
  reuses the boot spinner. Route chunks are precached (they're `*.js`) so offline
  navigation works.
- `/notes`: `LibraryView`'s context `Select` (:490) becomes `navigate('/notes')`;
  `GlobalNotesView` renders under its own route; `setActiveContext`/`activeContext` die
  (§J). **Coordinate with P7-T1, which is rewriting LibraryView** — if the rewrite lands
  first, the navigation change rides `libraryViewStore`; else patch the current file
  minimally.
- `/settings/:tab`: `useUIStore.isGlobalSettingsOpen` stays as a one-release shim whose
  setter navigates (analysis migration note 5); `useNavigationGuard` keeps hardware-back
  closing the dialog (pop = navigate back).
- **First-use dynamic imports** (the heavy half of the entry chunk):
  - *firebase*: `createSync.ts` converts `FirestoreBackend` (+ `lib/sync/firebase-config`
    auth surface) to `await import(...)` inside the existing
    `isFirebaseConfigured()`-guarded path — un-configured users (sync off) never download
    Firestore at all; configured users load it inside the `syncInit` boot task body.
    `MockBackend` already follows this pattern (`createSync.ts:137`).
  - *drive/genai*: `wireGoogleDomain` registers thin lazy facades; `DriveClient`/
    `GenAIClient` feature modules load at first call (drive scan/connect, first GenAI
    feature use). The consent gate + NET codes already make every call async-tolerant.
  - *Constraint*: boot-task MODULES stay statically imported by `registerBootTasks.ts`
    (the C11 manifest); only their heavy dependencies move inside `run()` bodies. No new
    module-scope side effects (depcruise no-side-effect rule).
- **CI entry-chunk budget** — extend `scripts/check-worker-chunk.mjs` (rename to
  `check-bundle.mjs`) with check 4:
  1. *content assertion* (the durable one): the entry static closure
     (`collectStaticClosure([index-*.js])`) contains NO sourcemap sources matching
     `node_modules/firebase`, `node_modules/@firebase`, `node_modules/epubjs`,
     `src/domains/google/genai/`, `src/components/reader/ReaderView` — same mechanism as
     the existing worker/mock purity checks;
  2. *size ratchet*: gzip size of the entry static closure recorded post-split into
     `bundle-baseline.json` (~10 % headroom), never regresses — the number is set AFTER
     PR-7 lands, not invented now (what 5c shed is already pinned content-wise by check 3).

### B. Settings registry with lazy panels (dissolves the 742-line dialog)

`src/app/settings/registry.ts` (store-registry pattern, RC-21):

```ts
export interface SettingsPanel {
  id: SettingsTabId;                       // 'general' | 'tts' | ... (route param)
  labelKey: MessageKey;                    // i18n ADR: keys, not prose
  icon: LucideIcon;
  load: () => Promise<{ default: React.ComponentType }>;  // React.lazy source
  order: number;
  danger?: boolean;                        // data tab styling
}
```

- The shell (`src/app/settings/SettingsShell.tsx`, target <150 lines): Radix `Tabs`
  `orientation="vertical"` over the registry (kills the fake-button tablist, a11y item 7),
  per-panel `ErrorBoundary` + `Suspense`, lazy mount of ONLY the active panel,
  `useNavigationGuard` for hardware back, `/settings/:tab` as the single source of the
  active tab.
- Every panel becomes self-contained on the `DiagnosticsTab` model (RC-5): owns its state,
  handlers, store access; container props die. The handler clusters currently in the god
  file (backup :320s, CSV import, DB repair, metadata regeneration, checkpoints, Firebase
  config, GenAI logs) move INTO their owning panels.
- The TTS provider panel renders from the 5a ProviderDescriptor registry (phase5
  §Follow-ups) — adding a provider stops touching settings code.
- `GlobalSettingsDialog.tsx` is the **named deletion artifact** (rule 2). Its mount leaves
  `RootLayout` (the dialog stops subscribing to ten stores while closed — it becomes a
  route element).
- Deep-link acceptance: `/settings/diagnostics` cold-load opens the dialog on Diagnostics
  over the library.

### C. CompassPill dissolution completion (re-measure first)

At THIS head all 7 variants remain in `ui/` (RC-4). Execution-entry re-measure decides the
remainder; the design regardless:

- `src/components/ui/PillShell.tsx`: dumb layout primitive (pill geometry, blur, progress
  bar, morph-without-remount, focus management on mode entry). No store imports — `ui/`
  goes kernel-only (§L).
- Variants move to owners: `active|summary|compact` → reader/audio feature
  (`components/reader/pills/` until P6's final geography, then `domains/audio/ui/`);
  `annotation` → reader annotations; `sync-alert` → sync UI; `audio-triage` → notes/audio
  feature; `vocab-triage` → chinese module (P6's if it hasn't already taken it).
- `ReaderControlBar` becomes the thin variant ROUTER only (priority switch :93-112 is the
  single dispatcher), stops remounting via `key={variant}` (:236), and — per P6's
  ReaderCommands contract — the `reader:chapter-nav` CustomEvent (`CompassPill.tsx:322`)
  is replaced by `ReaderCommands.nextChapter()/prevChapter()`. If P6 lands ReaderCommands
  first, this is a call-site swap; if P8 reaches the pill first, route through a
  `useReaderUIStore` action as the interim (analysis migration note 6) and let P6 absorb it.
- VocabTile nested-button violation (a11y item 4) dies with the variant move (single
  `<button aria-pressed>` per tile).
- `data-testid`s stay stable — `test_compass_pill.spec.ts`,
  `test_compass_pill_scrubber.spec.ts` and the triage journeys must pass unmodified.
- Exit: `CompassPill.tsx` (830 lines) deleted; its three test files absorbed (§Test plan).

### D. Toast queue + LiveAnnouncer + useConfirm — keyed per the i18n ADR

**The library decision (this phase's call per ADR §6): NO i18n library yet.** P8 ships a
minimal in-repo typed catalog — `src/kernel/locale/messages.ts` exporting a `MessageKey`
union + `formatMessage(key, params)` over a plain `en` record (domain-namespaced keys,
`errors.*` keyed by `APP_ERROR_CODES`). Plain TS module: worker-importable, tree-shakeable,
zero runtime bet. Paraglide/lingui adoption happens when a second locale ships and replaces
only this module's internals — the ADR's constraint list is honored without freezing a
dependency choice three releases early. The choke-point signatures are the contract; the
catalog backend is an internal.

- **Toast queue** (`useToastStore` rewrite, same file): `toasts: Array<{id, content:
  MessageKey | {key, params} | string, type, duration}>`; `showToast(prose)` survives as a
  deprecated overload during migration (81 call sites move opportunistically; the
  `wireSyncEvents.ts` choke point and all NEW call sites use keys). `ToastContainer` moves
  ABOVE the router gate — mounted beside `RouterProvider` in `App.tsx` — into a
  PERSISTENT live-region container (regions pre-exist; content injected — a11y item 10);
  stacked rendering, per-toast timers, pause on hover AND focus-within, longer default for
  `error`. The `toastCapture` harness (`src/test/harness/toastCapture.ts`) is updated in
  the same PR.
- **LiveAnnouncer** (`src/components/ui/LiveAnnouncer.tsx` + `announce()` in
  `src/kernel/locale/` or colocated): two persistent visually-hidden regions
  (polite/assertive) mounted in `RootLayout`; non-React `announce(key|string, {assertive})`
  for stores/services; a small adapter subscribes to `useTTSPlaybackStore` transitions —
  "Playing — {section}", "Paused", "Stopped", chapter changes — debounced, NEVER
  per-sentence (a11y item 2). Toasts share the pipe (visible toast + invisible
  announcement, one source).
- **useConfirm** (`src/components/ui/ConfirmDialog.tsx` + `useConfirm()` promise hook on
  Modal): `confirm({titleKey, bodyKey, params, danger})`. Codemod order: destructive sites
  first (App.tsx reset :26/:36, clear-all-data, workspace delete, backup restore,
  annotation delete), then the remaining 12+7. ESLint `no-alert` + `no-restricted-globals
  [confirm, alert]` flip to ERROR at phase exit (zero exceptions — exit criterion).

### E. KeyboardShortcutService — the P0 predicates' structural home

`src/app/shortcuts/KeyboardShortcutService.ts` (app constructs singletons, rule 8) +
`useShortcut()` registration hook:

```ts
register({ id, key, scope, when?, handler, descriptionKey }): Unregister
// scope stack: 'global' < 'reader' < 'tts-active' < 'overlay'  (top-most active scope wins)
```

- ONE window keydown listener mounted by the shell; ONE rendition/iframe bridge registered
  by the reader feature (through P6's ReaderEngine port — the engine forwards iframe
  keydown into the service, replacing `(rendition as any).on('keydown')` at
  `useReaderNavigation.ts:118-121`).
- Built-in policies (absorbed from the two registries): `e.repeat` guard, input/
  contenteditable target guard, dev-mode collision error on duplicate `(key, scope)`,
  Escape resolves TOP-MOST overlay scope before `tts-active` may stop playback, Space never
  fires when a focusable control has focus.
- Registrants: reader page-turn (scope `reader`), TTS sentence-jump/Space/Escape (scope
  `tts-active`, registered while playing|paused), overlay registrations ride
  `useNavigationGuard` integration. The two ad-hoc listeners
  (`useReaderNavigation.ts:115`, `ReaderTTSController.tsx:220`) AND the interim predicate
  (`useReaderNavigation.ts:92-99`) are the named deletion artifacts.
- `?` opens a generated shortcut-help sheet (from registrations' `descriptionKey`s) — the
  discoverability gap.
- Lint: `no-restricted-syntax` ban on `addEventListener('keydown')` outside
  `src/app/shortcuts/` (test files exempt).
- Acceptance matrix (a11y item 1): one ArrowRight = exactly ONE action in every TTS state,
  focus inside and outside the iframe; Escape with an open sheet closes the sheet, audio
  keeps playing; Space on a focused button activates the button only.

### F. kernel/locale formatters + lang attribution

`src/kernel/locale/` grows (beside `segmenterCache.ts`, whose cached-Intl pattern it
copies):

- `getUILocale()` resolution: per-device preference (localStorage-backed shell store slice
  — NOT the CRDT; readable before the doc loads for boot-path strings) → `navigator.language`
  → `'en'`. A `localeBoot` task sets `document.documentElement.lang` (replacing static
  `index.html:2` semantics) and re-syncs on change.
- `format.ts`: `formatDate/Time/DateTime`, `formatRelativeTime` (Intl.RelativeTimeFormat),
  `formatBytes` (Intl.NumberFormat unit style), `formatPercent`, `formatDuration`,
  `compareTitles` (cached `Intl.Collator(locale, {numeric:true})` — also fixes the bare
  `localeCompare` sorts, I18N-10). Migrate all 16 sites (RC-9); DELETE the three
  relative-time impls + the byte-formatter copies. Lint: `no-restricted-syntax` on
  `toLocale*` outside `kernel/locale/`.
- **Two-locale rule enforced in review** (ADR §4): these formatters take UI locale;
  `book.language` keeps governing segmentation/voices/pinyin — `compareTitles` does NOT
  switch to pinyin collation in this phase.
- `lang={book.language}` on top-document book-text render sites: BookCard title/author,
  TTSQueueItem sentence, TOC labels, notes excerpts (`BookNotesBlock`/`AnnotationCard`),
  dictionary popovers/vocab tiles. **Ownership care:** BookCard/LibraryView belong to
  P7-T1's rewrite and the reader panels to P6 — land `lang` in whichever file version is
  current at execution; it's an attribute, not a structure change. PWA manifest gains
  `lang: 'en'`, `dir: 'ltr'`.

### G. PWA: manifest verification, runtime caching, prompt update, soft gate

- **Manifest:** fix the phantom `includeAssets` (RC-11) — rename `public/favico.ico` →
  `favicon.ico`, generate `apple-touch-icon.png` + `mask-icon.svg` from `assets/logo.png`
  or trim the list to reality; add `lang`/`dir`/`id`; assert ONE manifest link in built
  `index.html` (unit test on `transformIndexHtml` output or a Playwright check).
- **Runtime caching** (in `src/sw.ts`, additive `registerRoute`s — the cover fetch-handler
  :16-25 is untouched):
  - `CacheFirst` `/fonts/*` (cache `versicle-fonts-v1`, ~10 entries) — covers the RENAMED
    font files (§I; route by path prefix so the rename is transparent);
  - `CacheFirst` `/dict/cedict.json` (cache `versicle-dict-v1`) — the 14 MB dictionary
    becomes offline-durable without precache;
  - `CacheFirst` `/piper/*` for the non-precached runtime pieces (onnxruntime `.wasm` +
    `.data`; the `.js` shims are already precached) — closes "offline Piper" (the 5a
    §Follow-ups P8 row); voice models stay in `PiperRuntime`'s own `piper-voices-v1`
    (RC-14) — the Workbox route matches same-origin only, so HF URLs never hit it.
  - All named caches enumerated in `src/data/wipe.ts`'s cache-clearing hook (it already
    clears app caches — verify the new names are covered by its enumeration strategy).
- **Prompt-style update:** `registerType: 'prompt'`; DELETE `self.skipWaiting()` (sw.ts:11;
  `clientsClaim` stays for first-install); register via `virtual:pwa-register`'s
  `useRegisterSW` in a small `SWUpdatePrompt` mounted above the router gate;
  `onNeedRefresh` → persistent (duration ∞) keyed toast with "Reload" action →
  `updateServiceWorker(true)`. The transition is one-way safe: currently-deployed
  autoUpdate SWs activate the first prompt-build immediately (old SW still skipWaiting-s
  **itself** out); from then on updates prompt. `App_SW_Wait.test.tsx` is rewritten for the
  honest soft gate (RC-13): the dead `swError` screen + `useServiceWorkerGate` error state
  are DELETED, replaced by a degraded-mode signal (covers unavailable → keyed toast once),
  and the gate doc-comment is corrected.
- **Soft boot gate:** keep the 3 s race + proceed semantics (it is already the behavior);
  the deletion above just makes the code tell the truth.

### H. CSP strict flip (the P7 §I deferred half)

Sequenced LAST in the phase (privacy note "Do CSP last"), gated on §G's piper runtime
caching shipping and on the P6/P7 sanitizer remote-resource blocking being verified in-tree:

- `connectSrcSources()` drops `'https:'` (csp.ts:49); `img-src` drops `https:` (:40),
  keeping `'self' data: blob:` (covers are blob/SW-served; remote EPUB images are rewritten
  to placeholders by the sanitizer — keep a per-book "allow remote content" override OUT of
  scope unless P6/P7 shipped it, in which case its hosts cannot be enumerated and the
  override documents that images may be blocked by CSP on nginx deployments).
- Regenerate nginx.conf (`scripts/generate-csp.mjs`), preview headers and meta follow
  automatically (one renderer). Extend `csp.test.ts`: assert `https:` appears in NO
  directive; assert host-set equality stays exact.
- **BYO-Firebase mitigation** (the known breakable): the `firebase` destination already
  contributes the user-configured authDomain to the rendered policy at build/runtime where
  known; for the committed nginx copy the policy includes the static googleapis trio +
  `*.firebaseapp.com` script/connect entries — verify sign-in (popup + redirect) against
  the emulator suite and a real BYO config under `vite preview` (enforced headers) before
  flip. Document in README/sync docs: self-hosted users with custom authDomains must
  regenerate nginx.conf (`npm run generate:csp`).
- Playwright desktop suite runs under `vite preview` (enforced CSP) — any violation fails
  journeys, which is the real acceptance.

### I. Font rename off the OFL Reserved Names

- New family name: **'Versicle Sans Narrow'** (no RFN substring). Work:
  1. Re-derive the modified TTFs with the name table changed — and **commit the fonttools
     script** (`scripts/build-pinyin-font.py` + provenance inputs) closing the
     "unreproducible derivative" gap flagged in `inventory.json:42`;
  2. Rename files `public/fonts/VersicleSansNarrow-{Regular,Bold}.ttf`; update `@font-face`
     (`index.css:2-14`) and `.font-pinyin` (:282);
  3. Update `third-party/inventory.json` + regenerate `THIRD-PARTY-NOTICES.md` (the entry's
     "KNOWN VIOLATION" text is replaced by the rename record; license-gate stays green);
  4. **Preference migration = read-time normalization, no format change** (RC-16): the
     theming consumers (`useEpubReader.ts:878,951`; offscreen renderer) map the legacy
     string `'PT Sans Narrow'` → `'Versicle Sans Narrow'` if it ever appears in the synced
     free-form `fontFamily`; no UI ever wrote it, so this is belt-and-braces, and the
     one-in-flight ledger slot is RELEASED (v7 = P7 linking, v8 = P9 husk-clear, untouched).
- Visual golden on the pinyin overlay (the injected tone glyphs ǎǐǒǔǚ are the entire point
  of the modification) before/after rename.

### J. activeContext out of the CRDT (+ /notes)

- Remove `'activeContext'` from `PREFERENCES_STORE_DEF.syncedKeys`
  (`usePreferencesStore.ts:122`) and from the state/actions; `LibraryView` navigation
  replaces the switch (§A). With the key absent from `syncedKeys`, the fork neither writes
  nor hydrates it — the existing Y.Map husk is inert; old clients may keep writing it
  (harmless — nothing reads it here anymore, and their own UI keeps working).
- **Schedule per the one-in-flight rule:** NO version bump now (RC-17). The husk is pruned
  by **v8** (P9's husk-clear migration, already earmarked for the v6 preference husks —
  add `activeContext` to its kill list in `migrations.ts` comments in this phase's PR so
  P9 can't miss it).
- Cross-device acceptance: flipping to Notes on device A no longer flips device B
  (two-client test extends the P2 quarantine/fixture suite cheaply at the store level).

### K. Reduced-motion policy

- One global block in `index.css`:
  `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; } }`
- `useReducedMotion()` hook (matchMedia) in `src/hooks/`; JS-driven motion consumes it:
  `TTSQueue.tsx:79` smooth-scroll → `behavior: reduced ? 'auto' : 'smooth'`.
- **Decide the dead animation classes once** (RC-18): install `tw-animate-css` (TW4-native)
  so Modal/Sheet/Popover/Toast entrance animations actually run — under the global
  reduced-motion override — OR delete the 11 files' no-op classes. Default: install; it is
  one dev-dependency and the classes were authored intentionally. Either way the layer
  stops lying.

### L. ui/ design system finalized

- After §C empties `CompassPill` out of `ui/`, the depcruise rule `ui-imports-kernel-only`
  (ui/ may import kernel/, Radix, lucide, cva/tailwind-merge — no store/, no domains/, no
  components/ outside ui/) flips to **error**. `ui/README.md` is regenerated from reality
  (the Modal/Dialog inversion noted in analysis D6; full Modal/Dialog merge stays a P9
  candidate — not load-bearing for this phase's exit).

---

## Execution order (PR-by-PR)

"Full gates" = lint (new bans at current level), `tsc -b`, vitest, depcruise ratchet,
worker-chunk/mock/lexicon purity, coverage ratchet, license gate, Playwright desktop.

**PR-0 (entry gate, rule 7):** re-measure RC-4/RC-5 against the then-current tree
(CompassPill variants remaining, settings tabs already self-contained, confirm/alert/
toLocale counts), pin shell behavior: boot entry-gate tests stay green;
`GlobalSettingsDialog.predictability.test.tsx` + the three CompassPill test files are
inventoried into the absorption ledger with named target suites. *Exit:* a committed
re-measure note in this doc's §Follow-ups; no code change.

**PR-1 — kernel/locale formatters + documentElement.lang.** §F: `getUILocale`, `format.ts`,
`messages.ts` skeleton (MessageKey + formatMessage), `localeBoot` task; migrate the 16
`toLocale*` sites; delete the 3 relative-time + byte-format copies; `toLocale*` lint ban.
*Exit:* zero `toLocale*` outside kernel/locale; mixed-locale chimera (DeviceList) gone;
formatter unit suite with pinned locales green.

**PR-2 — Toast queue + LiveAnnouncer + useConfirm.** §D: store rewrite (queue), container
above the router gate, persistent live regions, TTS announcement adapter, `useConfirm` +
codemod of all 12+7 native sites (destructive first), `wireSyncEvents` copy moves to keys.
`no-alert`/`no-restricted-globals` to error. *Exit:* zero native confirm/alert (lint);
toast queue + announcer unit suites; vitest-axe on Toast/ConfirmDialog; boot-time toast no
longer dropped (regression test: toast fired pre-`ready` renders after mount).

**PR-3 — KeyboardShortcutService.** §E: service + hook + help sheet; reader/TTS registrants;
delete both listeners + the P0 interim predicate; keydown lint ban. *Exit:* acceptance
matrix as unit/integration tests (extending `ReaderTTSController.test` assertions, absorbed
per ledger); one-action-per-keypress in all TTS states; Escape ordering pinned.

**PR-4 — Routes + /notes + activeContext de-sync + settings shell.** §A routes (lazy
`/notes`, `/read/:id` stays eager HERE — flips in PR-7), §B registry shell with the nine
existing tabs as lazily-wrapped panels (still props-fed where they are today), §J
activeContext removal + v8 kill-list note. *Exit:* `/notes` + `/settings/:tab` deep links
work (new Playwright journey); hardware-back closes settings; activeContext out of
syncedKeys with the two-client store test; library journeys green against the navigation
change.

**PR-5 — Settings panel self-containment + god-file deletion.** §B: convert tabs to
self-contained panels (General/TTS/GenAI/Sync handler clusters move in), provider panel
from the 5a registry, Radix Tabs semantics. **Deletes `GlobalSettingsDialog.tsx`** (named
artifact). *Exit:* shell <150 lines; every panel mounts standalone in vitest with real
stores + axe clean; `GlobalSettingsDialog.predictability` absorbed and deleted (ledger);
settings journeys green.

**PR-6 — CompassPill dissolution completion** (HARD-SEQUENCED after the P6 merge; §C
re-measure decides scope). PillShell, variant moves, ReaderControlBar router without
remount-key, CustomEvent → ReaderCommands. **Deletes `CompassPill.tsx`.** *Exit:* ui/ has
no store imports; `ui-imports-kernel-only` flips to error (§L); pill journeys + the two
`_Accessibility`/`_NoteRecall` files absorbed (ledger); focus survives variant morph
(regression test).

**PR-7 — Code splitting + entry budget.** §A: lazy `/read/:id` + first-use firebase/drive/
genai dynamic imports; `check-bundle.mjs` check 4 (content assertion + size baseline
recorded in this PR). *Exit:* budget check green in CI; entry closure free of
firebase/epubjs/genai (asserted); cold-boot journey timing not regressed (Playwright trace
sanity); un-configured-sync boot never fetches a firebase chunk (network assertion in E2E).

**PR-8 — PWA finishers.** §G: manifest fixes, runtime caching routes, prompt-style update
flow, honest soft gate (delete dead swError screen, rewrite `App_SW_Wait`). *Exit:*
Lighthouse PWA installability pass; offline smoke journey (load app offline after one
online visit: open book, pinyin font renders, dictionary lookup works, piper runtime
loads); update-prompt journey (build A → build B: toast appears, reload activates).

**PR-9 — Font rename.** §I: rebuilt TTFs + committed build script, css/file renames,
inventory/notices regeneration, read-time fontFamily normalization, pinyin visual golden.
*Exit:* license gate green with the violation note replaced; goldens match; no RFN
substring in repo outside THIRD-PARTY provenance text.

**PR-10 — CSP strict flip + phase close.** §H: drop `https:` from connect-src/img-src,
regenerate copies, extend csp.test, BYO-Firebase verification + docs. §K reduced-motion
(small enough to ride here or PR-8). Phase close: README banner, this doc's §Follow-ups,
ratchets regenerated, jsx-a11y per-directory error flips for every directory this phase
rewrote (`ui/`, `app/settings/`, `app/shortcuts/`, pill features). *Exit:* full Playwright
suite green under enforced strict CSP via `vite preview`; registry==CSP extended test
green; axe scans of the five surfaces pass; strangler P8 exit criteria all check.

Independence: PR-1/2/3 are mutually independent (land in any order; PR-2 uses PR-1's
MessageKey, so 1 → 2). PR-4 needs PR-2 (useConfirm for the dialog) and PR-3 only nominally.
PR-6 waits on P6; PR-7 waits on PR-4-6 (chunks final); PR-9/10 last. If P6/P7 slip, PR-6
and the LibraryView edits in PR-4 are the only blocked items — everything else proceeds.

---

## Test plan

**Existing suites that pin behavior (green throughout; absorb, never weaken):**
- Boot: `App_Boot.test.tsx`, `App_SW_Wait.test.tsx` (REWRITTEN in PR-8 for the honest soft
  gate), `App_Capacitor.test.tsx`, `App_MigrationFailure.test.tsx`, the P1 entry-gate boot
  integration tests.
- Shell: `GlobalSettingsDialog.predictability.test.tsx` (absorbed PR-5),
  `CompassPill.test` + `CompassPill_Accessibility` + `CompassPill_NoteRecall` (absorbed
  PR-6), `Toast.test.tsx` (extended PR-2), `useBackNavigationStore.test.ts`,
  `ReaderTTSController.test.tsx` keyboard assertions (absorbed PR-3).
- Verification journeys: `test_a11y_axe.spec.ts`, `test_compass_pill*.spec.ts`,
  `test_journey_library*.spec.ts`, settings-touching journeys (`test_genai_settings`,
  `test_abbrev_settings`, `test_firebase_config_clear`), `test_font_profiles.spec.ts`
  (font rename must not break per-language profiles), smart-toc/sync/kill-mid-switch
  (regression canaries for the dynamic-import work).

**New, by PR:** formatter unit suite (pinned locales, RTF/bytes/percent/collator) ·
toast-queue unit (ordering, overwrite-loss regression named per ledger, focus-pause) ·
announcer integration (TTS store transitions → region content, debounce) · useConfirm
component + axe · shortcut-service matrix (scope stack, collisions, repeat/input guards,
iframe bridge via FakeReaderEngine if P6's port landed) · deep-link journeys
(`/notes`, `/settings/diagnostics` cold load) · two-client activeContext non-propagation
(store-level, riding the P2 fixture harness) · entry-budget script self-test (fixture
sourcemaps) · offline smoke + update-prompt journeys (PR-8) · pinyin font golden (PR-9) ·
csp strictness test (PR-10).

**Cross-cutting:** every absorbed per-bug file deleted only in the PR that lands its
`describe('regression: …')` block (rule 8; ledger reviewed); coverage ratchet never drops;
vitest file count moves toward the ~110 target (this phase absorbs ≥5 files: 2 CompassPill
regressions, predictability, App_SW_Wait fold-in, ReaderTTSController keyboard split);
jsx-a11y per-directory error flips are themselves CI assertions.

---

## Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **SW update-flow transition strands clients** — switching autoUpdate+skipWaiting → prompt changes the channel every later fix ships through; a botched handoff = stale shell with no recovery | The currently-fielded SW autoUpdates ONCE more onto the first prompt build (old SW's own skipWaiting does the swap); from then on prompt flow. Two-build update journey in CI (PR-8 exit); `clientsClaim` retained; never remove `cleanupOutdatedCaches`; the prompt toast lives ABOVE the router gate so even a boot-blocked client can reload. |
| 2 | **Route-splitting reintroduces eager boot or hidden import-order coupling** (strangler risk #11) | Sequencing held (P8 only, after P1 side-effect cleanup — verified at RC-1); entry content assertion + size ratchet in CI (PR-7); depcruise no-module-side-effect rule; heavy imports move inside boot-task `run()` bodies, never new module scope. |
| 3 | **CSP strict flip breaks BYO-Firebase / un-enumerated hosts mid-rollout** (P7 risk #4 inherited) | Flip is the LAST PR, after piper offline caching verified; full Playwright under enforced preview CSP; emulator + real-BYO sign-in check; documented `generate:csp` regeneration step for self-hosters; registry==CSP test keeps the limitation explicit. |
| 4 | **P6/P7 move reader/library files under this phase** (CompassPill variants, ReaderControlBar, LibraryView, BookCard) | PR-0 re-measure is mandatory; PR-6 hard-gated on the P6 merge; LibraryView edits in PR-4 are navigation-only and re-applied trivially on either file version; lang attributes are inert attributes. |
| 5 | **Settings dissolution breaks E2E selectors / loses a handler edge case** (backup, CSV, repair flows concentrated in the god file) | data-testids preserved; per-panel characterization before moving each handler cluster; settings journeys green per-PR, not just at exit; panels keep real-store vitest mounts. |
| 6 | **Keyboard consolidation regresses playback-state arrow semantics** (the exact behavior the P0 hotfix protected) | ReaderTTSController.test keyboard assertions ported FIRST (PR-3 entry), acceptance matrix pins every TTS state × focus location; the interim predicate is deleted only in the same PR that proves the matrix. |
| 7 | **Toast queue changes announcement/UX timing** (81 call sites; single-slot semantics accidentally load-bearing) | Legacy `showToast(prose)` signature preserved; queue cap + dedupe-by-key prevent floods (e.g. per-file import errors); toastCapture harness keeps store-level assertions stable. |
| 8 | **Font rename ships an unreproducible or glyph-broken derivative** | The fonttools script lands IN the repo with the rename (closing the inventory's UNKNOWN); pinyin visual golden gates; runtime cache keyed by path prefix so renamed files cache cleanly; read-time fontFamily normalization is pure belt-and-braces. |
| 9 | **activeContext removal vs old clients** | Old clients keep writing the husk — nothing here reads it; prune is deferred to v8 (P9) per the one-in-flight rule; two-client store test pins non-propagation. |
| 10 | **14 MB dict + ~20 MB piper wasm in CacheFirst caches bloat storage quotas** | `storage.persist()` already requested (P3); LRU expiration plugins on the dict/piper caches (maxEntries small, they're single-file caches); wipe hook enumeration verified in PR-8. |

---

## Dependencies

- **P6 (reader)** — gates PR-6 (ReaderCommands replaces the CustomEvent; vocab-triage may
  move with the chinese module; ReaderEngine port provides the shortcut iframe bridge and
  the FakeReaderEngine test seam). Named asks: keep pill `data-testid`s; expose
  `nextChapter/prevChapter` on ReaderCommands; forward iframe keydown through the engine
  port.
- **P7 T1/T2 (library/search)** — LibraryView/BookCard rewrite collides with PR-4's
  navigation edit and §F's `lang` pass (coordinate; both edits are small on either
  version). P7's **v7 bookId linking must be landed+verified before P9's v8** — P8 itself
  ships zero format changes (RC-16/17), so the rule-4 ledger has no P8 entry to wait on.
- **P7 §I (landed)** — registry, gateway, CSP generator, registry==CSP test: PR-10 builds
  directly on `csp.ts`'s documented flip points (:40, :49).
- **P5a (landed)** — piper vendored at `/piper/**` (PR-8 runtime caching), cdnjs entry
  deleted (CSP flip precondition), ProviderDescriptor registry (PR-5 provider panel).
- **P0 artifacts** — i18n ADR (binding signatures), a11y tooling (flip-to-error model),
  license gate (PR-9 acceptance), `installTestApi` (any new E2E hooks go there, never new
  window globals — main.tsx's remaining ungated handles are P9's retirement, untouched
  here).
- **Hand-offs TO P9:** v8 husk-clear gains `activeContext` (kill-list note in
  `migrations.ts`, PR-4); `window.useTTSStore`/store handles retirement with the spec
  migration; Modal/Dialog merge decision; remaining jsx-a11y warn→error directories;
  `useUIStore.isGlobalSettingsOpen` navigation shim deletion.

## Follow-ups

(To be filled at phase exit; PR-0's re-measure note lands here first.)

### PR-0 re-measure note (2026-06-12, p8-routes-and-settings entry)

Re-measured against the post-P6/P7 tree (HEAD `fd5f1302`). Deltas vs the
§Reality-check anchors:

- **RC-4 (CompassPill):** 625 lines (was 830). All seven variants still
  DECLARED in `ui/CompassPill.tsx:27`, but P6 already paid two of the §C
  bullets: the `reader:chapter-nav` CustomEvent is GONE (chapter nav goes
  through `readerCommandsRegistry.get()?.nextChapter()/prevChapter()` —
  CompassPill.tsx:193-198) and `vocab-triage` is a one-line delegation to
  `components/chinese/VocabTriageCard` (P6 PR-11). `ReaderControlBar` still
  re-derives priority (:91-111) and still remounts via `key={variant}`
  (:235). §C scope = PillShell + active/summary/compact/annotation/
  sync-alert/audio-triage moves + router de-remount; the ReaderCommands
  call-site swap is already done.
- **RC-5 (GlobalSettingsDialog):** 738 lines, 9 tabs as fake-button sidebar
  (:510-540). Seven tabs already extracted as PROPS-FED presentational
  components in `components/settings/` (index.ts exports 7); `devices` +
  `dictionary` are inline JSX. `DiagnosticsTab` self-contained (the model).
  TTSSettingsTab already renders provider choice from the 5a registry
  (resolveDescriptor import at GlobalSettingsDialog.tsx:21).
- **RC-2/RC-3 (routes/entry):** `/` + `read/:id` only, both eager
  (`routes.tsx:7-8` imports `LibraryView` + `ReaderShell` — ReaderView died
  in P6; the PR-7 content assertion tracks `ReaderShell` now). Firebase
  enters the entry closure through THREE static chains: `syncInit` →
  `createSync` → `FirestoreBackend`/`firebase-config`; `SyncOrchestrator` →
  `AuthSession` → `firebase/auth` + `auth-helper`; `WorkspaceMigrationConfirmModal`
  (App.tsx static) → `createSync`. GenAI enters via `wireGoogle` (`new
  GeminiClient`) and `lib/genai/GenAIService` (static feature-value imports
  from the domain index).
- **RC-10 (activeContext):** unchanged — synced key (`usePreferencesStore.ts:122`),
  LibraryView switches at :468/:481/:528/:607. The v9 kill-list note ALREADY
  exists in `app/migrations.ts` (":268-271") per the program renumbering
  (v8 = reading-list FK, LANDED; v9 = husk-clears, P9) — supersedes this
  doc's older v7/v8 numbering throughout.
- **Numbering supersession (authoritative):** CRDT v7 = vocabulary
  canonicalization (LANDED, P6); v8 = reading-list bookId FK (LANDED, P7
  follow-up); v9 = preferences husk-clear + `library.__schemaVersion`
  retirement + activeContext husk prune (P9). References to "v8 husk-clear"
  in §J/§RC-17 read as v9.
- **Entry gate run:** App_Boot / App_SW_Wait / App_MigrationFailure /
  App_Capacitor, GlobalSettingsDialog(.predictability), CompassPill ×3,
  ReaderControlBar, useBackNavigationStore — 11 files / 55 tests GREEN
  pre-change; `tsc -b` (app+test+e2e) clean. Absorption targets inventoried:
  `GlobalSettingsDialog.test.tsx` + `.predictability` → SettingsShell suite;
  `CompassPill.test` + `_Accessibility` + `_NoteRecall` → pill feature
  suites + ReaderControlBar suite.
