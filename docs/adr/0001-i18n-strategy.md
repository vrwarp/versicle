# ADR 0001: Internationalization strategy — "i18n-ready, English-only"

- **Status:** Accepted (2026-06-10, Phase 0 of the overhaul)
- **Deciders:** Versicle overhaul program (master plan
  `plan/overhaul/README.md`; synthesis of the gap analysis
  `plan/overhaul/analysis/gap-internationalization-string-ex.md`)
- **Phases bound by this ADR:** 7 (library/search/google/egress), 8
  (shell/settings/a11y-i18n choke points), and every rewrite that freezes a
  string-passing API shape.

## Context

Versicle has **no UI-internationalization layer of any kind**: no i18n
dependency, zero reads of `navigator.language`, no locale preference in any
store, a hardcoded `<html lang="en">`, and ~800+ user-visible English
strings inlined across ~100 files (≈348 quoted phrases and ≈186 JSX text
nodes in components, 159 `aria-label`s, 81 `showToast(...)` call sites, 24
native `confirm()`/`alert()` sites, ~53 `throw new Error('<English prose>')`
in lib/services/db that components surface verbatim). Three hand-rolled
relative-time implementations, five byte-size formatters, and hand-rolled
English pluralization coexist with zero uses of `Intl.RelativeTimeFormat`/
`Intl.NumberFormat`/`Intl.Collator`. The TTS pipeline speaks hardcoded
English filler/preroll through whatever voice is active — including Chinese
voices on Chinese books. (Full evidence: the gap report, items I18N-1..11.)

Meanwhile the product is explicitly a Mandarin-learner's reading tool
(pinyin, OpenCC, CC-CEDICT, zh TTS voices), so a Chinese UI locale is the
obvious eventual ask. And what *does* exist — the **content-language**
pipeline (`book.language` extracted at ingestion, normalized by
`src/lib/language-utils.ts`, driving font profiles, lexicon filtering, TTS
segmentation, and pinyin/OpenCC activation) — is sound and must not be
conflated with any future UI locale.

The decision has a deadline: the overhaul (Phases 7–8) rewrites exactly the
choke points where i18n plugs in — the queue-based toast store, the
`presentError(err)` mapper, `useConfirm()`, the settings registry, locale
formatters. If those new APIs are designed around raw `string` prose, a
later zh-UI request re-touches all ~800 call sites *plus* the freshly
rewritten infrastructure: the migration gets paid twice. If they are
designed around message keys, localization later touches catalog files only.

## Decision

**Adopt "i18n-ready, English-only": no user-facing locale work now; every
new choke-point API is keyed from day one; full catalog extraction is
deliberately deferred.**

Concretely:

1. **No user-facing locale work in Phases 0–7.** No i18n library is adopted
   now, no language picker ships, no translation files are authored, and no
   standalone "externalize all strings" pass is ever scheduled. English
   remains the only shipped UI locale until after the overhaul.
