# Citation-Aware Reference Detection — Design Doc

**Status:** Final draft for review
**Date:** 2026-06-06

---

## 1. Background & Problem

Versicle prunes citation markers (`[1]`, `<sup>1</sup>`, footnote links) so TTS doesn't read them aloud. This pruning is **destructive and happens at ingestion**, inside sentence extraction — the markers are gone from the stored TTS content before anything else can use them.

Separately, the GenAI content-analysis pipeline detects where a chapter's **reference section** (bibliography / endnotes) begins, so playback can skip it. That detection runs *after* ingestion, on the already-pruned text, and asks Gemini "where do the references start?".

The two systems work against each other:

- Inline citation markers are a **strong signal** for locating references.
- We delete that signal at the earliest possible stage, so detection runs blind.

**Goal:** preserve enough citation information for the detection logic to use, without regressing TTS audio (no markers spoken).

### Two distinct notions of "references"

| Notion | Example | Concern |
|---|---|---|
| **Inline citation markers** | `[1]`, `<sup>1</sup>`, a noteref link | Annoying for TTS; a *signal* for finding the section below |
| **Reference section** | the bibliography / endnotes block at chapter end | What detection locates so playback can skip it |

The first is a clue to the second. Pruning kills the clue before detection runs.

### Key constraint: capture must happen at ingestion

A natural idea is to move pruning later (to chapter-load time) so the markers survive. This does **not** work for DOM-level pruning. The DOM exists in only two places:

1. **Ingestion** — the offscreen renderer ([offscreen-renderer.ts:163](../src/lib/offscreen-renderer.ts)) actually *renders* each chapter in a hidden iframe, so `getComputedStyle` is available.
2. **Live reading** — epub.js renders into the reader iframe.

Stored TTS content has no DOM, and detection runs *ahead* of render (it pre-warms the next chapter), so there is no live DOM to fall back on. A DOMParser-only re-parse at load time has **no layout**, so computed style — the thing we need to recognize format-only citations (§4.1) — is unavailable.

**Therefore citation identity must be captured at ingestion.** We defer only the *audio removal*, never the *detection capture*.

### Design principle: do not depend on semantic markup

Real-world EPUBs are inconsistent. Citations are frequently done with **no semantic information**, purely through formatting:

- `<sup>1</sup>` — bare, no attributes
- `<span style="vertical-align:super;font-size:smaller">1</span>` — superscript via CSS, no `<sup>` tag
- `<a href="#x">1</a>` — plain anchor, no `epub:type`
- plain text `[1]`, `(1)`, `*`, `†` — zero markup

The current DOM heuristic ([tts.ts:170-179](../src/lib/tts.ts)) keys on `epub:type=noteref`, `role=doc-noteref`, and href patterns. These are unreliable. **This design treats semantic markup as an optional confidence booster, never a requirement.** The primary detector is format-derived.

---

## 2. Current Architecture

### 2.1 Pruning (two layers, both at ingestion)

**DOM-level** — [tts.ts:156-186](../src/lib/tts.ts), inside `extractSentencesFromNode`:

```ts
if (tagName === 'SUP' || tagName === 'A') {
    const text = el.textContent?.trim() || '';
    const isCitationText = /^\[?\d+\]?$/.test(text) || /^\(\d+\)$/.test(text) || /^[*†‡]+$/.test(text);
    if (isCitationText) {
        if (tagName === 'SUP') return;            // dropped, never enters a sentence
        else if (tagName === 'A') {
            // checks epub:type / role / href patterns, then returns (drops)
        }
    }
}
```

The element is dropped during traversal — its text never reaches a sentence, so the text-level sanitizer never sees it.

**Text-level** — `Sanitizer.sanitize` ([Sanitizer.ts:55-65](../src/lib/tts/processors/Sanitizer.ts)), using `RegexPatterns.CITATION_NUMERIC` (`/\[\s*\d+(?:\s*,\s*\d+)*\s*\]/`) and `CITATION_AUTHOR_YEAR`. Called per-segment at [tts.ts:96-98](../src/lib/tts.ts), gated by `sanitizationEnabled` (defaults `true`).

### 2.2 Ingestion flow

```
extractContentOffscreen (offscreen-renderer.ts:163)
  └─ renders each chapter in a hidden iframe
  └─ extractSentencesFromNode(body, cfiGen, options)   ← pruning happens here
  └─ produces ProcessedChapter { href, sentences: SentenceNode[], ... }
  └─ persisted to cache_tts_preparation as CacheTtsPreparation { sentences: {text, cfi}[] }
```

