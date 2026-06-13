# ADR 0002: Android native backup integration — delete, do not wire

- **Status:** Accepted (2026-06-12, Phase 9 of the overhaul)
- **Deciders:** Versicle overhaul program (master plan
  `plan/overhaul/README.md`; the decision was provisioned by the Phase 1
  deletion audit `plan/overhaul/prep/phase1-deletions.md` §1.14, deferred by
  Phase 3 `prep/phase3-storage-gateway.md` ▲17/§Follow-ups item 3, and
  deferred again by Phase 4 `prep/phase4-sync-strangler.md` §Follow-ups
  item 4 — Phase 9 is the named backstop)
- **Artifacts decided over:** `src/lib/sync/android-backup.ts` (65 LOC),
  `src/lib/sync/android-backup.test.ts`

## Context

`AndroidBackupService` was written as a bridge between the app's backup
manifest and **Android Auto Backup**: `writeBackupPayload()` serializes
`backupService.generateManifest()` (manifest v3 since P0) into
`backup_payload.json` under the Capacitor `Directory.Data` root, where the
OS's Auto Backup (enabled by the manifest's default
`android:allowBackup="true"`) would pick it up; `readBackupPayload()` reads
it back, validating through the `src/data/rows` backup envelope schema
(hardened in P3).

The integration was never finished, on either side:

- **Zero JS callers.** `writeBackupPayload` and `readBackupPayload` are
  called by nothing but the module's own test — verified at the Phase 1
  audit (§1.14), re-verified at Phase 3 (▲17), and re-verified now
  (`grep -rn "AndroidBackup|android-backup" src/ android/` → only the pair
  and two doc-comment mentions). No boot task ever schedules the write; no
  restore path ever reads the payload.
- **Zero native wiring.** `android/` contains no `BackupAgent`, no
  `dataExtractionRules`/`fullBackupContent` rules XML, no WorkManager job —
  only the default `allowBackup="true"` attribute. Even if a payload file
  existed, no code on the restore side would ever look at it: a restored
  device would have the JSON sitting inert in the data directory.

## Decision

**Delete the cluster** (`android-backup.ts` + its test). Do not wire it.

Reasons, beyond "it has been dead through four phases":

1. **The product already has three real backup/restore stories**, all
   landed and tested by the overhaul: explicit file export/import
   (BackupService, validate-before-destroy + pre-restore checkpoint, P0),
   Google Drive library sync (P7 `domains/google`), and Firestore workspace
   sync (P4 `domains/sync`, with checkpoints and the staged swap). A fourth,
   OS-mediated channel adds recovery-surface complexity without adding a
   capability users lack.
2. **Auto Backup is a poor transport for this payload.** The quota is
   25 MB per app; a manifest that embeds library state can exceed it
   silently (Auto Backup just stops backing up the app when over quota,
   taking the WebView's own data with it). Doing this properly means a
   key/value `BackupAgent` or a size-capped payload plus native restore
   hooks — real native work that nothing on the roadmap asks for.
3. **A passive format adapter rots.** The module must track every backup
   manifest format change forever (it already needed the v2→v3 retouch in
   P0 and the zod-envelope retouch in P3) while delivering nothing.
4. **Resurrection is cheap.** The module is 65 lines over stable
   primitives (`backupService.generateManifest()`, `@capacitor/filesystem`,
   `backupManifestEnvelopeSchema`); this ADR plus git history is the spec.

## Consequences

- `src/lib/sync/android-backup.ts` and `android-backup.test.ts` are deleted
  in the same commit as this ADR. (Test-absorption ledger note: the test
  pinned only the deleted module's own behavior — nothing to absorb.)
- `android:allowBackup="true"` stays as-is: it predates and is independent
  of this module (it governs the OS backing up app data generally). Whether
  to flip it to `false` (or add `dataExtractionRules`) is a privacy/QA
  question for a future on-device pass, explicitly out of scope here.
- Doc-comment references to android-backup in `src/data/rows/backup.ts` and
  `src/data/snapshot/YjsSnapshotService.ts` are updated in the same commit.
- If a native backup integration is ever actually wanted, the path is:
  re-create the writer over `generateManifest()`, add a boot task that
  schedules it (debounced, post-hydration), add the native restore probe at
  boot (validate → hand to BackupService's validate-before-destroy restore),
  cap the payload, and add `fullBackupContent` rules — wired end-to-end or
  not at all.
