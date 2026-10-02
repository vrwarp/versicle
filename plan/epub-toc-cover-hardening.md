# Plan: Harden TOC and cover handling for malformed EPUBs

> **Status: REVIEWED — decisions recorded in §9.** Nothing here is
> implemented yet.
> Program rules in `plan/overhaul/README.md` §4 apply to every PR below.

Trigger: a user import of *When I Don't Desire God* (Crossway, built with
InDesign → Sigil) shows the "Aa" placeholder instead of a cover, and **every**
TOC click — publisher TOC, the "synthetic" TOC toggle, and *Enhance TOC* —
fails. Both are valid-but-unusual packaging that we hand straight to epub.js
0.3.93 defaults with no fallback. This plan fixes that book and the wider
class of "the EPUB is a bit off" failures, for local import, the live reader,
reprocess, and the Drive partial-fetch preview.

---

## 1. Root cause (reproduced in Chromium with the real file)

| Probe | Result |
|---|---|
| `book.packaging.coverPath` / `book.coverUrl()` | `false` / `null` |
| `book.packaging.navPath` | `Text/toc.xhtml` (nav doc in a subfolder) |
| nav TOC entry href | `../Text/CH1.xhtml` (relative to the nav doc — spec-correct) |
| `spine.get('../Text/CH1.xhtml')` → `rendition.display()` | `null` → **"No Section Found"** |
| `book.load('../Text/CH1.xhtml')` (Enhance TOC path) | resolves to `/Text/CH1.xhtml` → **"File not found in the epub"** |
| `spine.get('Text/CH1.xhtml')` (OPF-relative) | works |

**Cover.** The OPF has neither `properties="cover-image"` (EPUB 3) nor
`<meta name="cover">` (EPUB 2) and no `<guide>`. The cover exists only as
spine item #1, `Text/cover.xhtml`, `<section epub:type="cover"><img
src="../Images/WhenIDontDesireGod_FC.jpg">`. epub.js `findCoverPath` checks only
the two OPF markers; `extractPreamble`
(`src/domains/library/import/extract.ts:167`) has no fallback. The Drive
preview's heuristic (`findCoverHref`, `src/lib/epub/remoteEpub.ts:221`)
requires "cover" in the image id/href — this file is `…_FC.jpg`, so it misses
too.

**TOC.** epub.js `Navigation.navItem` stores nav `href`s verbatim; it never
resolves them against the nav document's directory. `Spine.get` and
`Book.load` both expect OPF-relative paths. So:

- Publisher TOC → `commands.jumpTo(href)` → `engine.display()` rejects; the
  rejection is only logged (`src/app/reader/useReaderController.ts:855`), so
  the click silently does nothing.
- "Synthetic" TOC → it is `static_structure.toc` (`BookRepository.ts:65`),
  which import fills with the **publisher** TOC whenever one exists
  (`extract.ts:439`, `reprocess.ts:99`). Same broken hrefs.
- *Enhance TOC* → `useSmartTOC` → `engine.loadSectionText(item.href)` →
  `book.load()` throws for every item → zero sections → "Failed to enhance
  TOC."
- Active-chapter highlighting *does* work, by accident: `matchPaths`
  (`src/lib/reader/titleResolver.ts:10`) suffix-matches `../Text/CH1.xhtml`
  against `Text/CH1.xhtml`.

The NCX (`toc.ncx`, beside the OPF) has OPF-relative hrefs that *would*
resolve, but epub.js prefers the nav doc — and every NCX label is the
placeholder `*FIX_When I Don't Desire God.543173.int`.

---

## 2. Failure taxonomy

What "poorly formatted" means in practice. ✔ = handled today, ✘ = not,
◐ = partially. **Bold** = the trigger book hits it.

### TOC

| # | Shape | Today |
|---|---|---|
| **T1** | **Nav doc in a subfolder; hrefs relative to it (`../Text/x.xhtml`)** | ✘ |
| T2 | Percent-encoding mismatch between TOC href and manifest href (`don%27t` vs `don't`, spaces, non-ASCII) | ◐ (`Spine.get` tries `encodeURI` only one way) |
| T3 | Case mismatch (`CH3.xhtml` vs `Ch3.xhtml`) — works on case-insensitive authoring filesystems | ✘ |
| T4 | Leading `./`, leading `/`, `OEBPS/`-prefixed (zip-root-relative) hrefs, backslashes | ✘ |
| T5 | Href targets a manifest item that is **not in the spine** (or a missing file) | ✘ (silent failure) |
| T6 | Fragment-only href (`#ch1`) or href with only a fragment into the current doc | ✘ |
| **T7** | **Garbage/placeholder labels** (`*FIX_…`, all-identical, empty, filenames) | ✘ (shown verbatim) |
| T8 | Nav present but empty / non-`toc` nav picked; NCX would have been usable | ✘ (no source arbitration) |
| T9 | Nav uses `<span>` headings with no href (grouping nodes) | ◐ (rendered, click fails) |
| T10 | No TOC at all | ✔ (synthetic from spine) |