### 2.3 Reference-section detection (post-ingestion)

[AudioContentPipeline.getOrDetectContentTypes](../src/lib/tts/AudioContentPipeline.ts) (line 406) and `detectContentSkipMask` (line 354):

1. Load stored sentences via `dbService.getTTSContent`.
2. `groupSentencesByRoot` (line 526) groups sentences by parent block CFI → `{ rootCfi, segments, fullText }[]`.
3. Build `nodesToDetect = groups.map(g => ({ id, sampleText: g.fullText.substring(0, 200) }))` (line 460-467).
4. `genAIService.detectContentTypes` ([GenAIService.ts:259](../src/lib/genai/GenAIService.ts)) → Gemini returns `referenceStartIndex` → mapped to a `referenceStartCfi`.
5. Persisted to the synced content-analysis store (`saveReferenceStartCfi`, [useContentAnalysisStore.ts:118](../src/store/useContentAnalysisStore.ts)).
6. `detectContentSkipMask` marks every sentence from `referenceStartCfi` onward as skipped.

### 2.4 Data model (today)

```ts
// TTSContent.sentences and CacheTtsPreparation.sentences
{ text: string; cfi: string }[]

// SectionAnalysis (synced via Yjs)
{ referenceStartCfi?: string; tableAdaptations?; title?; status?; ... }

// ContentType = 'reference'   (content-analysis.ts)
```

IndexedDB schema: `EpubLibraryDB` v24 ([db.ts:105](../src/db/db.ts)). The cache stores (`cache_tts_preparation`, `cache_table_images`) are in the **"Ephemeral, Regenerable"** domain — safe to drop and re-derive. The detection *result* lives in the synced content-analysis store.

---

## 3. Goals & Non-Goals

### Goals

- Detection logic can use citation markers, including **format-only** citations (no semantic markup).
- **Zero TTS regression** — no markers spoken, existing audio behavior unchanged.
- Capture at ingestion (the only place with rendered DOM + computed style).
- Generic across book styles: numbered, symbol, bracketed, superscript-by-CSS.
- A deterministic, free detection path that can eventually replace the per-chapter LLM call, tuned from real-usage data.

### Non-Goals

- Changing how the reference section is *skipped* during playback (the `referenceStartCfi` → skip-mask flow stays).
- Per-marker inline footnote skipping (interleaved footnotes mid-body) — noted as a future extension (§8).
- Re-rendering chapters at load time.
- Touching the synced sync-manifest schema (citation markers are cache-tier, not synced).

---

## 4. Design

Two complementary detectors run at ingestion and emit a single, **semantics-free** citation-marker sidecar stored alongside the sentences. Detection consumes the sidecar; TTS is untouched.

### 4.1 Generic citation-marker detection (ingestion)

Replace the semantic checks at [tts.ts:156-186](../src/lib/tts.ts) with a format-derived classifier. A run of text is a citation marker if it satisfies both a *form* test and a *content* test.

**Detector A — styled / superscript element** (needs rendered context, available in the offscreen renderer):

```ts
const win = el.ownerDocument.defaultView;
const cs = win.getComputedStyle(el);
const parentFontSize = parseFloat(win.getComputedStyle(el.parentElement).fontSize);

const isSuperForm =
     el.tagName === 'SUP'
  || cs.verticalAlign === 'super' || cs.verticalAlign === 'sub'
  || (parentFontSize && parseFloat(cs.fontSize) < parentFontSize * 0.85);

const text = el.textContent?.trim() || '';
const isMarkerContent =
     /^\[?\(?\d{1,3}\)?\]?$/.test(text)   // 1, [1], (1), 12
  || /^[*†‡§¶]+$/.test(text);            // symbol markers

const glued = /* no whitespace between marker and the preceding text node */;
```

This catches `<sup>`, CSS-only superscript spans, and styled anchors — **independent of tag and attribute**. Computed style is the key enabler and is only available because the offscreen renderer truly renders the chapter.

**Detector B — plain-text marker**: the existing `Sanitizer` / `RegexPatterns` regexes, for markers with no element wrapper (`[1]` inline in a `<p>`).

**Semantic boost (optional):** if `epub:type=noteref` / `role=doc-noteref` / href to `#…`/notes/endnotes is present, raise the marker's confidence. Never required.

