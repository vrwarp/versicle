# Accessibility (keyboard, screen reader, focus, motion)

Cross-cutting audit. Unlike the other 17 reports this is not a module — it is a *contract* that every UI surface either honors or violates. The finding in one sentence: **Versicle has good per-widget ARIA hygiene (Radix primitives + aria-labels on icon buttons, clearly enforced at some point by an agent pass) but zero app-level accessibility architecture** — no keyboard-shortcut owner, no live-announcement channel, no focus-management policy, no language attribution, no motion policy, and no automated verification keeping any of it from regressing.

## What it is

Everything a keyboard-only, screen-reader, or motion-sensitive user touches:

- Global keyboard shortcuts (two competing window-level registries in the reader).
- Screen-reader semantics of the app chrome (library, reader header, settings dialog, panels) and of the epub.js iframe reading surface with its six overlay systems.
- Live announcements (toasts, loading states, TTS playback state — the app's core interaction).
- Focus behavior across overlays, morphing pills, route changes, and immersive mode.
- Motion (`prefers-reduced-motion`), theme contrast, and language (`lang`) correctness for an app whose headline feature set is *Chinese-language reading with synthesized speech*.

## File inventory

| File | Role |
|---|---|
| `index.html:2` | `<html lang="en">` hardcoded; never updated. |
| `src/hooks/useReaderNavigation.ts` | Window + rendition keydown registry #1 (ArrowLeft/Right page turns), wheel/touch scrolling. |
| `src/components/reader/ReaderTTSController.tsx:162-207` | Window keydown registry #2 (Arrows/Space/Escape for TTS), mounted alongside #1. |
| `src/components/reader/ReaderView.tsx` | Mounts both registries; header icon buttons (good labels); plain-div sidebars; immersive mode. |
| `src/hooks/useEpubReader.ts` | iframe creation + sandbox MutationObserver patch; no iframe title/labeling; contextmenu suppression; theme CSS forcing. |
| `src/components/ui/CompassPill.tsx` | 7-variant morphing pill; best aria-label work in the app; also nested-button violation (VocabTile). |
| `src/components/reader/ReaderControlBar.tsx` | Pill variant arbitration; `key={variant}` remount destroys focus. |
| `src/components/audio/AudioReaderHUD.tsx` | Second, apparently unmounted CompassPill host (dead duplicate). |
| `src/components/reader/UnifiedAudioPanel.tsx` | Audio deck Sheet; labeled controls; fake "Up Next/Settings" tabs. |
| `src/components/reader/TTSQueue.tsx`, `TTSQueueItem.tsx` | Queue list; smooth-scroll follow; no list/current semantics. |
| `src/components/GlobalSettingsDialog.tsx` | Settings modal; fake button "tabs"; native `confirm()`/`alert()`; un-announced status strings. |
| `src/components/ui/*` (Button, Modal, Sheet, Dialog, Popover, Select, Switch, Checkbox, Tabs, Slider, Progress, Input, PasswordInput, Toast, ToastContainer) | shadcn-style Radix wrappers — the sound foundation. |
| `src/components/reader/PinyinOverlay.tsx` | aria-hidden decorative overlay (correct). |
| `src/components/reader/AnnotationMarkerOverlay.tsx` | Interactive buttons inside `aria-hidden="true"` (violation). |
| `src/components/reader/panels/TOCPanel.tsx`, `SearchPanel.tsx` | Radix Tabs (good); active-item and live-region gaps. |
| `src/components/reader/VisualSettings.tsx` | Best-practice settings panel (labels, live values, Radix Tabs). |
| `src/components/reader/LexiconManager.tsx:283-301` | Third tab implementation: `role="tab"` without panels/arrow keys. |
| `src/index.css` | Theme tokens; no reduced-motion, no forced-colors, no contrast guards. |
| `src/App.css` | Dead Vite template; contains the repo's only `prefers-reduced-motion` query (the spinning logo). Still imported by `App.tsx:27`. |
| `tailwind.config.js` | Dead under Tailwind 4 (no `@config` in `index.css`); `animate-in/out` classes used in 11 files come from an uninstalled plugin. |
| `src/components/ui/CompassPill_Accessibility.test.tsx`, `src/components/settings/TTSSettingsTab_Accessibility.test.tsx` | The only dedicated a11y tests — hand-rolled aria-label assertions. |
| `eslint.config.js`, `package.json` | No jsx-a11y plugin, no axe/jest-axe/@axe-core/playwright anywhere. |

## How it works (data & control flow)

**Keyboard.** Two independent `window.addEventListener('keydown')` registries are simultaneously active in the reader. `useReaderNavigation` (mounted at `ReaderView.tsx:1078`) maps ArrowLeft/Right → `handlePrev/handleNext` unconditionally, and also listens on the epub.js rendition so arrows work when focus is inside the book iframe (`useReaderNavigation.ts:105-111`). `ReaderTTSController` (mounted at `ReaderView.tsx:1117`) maps the *same* arrows to TTS sentence jumps when playing, or to the *same* `onPrev/onNext` callbacks when stopped, plus Space (play/pause) and Escape (stop) — but listens **only** on `window` (`ReaderTTSController.tsx:205`), not on the rendition. There is no registry, no scoping, no conflict detection, and no discoverability UI (zero shortcut help anywhere; grep for "shortcut" finds only the unused `DropdownMenuShortcut` styling helper).

**Announcements.** ~30 `aria-live` usages exist, but nearly all are static "Loading…"/"Scanning…" `sr-only` spans or settings-value readouts. There is no shared announcer; each component hand-rolls its region. TTS playback state (play/pause/stop/section advance) — the product's core interaction — has *no* live region anywhere; state is exposed only via `aria-pressed`/`aria-label` on the pill, which screen readers only re-read while that element is focused. `Toast.tsx` applies `role`/`aria-live` to an element that mounts *with* its content (`Toast.tsx:46,68-78`), the classic pattern that ATs frequently fail to announce; auto-dismiss pauses on mouse hover only (`Toast.tsx:79-80`).

**Reading surface.** `useEpubReader` renders the book into epub.js-managed iframes, force-patching `sandbox` via MutationObserver (`useEpubReader.ts:24-36,350-379`) — but never assigns the iframe a `title` or any accessible name. Six overlay systems (TTS highlight SVG annotations, color highlights, history highlights, pinyin portal, note-marker portal, debug analysis) paint on/over it. `PinyinOverlay` is correctly `aria-hidden` + `pointer-events-none`. `AnnotationMarkerOverlay` puts focusable `<button>`s inside an `aria-hidden="true"` wrapper. The iframe document gets `contextmenu` preventDefault (`useEpubReader.ts:715-718`). Nobody has ever defined how a screen-reader user reads a book in this app.

**Focus.** TOC/annotations/search sidebars are plain absolutely-positioned divs toggled by a Zustand store (`useSidebarState.ts`) — no focus move on open, no trap, no Escape-to-close (only Android back-button via navigation guard). Radix handles focus for Modal/Sheet/Popover correctly. The CompassPill is remounted on every variant morph (`ReaderControlBar.tsx:235` `key={variant}`), dropping focus to `<body>` mid-interaction. The entire `src/components` tree contains exactly one imperative `.focus()` call (`CompassPill.tsx:235`).

**Language.** `lang="en"` is hardcoded (`index.html:2`) and never touched again (grep: zero `documentElement.lang` writes, zero `lang=` props in TSX). Chinese book titles, TTS queue sentences, dictionary definitions, and vocab tiles all render in the `en` document. EPUB content inside the iframe keeps whatever `lang` the publisher provided, but every book-derived string in app chrome is announced with English pronunciation rules.

**Motion.** Zero `motion-reduce:`/`motion-safe:` variants in src; the only `prefers-reduced-motion` query is dead Vite boilerplate (`App.css:27-31`). `TTSQueue.tsx:79` smooth-scrolls on every sentence. Meanwhile the `animate-in/fade-in/slide-in-*` classes used by Modal/Sheet/Popover/Toast/CompassPill (11 files) come from `tailwindcss-animate`, which is **not installed**, and `tailwind.config.js` itself is not loaded by Tailwind 4 (no `@config` directive in `index.css`) — so those entrance animations are silent no-ops today. The motion layer is unowned in both directions: intended animations don't run, and running animations (spin/pulse/ping/transitions/smooth scroll) ignore user preference.

## Technical debt

### 1. Two overlapping global keyboard registries — double page turns and destructive Space/Escape conflicts
- **Severity:** critical
- **Category:** correctness
- **Evidence:**
  - `useReaderNavigation.ts:73-120`: window keydown, ArrowLeft/Right → `handlePrev()/handleNext()`, no TTS awareness.
  - `ReaderTTSController.tsx:162-207`: second window keydown; when TTS `stopped`, ArrowLeft/Right → `onPrev()/onNext()`.
  - `ReaderView.tsx:1078-1085` and `1117-1122`: both mounted simultaneously, wired to the **same** `handlePrev/handleNext` (`ReaderView.tsx:885-893`). Neither calls `stopImmediatePropagation`; `preventDefault` does not stop the other listener.
  - Consequences: (a) TTS stopped → one ArrowRight fires `rendition.next()` **twice** (skips a page); (b) TTS playing → ArrowRight triggers a page turn (nav hook) *and* a sentence jump (controller), the conflict only masked by the TTS highlight re-`display()`; (c) `ReaderTTSController.tsx:189-196`: Space pauses/plays even when focus is on any header button and `preventDefault` swallows the button's own Space activation; (d) `:198-203`: Escape stops playback globally — pressing Escape to close a Radix dialog/sheet while listening also kills the audio session (Radix listens at document level and does not stop propagation); (e) the controller listens only on `window`, so after the user clicks into the book iframe, Space/Escape/sentence-jump silently stop working while arrows (nav hook also binds the rendition, `useReaderNavigation.ts:108-111`) keep working — keyboard behavior depends on which document has focus; (f) controller has no `e.repeat` guard (nav hook does, `useReaderNavigation.ts:78`).
- **Impact:** The app's only keyboard interactions are unreliable and occasionally destructive. Any new shortcut (the overhaul plans more surfaces) has nowhere safe to land; every addition risks a new collision. This is also undiscoverable — no shortcut help exists.
- **Fix:** Single `KeyboardShortcutService` mounted once at the app shell: one window listener + one rendition bridge, declarative registration `register({key, scope, when, handler, description})` with a scope stack (`reader` < `tts-active` < `overlay`), collision detection in dev, and an auto-generated "Keyboard shortcuts" help sheet (`?` key). Delete both ad-hoc listeners; ReaderView and the TTS controller become registrants. Acceptance: one ArrowRight = exactly one action in every TTS state, in and out of the iframe; Escape closes the topmost overlay before it may stop playback; Space never hijacks a focused control.

### 2. No live announcement channel for TTS playback state (core interaction is silent to AT)
- **Severity:** high
- **Category:** architecture
- **Evidence:** No `aria-live` region is connected to `useTTSStore.status/isPlaying` anywhere (grep across src). State surfaces only as `aria-pressed`/`aria-label` swaps on `CompassPill.tsx:589-604,794-800` and `UnifiedAudioPanel.tsx:103` — announced only while those elements hold focus. Keyboard Space toggling (`ReaderTTSController.tsx:189-196`) gives zero feedback. Section advances, queue completion, provider errors (`ReaderView.tsx:745-750` routes errors into the toast, see item 6) are likewise unannounced. Settings status strings (`GlobalSettingsDialog.tsx` `backupStatus`/`orphanScanResult`/`regenerationProgress`/`csvImportMessage`, rendered in `DataManagementTab`) update outside any live region.
- **Impact:** A blind user who presses Space has no idea playback paused. For an *audiobook app* this is the difference between usable and not. Every component invents its own `sr-only` live span instead (30+ scattered instances), which the rewrite will faithfully copy unless a primitive exists.
- **Fix:** `LiveAnnouncer` mounted once in `RootLayout`: two persistent visually-hidden regions (polite + assertive), `useAnnounce()` hook + non-React `announce()` for stores/services. Subscribe a small adapter to the TTS store: "Playing — {section}", "Paused", "Stopped", "Chapter: {title}" (debounced; never per-sentence). Route toast messages and long-running operation status through it. Make it part of the new component API contract in the overhaul.

### 3. Hardcoded `lang="en"` and zero language attribution for Chinese content
- **Severity:** high
- **Category:** correctness
- **Evidence:** `index.html:2`; grep finds no `documentElement.lang` write and no `lang=` attribute anywhere in TSX. The app renders Chinese book titles (`BookCard.tsx:173-178`), Chinese TTS queue sentences (`TTSQueueItem.tsx:32-34`), dictionary pinyin/definitions and vocab tiles (`CompassPill.tsx:110-156,704-738`) — all in an `en` document. Book metadata *has* a language field (used at `ReaderView.tsx:213`, `useEpubReader.ts:606`), so the data exists; it just never reaches the DOM.
- **Impact:** Screen readers pick English pronunciation rules for Chinese text by construction — Chinese-language reading and vocabulary study (a headline feature) is unusable with AT. Also degrades browser translation, hyphenation, and font selection heuristics.
- **Fix:** (a) Set `document.documentElement.lang` from app UI locale at boot. (b) Add `lang` to the prop contract of every component that renders book-derived text (`BookCard` title block, `TTSQueueItem`, TOC labels, dictionary popovers, vocab tiles, reader header `<h1>`), sourced from `BookMetadata.language`. (c) For mixed content (pinyin readouts), wrap hanzi spans in `lang="zh"`. Enforce with a lint rule/review checklist item in the rewrite: "book text never renders without `lang`".

### 4. Focusable controls inside `aria-hidden`, and nested interactive elements
- **Severity:** high
- **Category:** correctness
- **Evidence:**
  - `AnnotationMarkerOverlay.tsx:34-36`: wrapper `aria-hidden="true"` contains `<button aria-label="Note: …">` (lines 39-59). Tab reaches buttons that AT cannot perceive — an axe `aria-hidden-focus` serious violation. The `aria-label` on the buttons is wasted effort.
  - `CompassPill.tsx:100-134`: VocabTile renders a `<button>` *inside* a `<button>` (the "i" info trigger at 118-127). Invalid HTML — parsers may re-nest it, and AT exposes one unpredictable widget. The tooltip also opens on `onMouseEnter` only (96-97), so keyboard users can't reach definitions; `isKnown` state has no `aria-pressed` (conveyed by color + check icon only).
  - `BookCard.tsx:84-117`: `role="button"` div wraps the whole card including the DropdownMenu trigger `<Button>` — nested-interactive; card has no `aria-label` so its accessible name is the concatenation of title/author/duration/"Book options"/progress.
- **Impact:** Concrete WCAG failures on the two surfaces (reader notes, library grid) users touch most; all three are patterns the rewrite will replicate into new Pill/Card primitives if not outlawed now.
- **Fix:** Note markers: drop `aria-hidden` from the wrapper (keep `pointer-events-none` on it, `pointer-events-auto` on buttons) and give markers a roving-tabindex group. VocabTile: single `<button aria-pressed={isKnown}>` per tile; definition popover triggered by the same button's focus/long-press, not a nested button. BookCard: make the title an overlay-stretched real `<button>`/link; menu trigger becomes a sibling, not a descendant.

### 5. The reading surface (epub.js iframe) has no screen-reader contract
- **Severity:** high
- **Category:** architecture
- **Evidence:** `useEpubReader.ts:332-380` creates/patches iframes (sandbox MutationObserver) but never sets `title`/`aria-label` on them — the central element of the app is an unnamed iframe. `:715-718` suppresses `contextmenu` inside the book document (breaks some AT/context interactions). Paginated mode relies on epub.js clipping — content overflow semantics for AT are untested and undefined. Six overlay systems decorate the surface; only PinyinOverlay deliberately opted out of the a11y tree. TTS "current sentence" highlighting is purely visual SVG annotation (`ReaderTTSController.tsx:75-84`) with no programmatic counterpart. No report, test, or doc anywhere in the repo addresses how AT reads a book.
- **Impact:** Whether a screen-reader user can read a book at all is currently *accidental* (depends on epub.js iframe internals and the publisher's markup). The planned ReaderShell decomposition will rebuild this surface; doing so without an explicit contract bakes in another generation of unknowns.
- **Fix:** Define the contract in the ReaderShell workstream: (a) name the iframe (`title="Book content: {bookTitle}"`) in the same place the sandbox patch runs; (b) stop suppressing contextmenu (or scope it to Android long-press selection only); (c) decide and document the SR reading model — recommended: let AT read the iframe document natively (it is same-origin), verify heading/landmark passthrough with axe against rendered chapters in Playwright; (d) mirror "current TTS sentence" to the announcer at chapter granularity; (e) every overlay must declare `aria-hidden` (decorative) or full keyboard/AT support (interactive) — make it a required prop of a shared `ReaderOverlay` wrapper.

### 6. Zero automated a11y verification; the concern exists only as two hand-rolled test files
- **Severity:** high
- **Category:** testing
- **Evidence:** `package.json` dev/runtime deps contain no `axe-core`, `jest-axe`/`vitest-axe`, `@axe-core/playwright`, or `eslint-plugin-jsx-a11y`; `eslint.config.js:18-27` registers only react-hooks/react-refresh. The only dedicated tests are aria-label string assertions: `CompassPill_Accessibility.test.tsx` (5 cases), `TTSSettingsTab_Accessibility.test.tsx` (2 cases, one with a `@ts-expect-error fix` patch-over at line 45), plus incidental assertions in `Toast.test.tsx:23-66` and `UnifiedAudioPanel.test.tsx:53-72`. Nothing prevents the violations in items 1, 4, 7 from multiplying — several would be caught by stock axe rules (`aria-hidden-focus`, `nested-interactive`, `html-has-lang` semantics).
- **Impact:** Every finding in this report can regress silently. The overhaul rewrites all UI; without gates, the new code's a11y quality will again be whatever the generating agent happened to emit.
- **Fix:** Three layers, added *before* the component rewrites begin: (1) `eslint-plugin-jsx-a11y` (recommended config) in `eslint.config.js`; (2) `vitest-axe` smoke (`expect(await axe(container)).toHaveNoViolations()`) added to the shared component test harness so every primitive/test gets it for free; (3) `@axe-core/playwright` scans in the verification suite for the five core surfaces (library, reader+TTS active, audio deck, settings dialog, annotation pill), failing CI on serious/critical. Fold the two existing `_Accessibility` test files into the systematic layers.

### 7. Three competing tab implementations; settings/audio "tabs" invisible to AT
- **Severity:** medium
- **Category:** duplication
- **Evidence:** (a) Real Radix Tabs primitive exists (`ui/Tabs.tsx`) and is used correctly in `TOCPanel.tsx:100-106` and `VisualSettings.tsx:238-243`. (b) `GlobalSettingsDialog.tsx:491-524`: the 9-tab settings nav is plain Buttons whose only selected-state signal is the `secondary` visual variant — no `tablist/tab/aria-selected/aria-controls`, content swap unannounced; same pattern in `UnifiedAudioPanel.tsx:209-226` ("Up Next"/"Settings"). (c) `LexiconManager.tsx:283-301`: hand-rolled `role="tablist"/"tab"` + `aria-selected` but no `tabpanel`, no arrow-key navigation — a half-implemented ARIA pattern, arguably worse than none.
- **Impact:** SR users can't tell which settings tab is active or that activation changed content; three patterns means three behaviors to maintain and the settings-registry rewrite has no single component to target.
- **Fix:** One rule: every tabbed UI uses the Radix `Tabs` primitive (it already handles roles, arrow keys, automatic activation). The settings registry rewrite should render its navigation through `Tabs` with `orientation="vertical"`. Delete the LexiconManager hand-rolled variant.

### 8. No focus management policy: sidebars, pill morphing, immersive mode, route changes
- **Severity:** medium
- **Category:** architecture
- **Evidence:** TOC/annotations/search sidebars are bare divs (`ReaderView.tsx:1276-1369`) toggled via `useSidebarState.ts` — opening moves focus nowhere, Escape doesn't close them (only the Android back-guard does), and the toggle button doesn't expose `aria-expanded`/`aria-controls`. `ReaderControlBar.tsx:235` remounts CompassPill via `key={variant}` on every morph, dropping focus to body mid-task (e.g. right after "Add Note"). Entering immersive mode unmounts the focused header (`ReaderView.tsx:1139`). Route changes (library ↔ reader) neither move focus nor update `document.title` — it is statically "Versicle" (`index.html:10`; the only `document.title` reference is an unrelated `history.replaceState` at `LibraryView.tsx:112`). One imperative `.focus()` exists in all of src (`CompassPill.tsx:235`). No skip link; no `<main>`/`<nav>` landmark anywhere (grep), only the reader/library `<header>`s; LibraryView's visual page title is a borderless `SelectTrigger` (`LibraryView.tsx:500`), no `<h1>`.
- **Impact:** Keyboard users lose their place at every panel toggle, pill morph, and navigation; SR users get no signal that the page/view changed. Cheap to fix per-instance, expensive to retrofit after the ReaderShell/Pill rewrites.
- **Fix:** Adopt rules in the new component APIs: overlays/panels are Radix `Dialog`/`Sheet` (modal or non-modal) so focus enter/restore/Escape come free; pill variants morph via internal state (no remount key) and move focus intentionally on mode entry (note editor already does); immersive-mode toggle returns focus to the exit button; route wrapper sets `document.title = "{book} — Versicle"` and focuses the view's `<main>` (add landmarks + a skip link in `RootLayout`).

### 9. Motion layer is unowned: dead Tailwind config, uninstalled animation plugin, no reduced-motion policy
- **Severity:** medium
- **Category:** dead-code
- **Evidence:** `tailwind.config.js` is silently ignored under Tailwind 4 (`index.css` has `@import "tailwindcss"` and no `@config`); its `breathing` keyframe and `darkMode: 'class'` are dead (theming works only because `.dark` sets CSS vars in `index.css:127`). The `animate-in/animate-out/fade-in-0/slide-in-from-*` classes used across 11 files (`Modal.tsx`, `Sheet.tsx`, `Popover.tsx`, `Select.tsx`, `DropdownMenu.tsx`, `Toast.tsx:74`, `CompassPill.tsx:292,625`, …) belong to `tailwindcss-animate`, which is not in `package.json` — all entrance/exit animations are no-ops. The only `prefers-reduced-motion` query in the repo is the Vite-template logo spin in `App.css:27-31`, still imported (`App.tsx:27`). Real, always-on motion ignores user preference: `TTSQueue.tsx:79` smooth-scrolls on every sentence during playback, `animate-spin`/`animate-pulse` spinners, `--animate-ping-slow` (`index.css:53-62`), body color transition (`index.css:242`), hover `scale` transforms.
- **Impact:** Whatever motion design the agents intended doesn't exist; whatever motion does exist can't be turned off. Vestibular-sensitive users get a continuously auto-scrolling queue panel during playback. Engineers can't reason about animation at all (classes look meaningful but do nothing).
- **Fix:** Decide once: install `tw-animate-css` (TW4-native successor) *or* delete the dead classes. Delete `App.css` and `tailwind.config.js` (migrate the two real tokens into `@theme`). Add a global `@media (prefers-reduced-motion: reduce)` block zeroing animations/transitions, and a `useReducedMotion()` helper consumed by JS-driven motion (`TTSQueue` scroll → `behavior: matchMedia(...) ? 'auto' : 'smooth'`).

### 10. Toast announcement channel is unreliable and single-slot
- **Severity:** medium
- **Category:** correctness
- **Evidence:** `Toast.tsx:46` returns `null` until visible, so the `role="status|alert"`/`aria-live` region (lines 68-78) is *created together with its content* — ATs commonly miss live regions that don't pre-exist in the DOM. Auto-dismiss after 3s with pause on `onMouseEnter` only (79-80) — keyboard/SR users can't extend it; the dismiss button can be focused but the toast vanishes under focus. `ToastContainer.tsx`/`useToastStore` hold exactly one toast — a second `showToast` overwrites the first (announcement loss when, e.g., a sync error lands during an import success). TTS errors funnel through this channel (`ReaderView.tsx:745-750`).
- **Impact:** Error feedback — including all TTS failures — may simply never be announced; competing toasts drop messages for everyone, not just AT users.
- **Fix:** The planned Toast primitive rewrite must: render a persistent live-region container at root (content injected into an existing region), queue multiple toasts, pause the timer on hover *and* focus-within, and respect a longer default for `alert` severity. Pairs naturally with the `LiveAnnouncer` from item 2 (toasts visible, announcer invisible — one shared pipe).

### 11. Selection/current-state semantics missing on stateful lists (queue, TOC)
- **Severity:** medium
- **Category:** hygiene
- **Evidence:** `aria-current` appears zero times in src. `TTSQueueItem.tsx:21` exposes the active sentence as `data-current` + styling only; the queue is a div of buttons with no `role="list"`/list context (`TTSQueue.tsx:94-114`); skipped items show visible "Skipped" text (good). `TOCPanel.tsx:66-73`: active chapter conveyed by classes only; device markers ("Read by: …") are `title`-attribute-only (`TOCPanel.tsx:79`), unreachable by keyboard/touch/SR. `GlobalSettingsDialog` active tab likewise (covered in item 7).
- **Impact:** SR users scanning the queue or TOC cannot find "where am I" — the single most useful piece of state in both lists.
- **Fix:** `aria-current="true"` on the active queue item and TOC chapter; wrap queue in `<ol>`/`role="list"`; move device-marker info into the item's accessible name or an explicit popover.

### 12. Theme/contrast gaps: unvalidated custom themes, micro-text, fixed highlight colors
- **Severity:** low
- **Category:** hygiene
- **Evidence:** Custom theme accepts arbitrary fg/bg with no contrast check, then forces them with `!important` over book styles (`useEpubReader.ts:850-854,934-974`); link color is set equal to fg for custom themes (`:944`), removing the only non-color link cue (`text-decoration: none`, `:967-968`). CompassPill renders 10px text (`text-[10px]`, `CompassPill.tsx:553,648`). TTS/annotation highlight colors are fixed pastels with opacity/blend tuned only for the built-in light/dark themes (`useEpubReader.ts:861-872`) — over a user-chosen custom bg, the current-sentence highlight can become imperceptible. No `forced-colors`/`prefers-contrast` handling in `index.css`.
- **Impact:** Users can configure themselves into unreadability; low-vision users get no high-contrast path; the core "where is the voice reading" cue can vanish on custom themes.
- **Fix:** Contrast-ratio validation (warn < 4.5:1) in the custom theme picker; minimum 12px for informational text in the new Pill primitive; derive highlight overlay opacity/blend from computed bg luminance; add a `forced-colors: active` audit to the verification suite.

## Problematic couplings

- **TTS subsystem owns reader keyboard policy.** `ReaderTTSController` (TTS UI) and `useReaderNavigation` (reader) both bind window-level keys against the same callbacks (`ReaderView.tsx:1078,1117`) — keyboard behavior is an emergent property of two subsystems that don't know about each other.
- **CompassPill → window CustomEvent → ReaderView.** Chapter nav buttons dispatch `reader:chapter-nav` (`CompassPill.tsx:317-322`) consumed at `ReaderView.tsx:896-915`, which re-routes to TTS section skip vs page turn. The pill's accessible actions thus depend on an untyped global event contract.
- **Reading-surface semantics depend on epub.js internals.** Sandbox patching via MutationObserver (`useEpubReader.ts:350-379`) and SVG annotation cleanup via manual DOM sweeps (`ReaderTTSController.tsx:58-73`) mean any a11y fix to the surface must reach through `(rendition as any)`.
- **Duplicate pill hosts.** `ReaderControlBar.tsx` (mounted in `RootLayout`) and `AudioReaderHUD.tsx` (appears unmounted — no non-test importer found) both implement variant arbitration for CompassPill; the dead one will mislead the rewrite.
- **Single-slot toast store** (`useToastStore` → `ToastContainer`) is the de-facto announcement channel for errors from TTS, sync, and import subsystems — all of them inherit its announcement unreliability (item 10).

## What's good (keep)

- **The Radix primitive layer** (`Modal`, `Sheet`, `Popover`, `Select`, `DropdownMenu`, `Switch`, `Checkbox`, `Tabs`, `Slider`) — correct roles, focus trapping, Escape handling, and a consistent `focus-visible:ring` treatment via cva across all of them. `Slider.tsx:14-36` even forwards aria-label/labelledby/valuetext to the thumb explicitly. This is the foundation the rewrite should standardize on, not replace.
- **Icon-button labeling discipline.** Every header/icon button audited has a real `aria-label` (`ReaderView.tsx:1146-1267`, `SearchPanel`, `BookCard.tsx:112`, `PasswordInput.tsx:26`). `BookCover.tsx:78` has descriptive alt text.
- **CompassPill's accessible-name composition** — `formatTimeAccessible` (`CompassPill.tsx:342-349`), state-bearing labels with `aria-pressed`, and keyboard activation handlers on its div-buttons — plus a dedicated test file locking it in. The *pattern* is right even where the structure (nested buttons) is wrong.
- **`VisualSettings.tsx`** is the model settings panel: labeled sliders with paired `role="status" aria-live` value readouts, htmlFor'd switches, Radix Tabs for layout mode.
- **`PinyinOverlay`'s deliberate `aria-hidden` + `pointer-events-none`** — exactly the right call for a decorative geometry overlay; the precedent to generalize.
- **GlobalSettingsDialog's `VisuallyHidden` ModalTitle/Description** (`GlobalSettingsDialog.tsx:463-470`) and the `sr-only aria-live` loading-state spans throughout library/settings — evidence an a11y pass happened; the raw material for the systematized version.
- **Viewport meta without `user-scalable=no`** (`index.html:9`) and rem-based font normalization in the reader (`useEpubReader.ts:52-90`) — zoom and text scaling work.

## Target design

**Principle: accessibility as four shared services + contracts baked into primitive APIs, enforced by tooling — not per-component goodwill.**

1. **`KeyboardShortcutService`** (new, `src/lib/a11y/`): the only window/rendition keydown listener. Declarative registration with scopes (`global` → `reader` → `tts-active` → `overlay` stack), `when` predicates, dev-mode collision errors, and a generated shortcut-help overlay. ReaderShell and TTS register; nothing else touches `addEventListener('keydown')` (lint-banned).
2. **`LiveAnnouncer`** (new): persistent polite/assertive regions in `RootLayout`; `useAnnounce()` + store-subscribable `announce()`. Wired to: TTS state transitions (debounced, chapter-granularity), toast pipeline, long-running operation status, route changes ("Library", "{Book title}"). The rewritten Toast renders into the persistent region and supports a queue.
3. **Language correctness**: `document.documentElement.lang` from UI locale; `lang` prop required on all book-text-rendering primitives (new Pill, Card, QueueItem, TOC item), fed from `BookMetadata.language`.
4. **Motion policy**: one `prefers-reduced-motion: reduce` global override + `useReducedMotion()` for JS scrolling/animation; dead Tailwind config and `App.css` removed; animation utility classes either backed by an installed plugin or deleted.
5. **Component-contract additions for the overhaul workstreams**: every overlay declares decorative (`aria-hidden`) vs interactive (full keyboard support) via a `ReaderOverlay` wrapper; all tabbed UIs use Radix Tabs; no nested interactives (lint-enforced); active items expose `aria-current`; pill variants morph without remount and manage focus on mode entry; iframe titled; landmarks + skip link in RootLayout; `document.title` per route.
6. **Verification**: `eslint-plugin-jsx-a11y` → `vitest-axe` in the shared component harness → `@axe-core/playwright` scans of the five core surfaces in CI, plus a manual SR smoke script (VoiceOver/TalkBack: open book, play/pause via keyboard, hear announcement) in the release checklist. Each overhaul workstream (Pill/Toast primitives, settings registry, ReaderShell, CompassPill dissolution) gets an explicit a11y acceptance section referencing these gates.

## Migration notes

No data migrations — this is all UI/runtime behavior. Sequencing matters because the overhaul rewrites every surface this report touches:

1. **Land tooling first** (item 6): jsx-a11y lint + vitest-axe harness + Playwright axe scans against the *current* app. Baseline the existing violations (expect: aria-hidden-focus, nested-interactive, html-lang mismatches) and ratchet — new code must be clean; old violations burn down with each workstream.
2. **Fix the critical keyboard conflict immediately** (item 1) — it is a user-facing correctness bug independent of the overhaul. Cheapest interim fix: make `useReaderNavigation` arrow handling conditional on `useTTSStore.getState().status === 'stopped'` and add the rendition bridge + Escape-ordering to `ReaderTTSController`; the full `KeyboardShortcutService` then replaces both during ReaderShell decomposition.
3. **Build `LiveAnnouncer` + `KeyboardShortcutService` + `useReducedMotion` before the component rewrites start**, so the new Pill/Toast/settings-registry APIs can take them as dependencies instead of retrofitting.
4. **Fold per-item fixes into their owning workstreams**: VocabTile/BookCard nesting → Pill/Card rewrites; fake tabs → settings registry (Radix Tabs); marker overlay aria-hidden + iframe title + overlay contract → ReaderShell; toast queue/live-region → Toast primitive; lang plumbing → wherever `BookMetadata` types are touched.
5. **Behavior-preservation risks**: consolidating keyboard handlers must keep arrows = sentence-jump during playback and page-turn otherwise (covered by the spec tests in `ReaderTTSController.test.tsx` — extend, don't delete); making sidebars Radix Sheets changes outside-click/Escape behavior — keep the Android back-button guard integration (`useSidebarState` → `useNavigationGuard`) by driving it from the Sheet's `onOpenChange`; adding `lang` attributes is inert for sighted users (no visual risk) but should ship with a VoiceOver spot-check on a Chinese book.
6. **Deletions**: `App.css` (after moving nothing — it's all template), `tailwind.config.js` (port color vars already duplicated in `@theme`), `AudioReaderHUD.tsx` if confirmed unmounted, and the two `_Accessibility.test.tsx` files once their assertions live in the systematic harness.