2. **New choke-point APIs accept message keys + params from day one.** The
   contracts built in Phases 7–8 — the toast queue store, `presentError`,
   `useConfirm()`, the settings registry's labels, and the TTS spoken-string
   path — take `(messageKey, params)` (typed), not English prose:
   - Errors carry `code` + structured params (e.g.
     `{ code: 'DUPLICATE_BOOK', filename }`); `message` remains an English
     developer/log string. `presentError` resolves `code → catalog key →
     display string`; UI never renders `err.message` verbatim (today
     `App.tsx`'s unhandledrejection handler and several views do exactly
     that — the gap report's I18N-2).
   - The catalog namespace is domain-keyed (`library.import.failed`,
     `errors.DUPLICATE_BOOK`, …); the `errors.*` namespace is keyed 1:1 by
     error `code`.
   - Components may still author prose inline for now — only the *shared
     infrastructure contracts* are key-based. Inline strings are
     externalized opportunistically when their component is rewritten, never
     as a big-bang pass.
3. **Document/content `lang` management is a Phase 8 deliverable:**
   `document.documentElement.lang` set from a single locale module at
   boot/change (replacing the static `lang="en"` in `index.html`), and
   `lang={book.language}` attributes on top-document elements that render
   book-sourced text (library card titles/authors, notes excerpts, TOC
   labels, dictionary entries). This is a *today*-correctness fix for the
   zh audience (Han-unification glyph selection, screen-reader voice
   choice), independent of UI translation. Phase 8 also lands the cached
   `Intl`-based formatter module (`formatDate/RelativeTime/Bytes/Percent`,
   `compareTitles`) that replaces the triplicated hand-rolled formatters —
   formatting consistency is required even with one locale.
4. **The two-locale rule.** UI locale (a per-device preference, when it
   exists) governs chrome strings, formatting, and collation. The existing
   `book.language` governs segmentation, voices, pinyin/OpenCC, TTS spoken
   filler, and content `lang=` attributes. Neither ever substitutes for the
   other; nothing today wrongly crosses that line and nothing may start to.
5. **Full catalog extraction is deferred — deliberately.** Externalizing the
   ~800 existing strings happens incrementally inside each already-planned
   component rewrite (settings registry, CompassPill dissolution, library
   views, reader panels), where re-authoring the strings is free. A
   `no-literal-string`-style lint rule is enabled per-directory as each is
   migrated, never repo-wide ahead of migration (ratchet model, master plan
   §4 rule 3).
6. **Library choice is deferred to the phase that needs it** (Phase 8 at the
   earliest), but is bound by constraints recorded now from this codebase:
   usable from plain TS modules **and inside the TTS Web Worker** (spoken
   strings live in the engine layer — rules out React-context-bound i18n),
   type-safe message keys, ICU plural/select, small runtime with lazy locale
   loading, per-message tree-shaking preferred. The gap report's evaluation:
   paraglide-js (inlang) first choice, @lingui/core fallback; react-i18next
   fails the type-safety and tree-shaking constraints.

## Consequences

Positive:

- Shipping a zh-Hans/zh-Hant (or any) UI locale later touches catalog files
  + a settings dropdown — not the ~800 call sites and not the Phase 7–8
  infrastructure. The expensive migration is paid exactly once, riding
  rewrites that were happening anyway.
- Error copy ownership moves out of the service/persistence layers as a
  side effect of the `code`+params contract (also a type-safety win — same
  defect flagged from the error-handling angle in
  `plan/overhaul/analysis/type-safety-errors.md`).
- The TTS engine stops speaking randomized English filler through zh voices
  once its spoken strings are keyed and resolved by `book.language`
  (deterministic messages also fix the audio-cache fragmentation the
  randomization causes).
- No translation/maintenance burden is taken on now; no library bet is made
  before the worker-bundling constraint can be tested for real.

Negative / accepted costs:

- Today's mixed-language chimera output (English "5m ago" beside
  system-locale dates in the same widget) persists until the Phase 8
  formatter module lands.
- Key-based choke-point APIs are slightly more ceremony than passing strings
  (`showToast({ key: 'library.import.failed', params })` vs
  `showToast('Import failed')`) while the catalog is still mostly empty.
- A handful of content-language correctness bugs adjacent to this gap
  (en-hardcoded CFI segmenter `src/lib/cfi-utils.ts`, the en/zh-only
  override Select in `VisualSettings.tsx`, GenAI smart-TOC baking
  English-first titles into persisted data) are *not* solved by this ADR;
  they are owned by their subsystems' phases (5c, 6, 7 respectively) and
  listed in the gap report as I18N-7/8/9.

## Compliance

- Reviewers of Phase 7–8 PRs check that no new shared API (toast, error
  presentation, confirm, settings registry, spoken strings) takes raw
  user-facing prose at its boundary.
- This ADR is the recorded decision the gap report demanded (I18N-1);
  superseding it requires a new ADR in this directory.