**False-positive guards:**

- Marker content must be an integer (1–3 digits) or a known symbol. Ordinals (`1ˢᵗ` → text `"st"`) are excluded automatically (non-numeric).
- Skip if inside `<math>` / MathML, or if the preceding character is a letter/digit suggesting a math exponent (`x²`).
- Require prose context (parent is a text block, not an equation/table cell).

### 4.2 Marker storage (semantics-free, folded into TTS prep)

Both detectors emit per-section marker records. **Stored sentence text stays clean** (no markers re-inserted), so TTS is untouched. Markers live **alongside the sentences in `CacheTtsPreparation`** — they are produced in the same extraction pass and have identical lifetime, so co-locating avoids a second write/cleanup path.

```ts
interface CitationMarker {
  cfi: string;            // location of the marker
  markerText: string;     // "1", "[1]", "*", … (for set-matching)
  super: boolean;         // form: superscripted / smaller font
  numeric: boolean;       // content: integer vs symbol
  glued: boolean;         // attached to preceding word (no space)
  fontSizeRatio?: number; // Detector A diagnostic (fixed 0.85 cutoff, not tuned)
  targetHref?: string;    // optional semantic boost only
}

// Extended CacheTtsPreparation (db.ts) — additive optional field
interface CacheTtsPreparation {
  id: string;             // `${bookId}-${sectionId}`
  bookId: string;
  sectionId: string;
  sentences: { text: string; cfi: string }[];
  citationMarkers?: CitationMarker[];   // NEW — optional, regenerable
}
```

Same store (`cache_tts_preparation`), same key, same regenerable/cache domain, not synced. No new object store (see §5).

> **Why a sidecar field instead of inlining markers back into sentence text?**
> Inlining (keeping `[1]` in the stored text and stripping at speak-time) pollutes the spoken text, risks highlight/segmentation drift, and is ambiguous for `<sup>1</sup>` (text is just `"1"`). A clean sidecar field keeps TTS text untouched, carries richer per-marker features, and enables the deterministic detection in §4.3.

### 4.3 Reference-section detection (user-selectable strategy)

Detection strategy is **user-selectable**, with **Gemini as the default**. Defaulting to Gemini ensures the LLM path runs on real books so we can collect telemetry (§4.4) and tune the deterministic detector before trusting it.

New setting in `useGenAIStore`, surfaced in `GenAISettingsTab`:

```ts
referenceDetectionStrategy: 'gemini' | 'deterministic';  // default: 'gemini'
```

**Strategy `gemini` (default).** Reuse the existing `detectContentTypes` call ([GenAIService.ts:259](../src/lib/genai/GenAIService.ts)), enriching each node with format-derived features from the sidecar:

```ts
nodesToDetect = groups.map(g => ({
  id,
  sampleText: g.fullText.substring(0, 200),
  citationMarkerCount: /* markers whose cfi falls in g */,
  hasSuperscriptMarkers: boolean,
}));
```

The density gradient (high inline-marker density in body → transition → enumerated list) gives Gemini a stronger feature than prose alone. Every Gemini decision emits a telemetry record (§4.4).

**Strategy `deterministic` (opt-in).** Runs cheapest-first, no LLM:

- **Step 1 — enumerator-list run.** Scan groups from `groupSentencesByRoot`. A reference/endnote block is a run of consecutive sibling blocks each beginning with an enumerator: `^\[?\d+\]?[.)]?\s` or `^\d+\.\s`. The first block of the longest tail run → `referenceStartCfi`. Language- and format-agnostic.
- **Step 2 — marker-set matching.** Collect the set of inline marker values used in the body (`{1, 2, …, N}`) from the sidecar. Find the tail region whose leading enumerators match (≈ same set / superset). Strong even for pure-formatting books. Replaces the old semantic href-resolution idea (which depended on anchors).

**Output is identical regardless of strategy:** a single `referenceStartCfi` saved via `saveReferenceStartCfi`, consumed by `detectContentSkipMask` exactly as today.

### 4.4 Tuning the deterministic detector via GenAI-oracle telemetry

**What we tune.** Not Detector A's font-size ratio — that is a fixed internal constant (`< 0.85`). The thing we want to tune from real usage is the **deterministic reference-section detector** (Steps 1–2), so it can eventually become the default and stop paying for Gemini on every chapter.

