# Compass-Pill Navigation — Phase 2 (ideas needing discussion)

Status: **discussion only — nothing here is committed.** Captures the open
ideas from the compass-pill navigation rework after Phases 0 and 1 shipped.

## Background

The compass pill (`AudioPill`) is the persistent bottom bar in the reader. Its
prev/next arrows used to be **mode-dependent**: turn a single page while TTS was
stopped, skip a whole section (≈ chapter) while audio played. The icon
(double-chevron "skip-track"), the hardcoded `"…chapter"` aria-label, and the
audio-player framing all made one control mean two different things depending on
a hidden state — confusing, and an a11y name-vs-action defect. The root cause:
**paginated mode never had a page-turn affordance** (swipe/tap-zones are
scrolled-mode only), so the audio-styled arrows were conscripted into
page-turning and then overloaded.

A 10-pass adversarial critique/ideation loop (touch ergonomics, accessibility,
mental-model, cross-surface consistency, implementation risk; then status-quo,
edge-cases, design-system, naive user, power listener) converged on one
principle:

> **Chevrons move pages; media glyphs move audio; the pill is audio.** Reading
> navigation belongs to the reading surface, not a media transport.

### Shipped

- **Phase 0** — made the arrows' accessible name honest (page vs chapter).
- **Phase 1** — separated the metaphors:
  - `PageTurnRails`: paginated edge rails for page-turning (parent-DOM, RTL-mirrored).
  - The pill became a pure audio transport: arrows always "skip chapter",
    disabled while idle; `nextChapter`/`prevChapter` no longer turn pages.

### Explicitly rejected by the loop (do not re-litigate without new evidence)

- **Arrows always page-turn on the pill** — entrenches the audio/reading
  mixed-metaphor and deletes the listener's 1-tap chapter skip.
- **A section-skip button that appears only while playing** — layout shift,
  focus loss, and it reintroduces the mode-dependence the rework removed.
- **Long-press for the coarser action** — undiscoverable, a11y-hostile, fights
  text selection.
- **Pure relabel with no structural change** — leaves the missing page-turn
  affordance (the root cause) unfixed.

---

## Phase 2 ideas

Each item lists the motivating critique and the open questions to settle before
building.

### 1. Swipe-to-turn over the book text
The edge rails cover the margins; a horizontal **swipe** anywhere on the page is
the gesture most users reach for first (the naive-user pass: "I swiped, nothing
happened, I thought the app was frozen").

- **Why deferred:** touch events inside the epub.js iframe do not bubble to the
  parent, and the engine forwards only `click`/`keydown`, not touch. Swipe-over-
  text needs new iframe touch-forwarding through the `ReaderEngine` port (new
  event types + `FakeReaderEngine` + contract test).
- **Open questions:** gesture disambiguation vs. text-selection drag and vs. the
  OS edge-back gesture (iOS interactive-pop / Android back); velocity/distance
  thresholds; RTL swipe direction; how it interacts with audio-follow detach.

### 2. Wider tap-zones over the text (beyond the edge rails)
The touch-ergonomics pass wanted ~40–50%-width left/right zones (near-infinite
Fitts target) rather than the current ~56px edge rails.

- **Approach:** ride the engine `click` stream — `event.clientX / view.innerWidth`
  picks a zone; suppress on links, non-collapsed selection, and open
  popover/compass state.
- **Open questions:** is a center "toggle chrome/immersive" zone wanted? How do
  zones coexist with the visible edge rails (redundant or replace)? Selection
  near the middle must stay unaffected.

### 3. Correct RTL page-progression
Phase 1 mirrors the rails from a **language heuristic** (`isRtlLanguage`). A
book's OPF `page-progression-direction` can differ from its language.

- **Fix:** surface spine/page-progression direction through the `ReaderEngine`
  port and drive the rails (and any future swipe/zones) from it.
- **Open question:** also expose direction to other surfaces that assume LTR?

### 4. A real audio transport (the power-listener's ask)
During playback the pill offers only section skip. The heavy-listener pass's
most-frequent action is **re-hear the last sentence**, which today is
keyboard-only (`←` during audio) and absent on touch.

- **Idea:** an **expanded pill variant** (via the existing dispatcher, not
  intra-variant conditionals) with prev/next **sentence**, prev/next section, an
  inline scrubber, and speed — reachable in one place.
- **Glyph vocabulary (design-system pass):** page = single chevron; section =
  media skip (`⏮⏭`); sentence = a jog/labeled control, **never** a chevron (it
  would collide with page) and never `⏮⏭` (collides with section).
- **Open questions:** expanded-pill vs. routing this into `UnifiedAudioPanel`;
  tap-count targets (listener wants re-hear-sentence and skip-chapter at 1 tap);
  immersive/compact layout for the extra controls.

### 5. Re-home keyboard sentence-jump
`←/→` mean **sentence** during audio but **page** otherwise — the last
remaining state-dependence, and it disagrees with the pill (section) during
audio (the consistency pass's most-harmful inconsistency).

- **Idea:** make `←/→` always page; move sentence-jump to dedicated keys
  (e.g. `,`/`.` or `[`/`]`), surfaced in `ShortcutHelpSheet`.
- **Open question:** muscle-memory migration for existing users; one-time notice?

### 6. Chapter-jump without audio (re-activate the idle arrows)
Phase 1 disables the pill arrows when idle (design-system-endorsed "present but
disabled"). Some users may expect the arrows to jump **reader** chapters while
not listening.

- **Idea:** a reader-side `nextSection`/`prevSection` engine primitive so the
  arrows stay active and jump chapters while reading (audio-follow when playing,
  reader-display when idle) — one consistent "skip chapter" meaning in both states.
- **Open questions:** TOC-order vs. spine-order for "next chapter"; does this
  blur the "pill = audio" line the design-system pass drew? Decide whether
  greyed-when-idle is acceptable long-term (watch for user confusion first).

### 7. Discoverability / first-run coaching
No-swipe paginated mode is non-obvious. The rails are visible-but-subtle, which
partially mitigates; a stronger hint may help.

- **Options:** one-time coach overlay ("Tap the edges to turn the page") on first
  paginated open; brief rail emphasis that fades; or rely on the rails alone.
- **Open question:** measure first — do users find the rails unaided before
  adding chrome?

---

## Suggested sequencing

1. **#3 RTL direction** and **#5 keyboard re-home** are small, self-contained
   consistency wins.
2. **#7 discoverability** — cheap, de-risks the Phase 1 change; gate on feedback.
3. **#1 swipe** + **#2 tap-zones** — the larger gesture-layer project; do
   together behind the shared iframe-touch-forwarding work.
4. **#4 audio transport** — the biggest UX gain for listeners; design first.
5. **#6 idle-arrow chapter jump** — only if greyed-idle arrows prove confusing.
