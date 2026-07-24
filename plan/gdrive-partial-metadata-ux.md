# Partial-Fetch Metadata: UX Concepts (post-critique)

Companion to `gdrive-partial-metadata.md` (feasibility + quota study). Ten
initial concepts went through two rounds of UXR critique (a user-value lens
and a trust/privacy/failure-mode lens, then a validation pass on the refined
set). This document is the surviving, refined set.

**Organizing insight from the critique:** partial fetch is a *trust
primitive* — "prove this Drive file is that book, before committing bytes,
disk, or attention." The surviving ideas point that primitive at moments users
actually face; the killed ones used it to decorate surfaces that garbage EPUB
metadata would quietly poison.

## Prerequisites (block everything below)

- **P1** Persist `md5Checksum` into `DriveFileIndex` (fetched today, dropped
  by `mapToDriveFileIndex`).
- **P2** `bg` rate-limit lane for the `drive` destination + 403/429
  exponential backoff in `DriveClient` (see quota study).
- **P3** Device-local IndexedDB cache for extracted metadata + covers, keyed
  `{fileId, md5Checksum}`. Never synced (no shadow-library data model in the
  CRDT).

## Refined concepts, in ship order

### R1. Verified cloud restore (S) — ship first
In `ContentMissingDialog`, before the full download, partial-fetch the
candidate's OPF title/author + cover and confirm: "Restore from this file?"
with the cover shown. Converts today's `findFile(title, filename)` heuristic
gamble into user-confirmed identity at the exact moment of engagement; kills
the documented wrong-restore → duplicate-import bug class. Garbage OPF →
fall back to filename/size/modified confirmation. Gesture-driven,
interactive token, ~4 requests.

### R2. Durable ghost↔Drive binding + md5 backfill (S/M)
When a match is verified (R1 confirm, or any import from Drive), persist
`bookId ↔ {fileId, md5Checksum}` and sync this tiny ID mapping through the
CRDT (user's own metadata into the user's own Firebase; bytes, not blobs).
`findFile()` heuristics become last resort; restore becomes one-tap.

Validation-round requirements:
- **Staleness policy:** Drive overwrite-in-place keeps `fileId` but changes
  `md5`. On mismatch, demote the binding to "candidate — re-verify via R1";
  never silently download by fileId (the new binary may be a different
  edition and would misanchor synced annotations/CFIs). Divergent bindings
  from two devices resolve LWW.
- **Cross-account degrade:** a device linked to a different (or no) Google
  account receives bindings it cannot resolve — render "unavailable on this
  device's Drive", never error toasts.
- **md5 backfill job:** on a device that holds the binaries, hash local
  EPUBs and match against the index's `md5Checksum` to mint exact bindings
  for the legacy library — zero network, zero heuristics. Without this, R5
  ships hollow (legacy libraries have ~0% binding coverage).
- Note: md5s in Firestore identify exact editions to anyone with read access
  to the user's own project — document in the privacy notes; acceptable in
  the BYO single-user trust domain.

### R3. Pre-import preview sheet (S)
Tap a Drive file → sheet with cover, title, author, description, detected
language, size. The canonical preview primitive (R4 is its list form).
- Language is an *editable pre-fill* for import defaults; suggestions like
  "Looks like Chinese — enable pinyin?" appear at first open. Never silently
  armed (wrong `dc:language` tags are endemic).
- Confirm-time dedup check: exact identifier or title+author match against
  the library → "This looks like *X*, already in your library — import
  anyway?" Informational, never a blocker; no passive badges (garbage
  `dc:identifier`s make passive badges false-confidence machines).

### R4. Rich Drive browser rows (M)
`DriveImportDialog` rows hydrate cover/title/author lazily as they enter the
viewport, cache-first via P3; fallback is exactly today's filename+size row.
Reopening the dialog costs zero network. **Cancel in-flight fetches on
scroll-out** — a fast fling must not spend the bg-lane budget on rows no
longer visible.

### R5. Fresh-device cover hydration (M)
On a new device the synced library is a wall of grey ghost tiles — the app
looks broken at the exact moment trust is established. Hydrate covers ONLY
for books with an exact R2 binding (wrong cover on a synced book is a
trust-destroying lie; filename/title matching stays banned here). Visible and
cancellable ("Fetching covers… 40/300 ✕"), viewport-prioritized, bg lane;
token unavailable → one reconnect affordance, never a popup. Ghost tiles keep
an unmistakable download affordance — a cover must not read as "ready to
read". Depends on R2's backfill for legacy coverage.