**Mechanism — Gemini as oracle, deterministic as shadow.** Gemini is the higher-quality method, so treat its decision as the label. Whenever the Gemini strategy runs (the default), **also run the deterministic detector in shadow** (no API cost — pure local computation) and log:

- Gemini's decision (the label),
- the deterministic detector's decision under current thresholds,
- whether they agree,
- and the **raw, pre-threshold features** the deterministic detector consumed, so every threshold can be swept *offline* against the collected dataset without re-running anything.

The shadow result is logged but **not used** to drive playback while Gemini is the active strategy — Gemini's `referenceStartCfi` stays authoritative for skipping.

**What's tunable in the deterministic detector.**

| Step | Parameter | Meaning |
|---|---|---|
| 1 | `enumeratorPatterns` | which leading forms count: `[n]`, `n.`, `n)`, `(n)`, bare `n`, roman `i.`, symbols `*†‡` |
| 1 | `minRunLength` | min consecutive enumerated blocks to call it a reference run |
| 1 | `tailProximity` | how close the run must be to section end (within last X% / must reach last block) |
| 1 | `gapTolerance` | non-matching blocks allowed inside a run (e.g. a "References" heading) |
| 1 | `requireSequential` / `requireStartAtOne` | enumerators must increase `1,2,3…` / start at 1 |
| 2 | `minBodyMarkers` | don't trust set-matching below K inline body markers |
| 2 | `overlapThreshold` | min fraction of body marker set `{1..N}` covered by tail enumerators |
| 2 | `allowSuperset` | tail may contain extra entries beyond the body set |
| 2 | `densityDropThreshold` | inline-marker density gradient cutoff marking the body→references transition |
| — | step arbitration | priority / scoring weights when Step 1 and Step 2 disagree |

**What we collect (per section, when Gemini runs).** Raw features, so every parameter above can be re-evaluated offline from the log alone:

```ts
interface ReferenceDetectionTelemetry {
  bookTitle: string;
  sectionTitle: string;
  sectionId: string;

  // ── ORACLE (Gemini) — the label ──
  geminiReferenceStartCfi?: string;
  geminiReferenceStartIndex: number;     // -1 if none
  geminiJustification?: string;          // from detectContentTypes response

  // ── DETERMINISTIC SHADOW — decision under current thresholds ──
  deterministicReferenceStartCfi?: string;
  deterministicDecidedBy: 'enumerator' | 'setMatch' | 'none';
  agreement: boolean;                    // same group as Gemini?

  // ── RAW FEATURES — sweep thresholds offline without re-running ──
  totalGroups: number;
  longestTailEnumeratorRun: number;      // for minRunLength sweep
  perGroup: Array<{
    index: number;
    rootCfi: string;
    enumeratorMatch: boolean;            // Step 1
    enumeratorType: 'bracket'|'dot'|'paren'|'bare'|'roman'|'symbol'|null;
    enumeratorValue: number | null;
    inlineMarkerCount: number;           // Step 2 density
    fractionFromEnd: number;             // tailProximity sweep
  }>;
  bodyMarkerSet: number[];               // Step 2 {1..N}
  tailEnumeratorSet: number[];
  setOverlapFraction: number;            // overlapThreshold sweep

  timestamp: number;
}
```

Choosing (say) `minRunLength` or `overlapThreshold` then becomes a one-pass offline computation over the exported logs: for each candidate value, count the sections where the deterministic decision would match `geminiReferenceStartCfi`.

**Storage — reuse the existing GenAI log channel.** `GenAIService` routes structured entries through `setLogCallback` → `useGenAIStore.addLog` → `logs: GenAILogEntry[]` (persisted to `localStorage` under `genai-storage`), exportable via the existing **"Download GenAI Logs"** action ([GlobalSettingsDialog.tsx:345](../src/components/GlobalSettingsDialog.tsx)). Emit telemetry as a log entry (`type: 'response'`, `method: 'detectReferenceStart'`, `payload: ReferenceDetectionTelemetry`). Zero new infrastructure. **Raise `maxLogs`** (default 100) so sustained collection doesn't roll over before review; a durable store is deferred unless records are lost.

**Tuning loop.** Manual review of the exported JSON (no automated sweep tooling for now). The exported records contain enough raw features to choose thresholds by hand or with an ad-hoc script.

### 4.5 What changes vs. what stays