### Cover

| # | Shape | Today |
|---|---|---|
| **C1** | **No OPF cover markers; cover is an `<img>` in a cover XHTML (spine #1 / `epub:type="cover"`)** | ✘ |
| C2 | Cover XHTML uses SVG `<image xlink:href>` (very common from Calibre/InDesign) | ✘ |
| C3 | `<guide><reference type="cover">` (EPUB 2) or nav `landmarks` `epub:type="cover"` only | ✘ |
| C4 | `<meta name="cover" content="…">` whose content is an **href** or filename, not a manifest id | ✘ |
| C5 | `cover-image` / meta points at an **XHTML** item, not an image | ✘ (fetches HTML as an "image") |
| C6 | Cover href points to a missing file, or percent-encoding differs from the zip entry name | ✘ (local ◐ — epub.js decodes; remote doesn't) |
| C7 | Image is undecodable (CMYK/corrupt JPEG), tiny (logo/spacer), or absurd aspect ratio | ◐ (compression failure falls back to original bytes; nothing validates the result) |
| C8 | Image id/href contains "cover" (no markers) | local ✘, remote ✔ |

---

## 3. Goals / non-goals

**Goals**

1. Every TOC entry whose target exists in the book navigates — from the
   publisher TOC, the stored/"synthetic" TOC, and *Enhance TOC* — for books
   **already in the library** as well as new imports, with no re-import.
2. A cover is found for any book that visibly has one (C1–C8), on local
   import, reprocess, and the Drive preview, through **one** shared resolver.
3. Failures are visible: a TOC entry that cannot resolve is marked and a
   click on it says so; a skipped cover candidate records why.
4. All resolution logic is pure (parsed XML/XHTML + a file-exists/read port in,
   a decision out) and unit-tested without epub.js.

**Non-goals**

- Replacing epub.js, or patching it in `node_modules`.
- Fixing malformed **content** documents (broken XHTML, bad CSS).
- AI-generated TOC labels on import (Enhance TOC stays opt-in), and
  AI/vision cover detection.
- A `DB_VERSION` bump. The `NavigationItem` shape is unchanged; only href
  *values* become canonical (see §6).

---

## 4. Design

### 4.1 New pure module: `src/lib/epub/structure/`

Lives beside `remoteEpub.ts` so both the local and remote paths share it.
No epub.js, no stores, no DOM globals beyond `DOMParser` output types.

```
src/lib/epub/structure/
  paths.ts          resolveRelative, dirname, safeDecode, canonicalKey
  spineIndex.ts     SpineIndex: canonical-key → spine href lookup
  tocResolver.ts    resolveToc(), scoreToc(), chooseTocSource()
  coverResolver.ts  findCoverCandidates(), chooseCover()
  index.ts
```

- **`paths.ts`**:
  - `resolveRelative(baseFile, href)`: RFC-3986 dot-segment resolution and
    fragment preservation.
  - `safeDecode`: never throws on a malformed `%`.
  - `canonicalKey(path)`: decode, then NFC-normalize, then fold `\`→`/`, strip
    leading `./` and `/`, then lowercase.
  - This replaces the ad-hoc `resolvePath` in `remoteEpub.ts:209` and is the
    one definition the reader, import and remote path share.
- **`SpineIndex`** is built from the OPF directory plus manifest and spine.
  It maps each key below to the exact spine href epub.js wants
  (OPF-relative, as written in the manifest):
  - the exact href;
  - the decoded href;
  - the encoded href;
  - the canonical key;
  - the zip-root-relative path;
  - the basename, **only when it is unique** in the book.

### 4.2 TOC resolution (fixes T1–T9)

`resolveToc(items, { navPath, opfPath, spine: SpineIndex, manifest })`
walks the tree and, per entry, tries this **candidate ladder**, taking the
first hit in the spine:

1. href as-is (already OPF-relative — this makes the pass **idempotent**,
   so it is safe on stored TOCs that were already fixed)
2. href resolved against the **nav/NCX document's directory** (T1)
3. href resolved against the zip root (T4 `OEBPS/…`, leading `/`)
4. decoded / encoded variants of 1–3 (T2)
5. canonical (case-folded) key match (T3)
6. unique-basename match (last resort)

On a hit it rewrites `href` to `spineHref + fragment`. If the href only exists
in the **manifest**, not the spine (T5), it is mapped to the nearest following
spine item, and failing that the preceding one. If nothing resolves, it is
left as is and flagged `unresolved: true` (a new **optional** field on
`NavigationItem`, which the zod row schema accepts as optional).
Fragment-only hrefs (T6) are resolved against the spine item of the nearest
ancestor/preceding entry. Grouping nodes without an href (T9) get the first
resolvable child's target.

**Source arbitration (T7, T8).** `chooseTocSource({ nav, ncx, spine })`
scores each candidate tree:

- **resolve rate**: the fraction of entries that land in the spine;
- **label quality**: penalizes the following labels (decision §9.5):
  - empty labels;
  - all-identical labels;
  - labels that are filenames;
  - labels that match a placeholder pattern (`^\*?FIX_`, `.int$`, `Untitled`,
    etc.);
  - **bare ordinal labels** — "Chapter 7", "Ch. 7", "Part II", "7" — matching
    `^(chapter|ch\.?|part|section|book)?\s*[\divxlc]+\.?$/i`.

  A label that *starts* with an ordinal but carries a title ("Chapter 1 Why I
  Wrote This Book") is fine;
- **coverage**: the distinct spine items it reaches.

Priority stays nav, then NCX, then synthetic. A lower-priority source wins
only if it is strictly better on resolve rate, or the higher one fails the
label-quality floor. Labels can also be **merged**: if the NCX's hrefs are
fine but its labels are junk, and the nav's labels are good but its hrefs are
broken, the resolver keeps the nav's labels with the resolved hrefs. That is
exactly the trigger book. The same per-entry merge applies to bare-ordinal
labels: one is replaced only when another source has a better label **for the
same spine target**. The fallback order for that better label is:

1. the other TOC file;
2. the chapter heading the offscreen extractor already derives
   (`deriveChapterTitle`).

With no better candidate, "Chapter 7" stays as it is. Labels are never
blanked, and an href is never dropped because of its label. The merge is
silent (decision §9.2): no "TOC repaired" note in the UI, only an `Ingestion`
log line recording which source supplied the hrefs and which the labels.

### 4.3 Cover resolution (fixes C1–C8)

`findCoverCandidates(ctx)` returns an **ordered** candidate list, each with a
`reason` tag. `chooseCover` validates them in order and takes the first that
passes. The list, in order:

1. **`cover-image`** manifest property (EPUB 3).
2. **`<meta name="cover">`**:
   - match `content` as a manifest id;
   - **then** as an href, then by basename (C4).
3. **`<guide><reference type="cover|title-page">`** (EPUB 2) and nav
   **`landmarks`** `epub:type="cover"` (C3). These point at an XHTML, which
   goes on to step 5.
4. **Cover-ish XHTML** in the spine. Candidates:
   - the first spine item;
   - any spine item with `epub:type="cover"` on body or section;
   - an id or href matching `/cover/i`.

   These go on to step 5 (C1).
5. **Image-in-XHTML extraction**. Parse the document and take the *largest
   declared* or *first* `<img src>` or SVG `<image href|xlink:href>`
   (C2, C5), resolved against **that document's** directory.
6. **Manifest image heuristics**:
   - id or href matching `/cover|^fc$|_fc\b|front/i`;
   - else the largest image in the first N spine documents (C8).

Any candidate that is an XHTML item rather than an image is routed through
step 5 (C5).

**Validation** (`chooseCover`, needs a decoder port), applied to each
candidate in turn:

- The bytes must exist. Zip lookups use the **decoded** path (C6). That fixes
  the remote reader too, which today looks up the raw percent-encoded href.
- The image must decode via `createImageBitmap`. On failure, it tries the next
  candidate (C7).
- It must be at least 150×200 px, with a portrait-ish aspect ratio between 0.4
  and 1.1. This rejects publisher logos, spacers and social-media icons (the
  trigger book ships `facebook.jpg`, `twitter.jpg` and
  `Crossway_Logo_Title_Page.v3.png`).
- Steps 1–2 are **explicit** declarations. For them the size check is only a
  warning, not a rejection, so a publisher's deliberate odd-shaped cover is
  respected.

The chosen cover's `reason` is logged through the `Ingestion` logger. That way
a "why is my cover wrong" report can be answered from the flight recorder.

### 4.4 Wiring

| Site | Change |
|---|---|
| `extract.ts` `extractPreamble` | Build `SpineIndex` from `book.packaging`. TOC: `chooseTocSource` with the nav plus the NCX (load the NCX separately when `ncxPath` exists), then `resolveToc`. Cover: when `coverUrl()` is null, **or** for any candidate failing validation, run `findCoverCandidates`, reading files via `book.archive`. |
| `extract.ts:439`, `reprocess.ts:99` | Unchanged semantics. They now receive resolved hrefs. |
| `useEpubReader.ts:282` | Run `resolveToc` against the **live** spine before `setToc`/`onTocLoaded`. This fixes existing library books on open. |
| `useTocController` / `BookRepository.syntheticToc` | Run the stored TOC through the same `resolveToc` (idempotent) once the engine is ready. If anything changed, write it back via `bookContent.updateToc` (self-healing; no migration). |
| `EpubJsEngine.display` / `loadSectionText` | **Defensive**: if `spine.get(target)` misses for a non-CFI href, retry through `SpineIndex` before rejecting. This is a belt-and-braces guard for any href source we didn't normalize (search results, history, annotations from old builds). |
| `EpubJsEngine.getNavLabel` | `navigation.get(section.href)` is keyed by raw nav hrefs. Use the resolved TOC instead. |
| `useSmartTOC` | Skip `unresolved` items. Report the count that couldn't be read, rather than failing the whole enhancement when only some do. |
| `useReaderController.jumpTo` | On rejection, show a toast ("This chapter link is broken in the book file") instead of only logging. |
| `TOCPanel` | Render `unresolved` entries **greyed out** (decision §9.1) with a tooltip ("This link is broken in the book file"). Keep them visible so the structure isn't lost. A click shows the same toast as `jumpTo` and does not close the sidebar. |
| `remoteEpub.ts` | Replace `findCoverHref` and `resolvePath` with `coverResolver`/`paths`. Gate the XHTML-hop candidates (steps 3–5) behind the ranged-read budget: at most 2 extra small entry reads. |

Dependency direction: `@lib/epub/structure` imports nothing app-side. Callers
in `@domains`, `@hooks` and `@app` import it through the alias, so there are
no new depcruise edges against the baseline. This needs confirming with
`npm run depcruise:check` in PR 1.

### 4.5 Bundle and worker-chunk constraints

The structure module is small and pure, but `extract.ts` and `useEpubReader`
ride eager graphs. Keep it free of `jszip` and `epubjs` imports: callers pass a
`readText(path)` / `readBytes(path)` port. `npm run check:worker-chunk` and the
bundle baseline must stay green; the image-decode validation uses the
platform `createImageBitmap`, not a library.

---

## 5. PR sequence

Each PR is independently shippable and leaves the gate green.

1. **PR 1 — `paths` + `SpineIndex` + `resolveToc`, wired into the reader.**
   `useEpubReader`, the `EpubJsEngine.display`/`loadSectionText` fallback, and
   the `jumpTo` toast. *Outcome:* TOC clicks and Enhance TOC work for the
   trigger book and for every already-imported book, on open.
2. **PR 2 — Source arbitration and label quality.** Adds `chooseTocSource`,
   NCX loading in `extractPreamble`, the stored-TOC self-heal write-back,
   `unresolved` rendering in `TOCPanel`, and the `useSmartTOC` partial
   tolerance. *Outcome:* T5–T9, placeholder labels never win, and the
   stored/synthetic TOC is healed.
3. **PR 3 — `coverResolver` on local import and reprocess.** Covers steps 1–6
   and validation. *Outcome:* the trigger book gets its cover on (re)import.
4. **PR 4 — Remote preview adopts the shared resolver.** Covers the decoded
   zip lookup (C6) and the bounded XHTML hop. *Outcome:* Drive previews match
   local import.
5. **PR 5 — Cover backfill for the existing library.** A
   `MaintenanceService.backfillMissingCoversOnce()`, modelled on
   `repairCorruptCoverBlobsOnce`: a localStorage flag and an idempotent run.
   - It scans manifests with no `coverBlob` whose book file is local.
   - For each, it runs **only** the preamble cover step, not a full reprocess.
   - It writes the cover and palette, the same way reprocess applies the
     palette delta to the inventory.
   - It runs **automatically once** after the update (decision §9.3),
     throttled, after boot, and is cancellable.
   - It also gets a manual "Re-scan covers" button in the Data settings panel,
     for re-runs.

---

## 6. Data and compatibility

- **No schema change.** `NavigationItem.href` keeps its meaning ("spine href +
  optional fragment"); we just start honoring it. The new `unresolved?:
  boolean` is optional. `navigationItemSchema` (`src/data/rows/static.ts:48`)
  is a `z.looseObject`, so old rows and new rows both validate as they are.
  PR 2 still declares the field there as `.optional()`, for documentation.
- **Idempotence is the migration.** Because rung 1 of the ladder is "already
  in the spine", re-resolving an already-healed TOC is a no-op. That is what
  makes the open-time self-heal safe to run every time.
- **Sync.** The TOC and covers live in local `static_*` stores and are not in
  the CRDT. Only `useSyntheticToc`, `coverPalette` and `perceptualPalette`
  sync, and the backfill writes the palette through the existing reprocess
  path. No sync contract changes.
- **Annotations, history and CFIs** are untouched: CFIs are spine-index based,
  and we never reorder the spine.

---

## 7. Testing

**Fixture builder.** Add `src/test/harness/epubFixtures.ts`, an in-memory
JSZip EPUB builder (the pattern already in `remoteEpub.test.ts:74`). It
exposes knobs for each taxonomy row: nav location, href style, encoding, case,
NCX labels, cover style, image sizes. Images are generated in-test, e.g. a
1×1 PNG plus a 600×900 canvas-encoded JPEG. **We do not commit the user's
Crossway file** (copyrighted). A `crossway-shape` fixture reproduces its exact
packaging instead.

**Unit (pure, no epub.js)**, in new co-located suites for the new module:

- `paths.test.ts`: resolution, decode safety, canonical keys, Unicode NFC.
- `tocResolver.test.ts`: one case per T-row; idempotence (`resolve(resolve(x))
  === resolve(x)`); arbitration, including the nav-labels + NCX-hrefs merge;
  the placeholder-label detector.
- `coverResolver.test.ts`: one case per C-row; logo and spacer rejection;
  explicit-declaration size waiver; candidate `reason` ordering.

**Regression blocks in owning suites** (program rule 1 — no one-off files):

- `extract.test.ts` → `describe('regression: nav doc in subfolder + undeclared cover')`
- `remoteEpub.test.ts` → `describe('regression: percent-encoded cover href / cover via XHTML')`
- `EpubJsEngine.test.ts` → `describe('regression: display() with nav-relative href')`
- `TOCPanel.test.tsx` → unresolved entries render greyed out and toast on click
- `MaintenanceService.test.ts` → backfill is idempotent and flag-guarded

**Real-epub.js check.** jsdom hangs opening an archived book (observed
while investigating), so the end-to-end check is Playwright.

- Extend `test_journey_smart_toc.spec.ts`, or add a focused
  `test_journey_malformed_epub.spec.ts`.
- Import the `crossway-shape` fixture, assert that a cover `<img>` renders in
  the library card, and click three TOC entries. After each click, use
  `waitForSectionChange` to assert the section changed.
- Toggle the synthetic TOC and repeat.
- Capture screenshots via `captureScreenshot`.
- Run the journey through `./run_verification.sh`.

**Gate.** The full AGENTS.md list. Coverage must stay at or above the
baseline (the new pure module should *raise* it).

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| The basename or case-fold rung maps an entry to the wrong file (two `index.xhtml` in different folders) | Basename is used only when unique. Case-fold is used only when exactly one spine item matches. Both are lowest-priority rungs. |
| The heuristic cover picks an interior illustration | Size/aspect validation, `cover`-ish documents before arbitrary images, and explicit declarations always first. Picking *something* plausible beats "Aa", and the reason is logged. |
| Extra work on import (NCX load, XHTML parse, image decode) | Runs only when the cheap path fails. Decoding is one `createImageBitmap` per candidate. Measure under `import:preamble` with `measureSince`, and budget < 50 ms at p50 on the existing fixtures. |
| Open-time TOC write-back races with Enhance TOC's `updateToc` | Write back only when the resolved TOC differs *and* no enhancement is in flight. Both go through `bookContent.updateToc`, which is last-write-wins on the same row. |
| Remote preview budget grows | The XHTML hop is capped at 2 extra ranged reads, and only when the OPF-declared candidates miss. |

---

## 9. Review decisions

| # | Question | Decision |
|---|---|---|
| 1 | Unresolved TOC entries: hide or show? | **Show them greyed out**, with a tooltip and a toast on click (§4.4). |
| 2 | Nav-label + NCX-href merge: silent, or a "TOC repaired" note? | **Silent.** Log only (§4.2). |
| 3 | Cover backfill: automatic or manual-only? | **Automatic, once** after the update. A manual "Re-scan covers" button too (§5, PR 5). |
| 4 | Rename the "Synthetic TOC" toggle? | **No.** The UX is unchanged. |
| 5 | Treat bare "Chapter N" labels as low quality? | **Yes.** They are replaced per entry when another source has a better label for the same target (§4.2). |