### R6. "New on Drive" awareness (S) — can ship anytime once fixed
The `checkForNewFiles` filename diff surfaces as a badge/count on the Drive
import entry point (NOT a shelf on the library's daily surface), with a
"last scanned N days ago" staleness stamp. **Must read the persisted index
only** — `checkForNewFiles` auto-triggers `scanAndIndex` when the index is
empty, so calling it at boot would silently scan Drive at launch, exactly the
ethos violation this reshape exists to avoid. Covers for those rows hydrate
only inside the opened dialog (R4). Zero new egress.

### R7. Passive trickle hydration (M)
Passively build the rich index: an idle background consumer of the same
hydration queue works through unhydrated `{fileId, md5}` entries while the
app is open, eventually making the entire Drive index rich — enabling
library-wide search over not-yet-imported Drive books, full dedup coverage,
zero-network dialog opens, and full cover coverage. Quota impact is
negligible (~1.5% of the per-user ceiling at 6 books/min; a 500-book library
completes in ~83 cumulative foreground minutes).

Adopted with changes from the skeptic pass (the naive "one fetch every 10 s,
default-on" form was rejected):

- **One queue, lowest priority.** Not a separate mechanism: interactive tap >
  viewport row > trickle, all writing the P3 cache, all on the bg lane.
  Trickle consumes the *persisted* index only — it must never trigger a scan
  (same trap as R6).
- **Batched, not ticked.** A request every 10 s pins the cellular radio at
  the dormancy-tail boundary indefinitely. Batch ~30 books every ~5 min —
  same average rate, ~90% radio-idle. Foreground-only (Capacitor webviews
  have no reliable background execution; don't pretend otherwise).
- **Metering guard.** Unmetered-connections-only by default (Capacitor
  Network plugin); on web, where metering is undetectable, unknown ≠
  unmetered — apply a hard per-session byte cap (~20 MB) instead.
- **Consent bar for default-on:** disclosure with a size estimate at
  folder-link time + a settings toggle + a visible activity indicator while
  trickling + the metering guard. Anything less → ship it opt-in. The
  auto-scan precedent does NOT cover this: auto-scan is one metadata
  listing; trickle is continuous ranged downloads of book bytes.
- **Negative caching (biggest miss in the naive spec).** Persist "no
  metadata extractable @ {fileId, md5}" for corrupt/non-standard EPUBs or
  trickle retries the same broken files forever. A 404 mid-trickle (file
  deleted/moved since last scan) evicts the entry from the index — no
  backoff-retry.
- **Cache lifecycle:** LRU eviction; drop entries whose fileId left the
  index; sweep orphans left by md5 churn (500 covers ≈ 50 MB IndexedDB).
- **N devices each trickle independently** (P3 cache is deliberately
  device-local). Accept the still-tiny quota cost; do not reverse P3 and
  sync covers to fix it.
- **Does not replace R5.** Fresh-device users want covers in minutes, not
  after 83 foreground-minutes; R5's visible, cancellable job stays. Trickle
  is the slow complement that eventually covers everything else. Requires
  only P1–P3, not R2.

## Deferred

### D1. Drive-as-shelf browse mode (v2, opt-in)
Reshaped from "metadata-only instant import" (add books as ghost-with-cover,
download on first open). Critics split: strategic differentiator (300-book
folder → browsable library in a minute) vs. cost bomb that breaks "your books
live on your device" (offline tap → error; every downstream system must
handle binary-absent books). Deferred reshape keeps it OUT of the library
model: an explicitly separate "Your Drive" shelf — covers from the R4 cache,
open = import-then-open with progress, visual "not your library" separation
non-negotiable. Revisit after R1–R6 prove the cache and the demand.

## Killed, and why

- **Reading-list ↔ Drive matching** — fuzzy title matching across two
  garbage-prone corpora (translated editions, simplified/traditional
  variants); false "you already own this" is worse than nothing.
- **Cover-wall onboarding animation** — delight-driven eager sweep at the
  single worst quota moment (folder link + scan simultaneously).
- **Silent language-based auto-config** — endemic wrong tags; a mis-armed
  pinyin overlay is a config bug the user must discover and undo.
- **Passive dedup badges** — requires whole-folder sweeps and asserts facts
  from unreliable identifiers; survives only as R3's confirm-time check.
- **Library-top "new on Drive" shelf** — Drive-promotional UI on the
  returning reader's daily surface, pressuring boot-time hydration; survives
  as R6's badge.