| Area | Change |
|---|---|
| `extractSentencesFromNode` (tts.ts) | Replace semantic citation branch with Detectors A+B; emit markers instead of silently dropping. Sentence text stays clean. |
| `Sanitizer` | Unchanged regexes; reused by Detector B. Still strips from spoken text. |
| `CacheTtsPreparation` (db.ts) + `CitationMarker` type | Add optional `citationMarkers` field. No new object store. |
| `ProcessedChapter` / offscreen renderer | Carry `citationMarkers` alongside `sentences`; persist in TTS prep. |
| `AudioContentPipeline` detection | User-selectable strategy; enrich Gemini input; implement deterministic Steps 1–2; **shadow-run deterministic when strategy is `gemini`** for telemetry. |
| `useGenAIStore` / `GenAISettingsTab` | Add `referenceDetectionStrategy` setting (default `gemini`); raise `maxLogs`. |
| Telemetry | Emit `detectReferenceStart` entry (Gemini label + deterministic shadow decision + raw features) through the existing GenAI log channel. |
| Persist helper | Add `toCacheTtsPrep(chapter)` used by all TTS-prep writes (§5.1). |
| `CURRENT_BOOK_VERSION` (constants.ts) | Bump `9 → 10` to trigger reprocessing (§6). |
| `referenceStartCfi` flow + skip mask | Unchanged. |
| Synced content-analysis store | Unchanged. |

---

## 5. Data Model & Schema Changes

**No new object store.** Markers fold into the existing `cache_tts_preparation` store:

- `CacheTtsPreparation` ([db.ts:66](../src/db/db.ts), type at [db.ts:322](../src/types/db.ts)) gains an optional `citationMarkers?: CitationMarker[]` field. IndexedDB is schemaless within a store, so **no DB version bump is required** for the store, and `saveTTSContent` / `getTTSContent` ([DBService.ts:860-875](../src/db/DBService.ts)) carry the field for free.
- New `CitationMarker` type (§4.2).
- New `referenceDetectionStrategy` field in `useGenAIStore` (`localStorage`-persisted; `partialize` already passes everything through).

No change to `TTSContent` (the read-projection mirrors the cache field), `SectionAnalysis`, or the sync manifest.

> The **book pipeline version** (`CURRENT_BOOK_VERSION`) is bumped separately (§6) to force re-extraction — an app-level content version, distinct from the IndexedDB `EpubLibraryDB` schema version (24, unchanged).

### 5.1 Persistence sites that must carry the new field

The TTS-prep write path uses **explicit field lists**, not object spreads, at every boundary. A new `citationMarkers` field would be **silently dropped** unless each site is updated — and because these are explicit copies, a missed site is a silent data-loss bug (markers extracted, never persisted) that won't surface as a type error if carrier types are loose.

| # | Site | Current shape | Action |
|---|---|---|---|
| 1 | `ProcessedChapter` ([offscreen-renderer.ts:28](../src/lib/offscreen-renderer.ts)) | `{ href, sentences, textContent, title?, tables? }` | add `citationMarkers?` |
| 2 | `extractContentOffscreen` ([offscreen-renderer.ts:301](../src/lib/offscreen-renderer.ts)) | builds chapter from `extractSentencesFromNode` | also collect markers, set on chapter |
| 3 | Reprocess — batch build ([ingestion.ts:128-133](../src/lib/ingestion.ts)) | `{ id, bookId, sectionId, sentences }` | include `citationMarkers` |
| 4 | Reprocess — `prepStore.put` ([ingestion.ts:196-202](../src/lib/ingestion.ts)) | `{ id, bookId, sectionId, sentences }` | include `citationMarkers` |
| 5 | Initial ingest — batch build ([ingestion.ts:337-342](../src/lib/ingestion.ts)) | `{ id, bookId, sectionId, sentences }` | include `citationMarkers` |
| 6 | DBService persist — `item` ([DBService.ts:380-385](../src/db/DBService.ts)) | `{ id, bookId, sectionId, sentences }` | include `citationMarkers` |
| 7 | `TTSContent` carrier type ([db.ts:692](../src/types/db.ts)) | `sentences` only | add `citationMarkers?` |

`saveTTSContent` / `getTTSContent` pass the whole object through, so the read path and any pipeline-side save are already field-agnostic — only the ingest/reprocess explicit puts are the hazard.

**Decided fix (part of this work):** centralize the field list in a single `toCacheTtsPrep(chapter)` helper used by all persist sites (reprocess, initial ingest, DBService). The marker field — and any future field — can then only be added in one place. Sites 3–6 above are replaced with calls to that helper.

---

