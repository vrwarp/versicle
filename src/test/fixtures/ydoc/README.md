# Captured Y.Doc fixtures (schema eras v1 / v2 / v4 / v5 / v6 / v7)

Committed binary Y.Doc snapshots of the **historical CRDT formats** Versicle
clients have written, one per schema era that matters
(plan/overhaul/prep/phase2-fork-surgery.md §4; program rule: captured-artifact
fixtures for every user-data format change). They are the acceptance inputs
for the Phase 2 fork-surgery and migration work: hydration matrices (suite
F.1), the migration matrix (F.3), and the two-client quarantine tests (F.2)
all run against these bytes.

| File | Era | Doc-format meaning |
|---|---|---|
| `v1.update.bin` | v1 | Strings stored as **Y.Text** (pre-`disableYText`); contains one INVALID reading session (`startTime: 'corrupt'`) — the input the v1→v2 prune exists for |
| `v2.update.bin` | v2 | Y.Text encoding, sessions pruned (v3 is shape-identical to v2-after-bump and needs no separate fixture) |
| `v4.update.bin` | v4 | Plain-string encoding (the `disableYText` flip, commit `fb96dd97`); preferences **without** `fontProfiles`; annotations carry the stale top-level `popover` key (pre-hotfix shape) |
| `v5.update.bin` | v5 | v4 + `fontProfiles` (the v4→v5 backfill applied); still carries `popover` |
| `v6.update.bin` | v6 | Terminal v6 shape: `meta` map present, preferences folded WITH the legacy per-device husks (copy-without-clear), `popover` deleted; vocabulary carries TRADITIONAL keys incl. the 紅/红 duplicate pair — the v7 canonicalization input |
| `v7.update.bin` | v7 | Terminal v7 shape: v6 with the vocabulary CANONICALIZED (simplified keys, duplicate pair min-merged); reading-list entries carry NO `bookId` — the v8 linker input |

Every era shares one reading-list entry set (exact-filename match, fuzzy
title+author match, orphan), none carrying `bookId`: the FK is born at the
v8 linker step, so all eras link identically and terminate canonically
equal.

Format: raw Y update encoding (`Y.encodeStateAsUpdate`), stable and
versionless — load with:

```ts
const doc = new Y.Doc();
Y.applyUpdate(doc, new Uint8Array(readFileSync('v5.update.bin')));
```

## Provenance

- **Seed dataset:** `seed.ts` (one shared constant; 2 books incl. a CJK
  title, 2 devices, the era-specific deltas listed above). Deliberately not
  typed against current app interfaces — these are historical shapes.
- **Generator:** `scripts/capture-ydoc-fixture.ts`
  (`node scripts/capture-ydoc-fixture.ts [--era v4]`). Deterministic: fixed
  doc GUID + clientID per era, single transaction — re-running produces
  byte-identical files.
- **Method per era** (recorded in `manifest.json`):
  - v4/v5 — `writer-current-mapping`: plain-JSON-into-Y-types via the
    vendored middleware's own `objectToYMap` with `{ disableYText: true }`.
    Full fidelity: v4+ encoding IS plain JSON into Y types.
  - v1/v2 — `writer-ytext-fallback`: same mapping with default options
    (strings → `Y.Text`), built with the **current** yjs library. This is
    the design doc's documented fallback (§4.2): the Y.Text items are real
    (which is what the repair path branches on), but the struct layout is
    current-yjs, not era-yjs. Higher-fidelity alternatives, in preference
    order, if ever needed:
    1. `git worktree add /tmp/versicle-era <sha>` at the historical commit
       (v2-era = parent of `297a450f`; v1-era = the middleware-adoption
       commit, `7569f70a` vicinity), `npm ci` there, run a small capture
       entry through THAT era's stores + middleware, and
       `Y.encodeStateAsUpdate` the result.
    2. A real old install's doc: a `BackupService` export or raw
       `versicle-yjs` IDB dump from a long-lived device, anonymized
       (titles/CFIs → placeholders) before committing.
    Replacing a fixture this way = update `manifest.json` (method, sha256,
    provenance note) in the same commit and re-run the consuming suites.

## Drift protection

`manifest.json` records era, method, sha256, generator SHA, capture time,
and a content checklist per fixture.
`src/store/__tests__/crdt-contract/fixtures-manifest.test.ts` recomputes the
hashes and structurally validates each doc in CI — the committed bytes
cannot drift from the manifest silently. Fixtures are **never regenerated in
CI**; regeneration is a reviewed, deliberate act.

## Regenerating

```sh
node scripts/capture-ydoc-fixture.ts          # all eras
node scripts/capture-ydoc-fixture.ts --era v4 # one era
```

Then review the diff (manifest sha256 changes are the signal), and update
any suite expectations that pinned old content. Changing `seed.ts` changes
EVERY era's bytes — treat seed edits as fixture regenerations.