## 6. Migration & Backward Compatibility

Reuse the existing pipeline-version reprocessing mechanism — no bespoke backfill.

- **Bump `CURRENT_BOOK_VERSION` `9 → 10`** ([constants.ts:12](../src/lib/constants.ts)), with a changelog line:
  ```
  10: Capture citation markers during extraction (citation-aware reference detection).
  ```
- Books carry a stored pipeline version. On first open of a book whose version `< 10`, the existing reprocessing flow (`reprocessBook`, [ingestion.ts:53](../src/lib/ingestion.ts); interstitial at [ReprocessingInterstitial.tsx](../src/components/library/ReprocessingInterstitial.tsx)) re-extracts and populates `citationMarkers`.
- **Verified**: `reprocessBook` deletes the book's old `cache_tts_preparation` rows ([ingestion.ts:194](../src/lib/ingestion.ts)) and writes fresh ones ([ingestion.ts:195-202](../src/lib/ingestion.ts)) in one transaction, then sets `manifest.schemaVersion = CURRENT_BOOK_VERSION` ([ingestion.ts:171](../src/lib/ingestion.ts)). The backfill overwrites cleanly — provided the §5.1 sites (via the `toCacheTtsPrep` helper) are updated.
- Until a given book is reprocessed, `citationMarkers` is `undefined`; detection degrades gracefully (Gemini runs on `sampleText` alone, as today; the deterministic enumerator-run still works off sentence text).

---

## 7. Risks & Edge Cases

- **Math / exponents**: `x²` is superscript + numeric → false positive. Guarded by a MathML check + preceding-char heuristic (§4.1). Residual risk in math-heavy books; acceptable for a TTS skip signal.
- **Computed-style availability**: Detector A requires a rendered context — valid in the offscreen renderer (and the live reader). If `getComputedStyle` is unavailable (detached DOM), fall back to tag-only (`<sup>`/`<sub>`) + Detector B. This invariant should be documented on `extractSentencesFromNode`.
- **Performance**: `getComputedStyle` per candidate element adds ingestion cost. Mitigate by calling it only on plausible markers (short text, `<sup>`/`<a>`/`<span>`), not every node.
- **CJK / non-Latin enumerators**: Step 1's regex is Latin-digit biased. Marker-set matching (Step 2) is more robust; the Gemini path covers the rest.
- **Highlighting**: unchanged — markers are not reinserted into spoken text, and CFIs are unaffected.
- **Silent field drop on persist**: addressed by the centralized `toCacheTtsPrep` helper (§5.1).

---

## 8. Future Extensions (out of scope)

- **Per-marker inline skip**: interleaved footnotes mid-body (not just a chapter-end block). The sidecar's per-marker CFIs already support building a sparse skip set, not only a single `referenceStartCfi`. Would require extending the skip-mask model.
- **Surfacing footnotes on demand**: with markers preserved as metadata, the reader could let a user tap a marker to read the corresponding note — impossible under the current destructive prune.

---

## 9. Decisions Log

| # | Decision |
|---|---|
| 1 | **Marker storage** — fold `citationMarkers` into `CacheTtsPreparation`; no separate store. (§4.2, §5) |
| 2 | **Detection strategy** — user-selectable `referenceDetectionStrategy`, **default Gemini** so the oracle runs and feeds telemetry; deterministic Steps 1–2 implemented but opt-in. (§4.3) |
| 3 | **Reprocessing** — bump `CURRENT_BOOK_VERSION` `9 → 10`; existing reprocess-on-first-open handles backfill. (§6) |
| 4 | **Telemetry purpose** — capture, on every Gemini run, the Gemini label + a shadow deterministic decision + raw pre-threshold features, to tune the **deterministic detector** offline. Detector A's `0.85` is a fixed constant, not a telemetry target. (§4.4) |
| 5 | **Persistence safety** — centralize TTS-prep writes through a `toCacheTtsPrep(chapter)` helper. (§5.1) |
| 6 | **Telemetry retention** — reuse the existing GenAI log channel + "Download GenAI Logs"; raise `maxLogs`. Durable store deferred. (§4.4) |
| 7 | **Tuning loop** — manual review of exported logs; no automated sweep tooling for now. (§4.4) |

## 10. Deferred / To Decide Later

- **Promotion criterion** — what agreement rate vs. Gemini justifies flipping the default `referenceDetectionStrategy` to `deterministic`. To be decided once telemetry exists.
