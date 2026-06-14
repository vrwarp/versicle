/**
 * The CRDT migration coordinator (plan/overhaul/prep/phase2-fork-surgery.md
 * §5.2, contract-first.md C11 boot contract).
 *
 * Replaces the legacy `runMigrations` runner that lived in
 * src/store/yjs-provider.ts. Each operating rule below reverses a numbered
 * hazard of that runner (§5.1):
 *
 * - **Static imports, single call site** — invoked exactly once per boot from
 *   the bootstrap 'migrations' phase (src/app/boot/crdtMigrations.ts); a
 *   module-level promise guards in-tab re-entry. No dynamic-import
 *   dependency dodges, no per-store `onLoaded` fan-out (the legacy runner
 *   could fire up to 9× per boot). [hazards 1, 7]
 * - **Reads the doc, not store state** — `readDocSchemaVersion` takes
 *   `max(meta.schemaVersion, library.__schemaVersion)`; the max tolerates
 *   partial dual-writes. No casts through store state. [hazard 2]
 * - **One transaction per step, bump atomic with its transform** — the
 *   version bump executes inside the same `doc.transact` as the step's
 *   transform, so observers (other clients, y-idb) never see
 *   transformed-but-unversioned data. Steps run sequentially. [hazards 3, 4]
 * - **DOC transforms, not store setState** — steps mutate Y types directly;
 *   the middleware receives the migration as ordinary inbound traffic
 *   (origin = MIGRATION_ORIGIN ≠ any store api) and patches stores normally.
 *   There is no stale-state race and no microtask ordering to outrun — the
 *   nested-queueMicrotask hack is structurally unnecessary. [hazard 5]
 * - **Loud failure** — any throw aborts the run and surfaces a
 *   {@link MigrationError} carrying the pre-migration checkpoint id to the
 *   boot sequence (App.tsx routes it to CriticalMigrationFailureView with
 *   the existing checkpoint-restore flow). No silent catch anywhere.
 *   [hazard 6]
 * - **Pre-migration checkpoint** — if any step will run on a doc that holds
 *   data, a protected checkpoint (CheckpointService, the P0 pinning hotfix)
 *   is created BEFORE the first transform. Checkpoint failure aborts the
 *   migration: the protection must exist before the destructive op.
 * - **Cross-client safety stays determinism + LWW** (the sound core of the
 *   legacy design): transforms are deterministic and idempotent
 *   (delete-if-present, copy-if-absent, sorted iteration), so concurrent
 *   migrations by two clients merge to the same terminal state — pinned by
 *   the F.3 convergence tests in
 *   src/store/__tests__/crdt-contract/migrations.test.ts.
 */
import * as Y from 'yjs';
import { getYDoc, CURRENT_SCHEMA_VERSION } from '@store/yjs-provider';
import { CheckpointService } from '@domains/sync/checkpoints/CheckpointService';
import { readDocSchemaVersion } from '@domains/sync/core/quarantine';
import { canonicalizeChar, mergeCanonicalTimestamps } from '@domains/chinese/vocabulary/canonicalize';
import { linkReadingListEntries } from './migrations.linkReadingList';
import { AppError } from '~types/errors';
import { createLogger } from '@lib/logger';

const logger = createLogger('CrdtMigrations');

/** Transaction origin for migration writes (≠ any store api → ordinary inbound). */
export const MIGRATION_ORIGIN = Symbol('versicle:migration');

export interface CrdtMigration {
  /** Version this step migrates FROM (runs when the doc version === from). */
  from: number;
  to: number;
  /**
   * Synchronous, deterministic, idempotent transform on Y types.
   * NO store access — the middleware picks the changes up as inbound.
   */
  migrate(doc: Y.Doc): void;
}

/** Loud migration failure; carries the pre-migration checkpoint id when one was taken. */
export class MigrationError extends AppError {
  /** Id of the protected pre-migration checkpoint, for the restore flow. */
  readonly checkpointId?: number;

  constructor(
    message: string,
    options: { checkpointId?: number; cause?: unknown; context?: Record<string, unknown> } = {},
  ) {
    super(message, {
      code: 'SYNC_MIGRATION_FAILED',
      cause: options.cause,
      context: { ...options.context, checkpointId: options.checkpointId },
    });
    this.name = 'MigrationError';
    this.checkpointId = options.checkpointId;
  }
}

// ─── Version read ────────────────────────────────────────────────────────────

// Relocated to the sync domain with P4-4 (quarantine layers reuse the
// coordinator's EXACT read — risk R4); re-exported for existing importers.
export { readDocSchemaVersion };

/**
 * A doc with no content at all (fresh install / post-wipe boot). Version
 * follows data: fresh docs are NOT stamped — the first persisted write
 * carries the store's declared `__schemaVersion` and the chain runs on a
 * later boot, exactly like the legacy runner's lifecycle. Stamping an empty
 * doc would mark cloud data that merges in later as already-migrated.
 * An empty Y update encodes to 2 bytes; tombstones count as content.
 */
const isDocEmpty = (doc: Y.Doc): boolean => Y.encodeStateAsUpdate(doc).byteLength <= 2;

// ─── JSON → Y conversion (v4+ plain-string encoding) ────────────────────────

/**
 * Plain JSON into Y types — the v4+ (`disableYText`) document encoding:
 * records → Y.Map, arrays → Y.Array, scalars stored as-is.
 */
const plainToY = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    const arr = new Y.Array();
    arr.push(value.map(plainToY));
    return arr;
  }
  if (value !== null && typeof value === 'object') {
    const map = new Y.Map();
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      map.set(key, plainToY(child));
    }
    return map;
  }
  return value;
};

// ─── The migration steps ─────────────────────────────────────────────────────

const PREFERENCES_PREFIX = 'preferences/';

/** Top-level share keys of the legacy per-device preference maps, sorted for determinism. */
const legacyPreferenceMapNames = (doc: Y.Doc): string[] =>
  [...doc.share.keys()]
    .filter((key) => key.startsWith(PREFERENCES_PREFIX) && key.length > PREFERENCES_PREFIX.length)
    .sort();

/**
 * v1 → v2: prune reading sessions whose startTime/endTime are not numbers
 * (the legacy-history corruption the original v1→v2 migration existed for).
 * Doc-transform reimplementation of yjs-provider.ts:120-164; the F.3 fixture
 * matrix pins equivalence with the legacy runner's terminal state.
 */
const pruneInvalidReadingSessions = (doc: Y.Doc): void => {
  const progressRoot = doc.getMap('progress').get('progress');
  if (!(progressRoot instanceof Y.Map)) return;

  progressRoot.forEach((devices) => {
    if (!(devices instanceof Y.Map)) return;
    devices.forEach((userProgress) => {
      if (!(userProgress instanceof Y.Map)) return;
      const sessions = userProgress.get('readingSessions');
      if (!(sessions instanceof Y.Array)) return;
      // Reverse iteration: deletions do not shift the unvisited indices.
      for (let i = sessions.length - 1; i >= 0; i--) {
        const session: unknown = sessions.get(i);
        const startTime = session instanceof Y.Map ? session.get('startTime') : undefined;
        const endTime = session instanceof Y.Map ? session.get('endTime') : undefined;
        if (typeof startTime !== 'number' || typeof endTime !== 'number') {
          sessions.delete(i, 1);
        }
      }
    });
  });
};

/** Default font profiles the v4→v5 migration backfills (yjs-provider.ts:177-183, verbatim). */
const DEFAULT_FONT_PROFILES = {
  en: { fontSize: 100, lineHeight: 1.5 },
  zh: { fontSize: 120, lineHeight: 1.8 },
} as const;

/**
 * v4 → v5: initialize `fontProfiles` where absent. The legacy runner
 * backfilled only the CURRENT device's preferences store; the doc transform
 * backfills every per-device map (copy-if-absent, sorted iteration) — a
 * deterministic superset of the legacy behavior that closes the gap where
 * other devices' profiles were left to be hydration-wiped (D2).
 */
const backfillFontProfiles = (doc: Y.Doc): void => {
  for (const name of legacyPreferenceMapNames(doc)) {
    const map = doc.getMap(name);
    if (map.size === 0) continue; // never-materialized husk
    if (!map.has('fontProfiles')) {
      map.set('fontProfiles', plainToY(DEFAULT_FONT_PROFILES));
    }
  }
};

/**
 * v5 → v6 (phase2-fork-surgery.md §5.3, deliberately DOWN-SCOPED):
 *
 * 1. Delete the residual `annotations.popover` Y.Map key (transient UI state
 *    that leaked into the CRDT; store-side hotfixed in P0 — see
 *    useAnnotationStore.ts. Idempotent: deleting an absent key is a no-op).
 * 2. Preferences fold: copy each legacy top-level `preferences/<deviceId>`
 *    map into `preferences.<deviceId>` (nested map), copy-if-absent for LWW
 *    safety under concurrent migration, sorted by deviceId for determinism.
 *    **COPY-WITHOUT-CLEAR**: the legacy maps are intentionally left in place
 *    — clearing them would let the D5 window (per-map quarantine is async
 *    and only library-guarded) wipe a still-v5 device's live preferences
 *    before its UI locks. The husks stop mattering once stores rebind to the
 *    folded map (flip item) and are cleared in v9 (P9) with the dual-write
 *    retirement (program renumbering: v7 = vocabulary canonicalization,
 *    v8 = reading-list bookId FK).
 *
 * The `meta` map creation + schemaVersion dual-write is NOT here — it is the
 * coordinator's generic atomic bump (every step dual-writes meta + library
 * inside its transaction). Per program rule 5 (N+1 staging) nothing reads
 * `meta` for enforcement in the v6 release: v5 clients keep quarantining via
 * the dual-written `library.__schemaVersion`; Phase 4's synchronous pre-merge
 * check is the first reader.
 */
const migrateV5toV6 = (doc: Y.Doc): void => {
  doc.getMap('annotations').delete('popover');

  const folded = doc.getMap('preferences');
  for (const name of legacyPreferenceMapNames(doc)) {
    const deviceId = name.slice(PREFERENCES_PREFIX.length);
    const legacy = doc.getMap(name);
    if (legacy.size === 0) continue; // never-materialized husk
    if (!folded.has(deviceId)) {
      // toJSON() normalizes any pre-v4 Y.Text values to plain strings — the
      // folded copy is always v4+ plain encoding, identically on every client.
      folded.set(deviceId, plainToY(legacy.toJSON()));
    }
  }
};

/**
 * v6 → v7 (Phase 6 §7.5, prep/phase6-reader-engine.md PR-13, CH-6 —
 * program decision: the vocabulary canonicalization IS the v7 bump, so the
 * standing quarantine machinery keeps any not-yet-upgraded client from
 * writing fresh traditional keys into a canonicalized doc):
 *
 * Every `vocabulary.knownCharacters` key is rewritten to its SIMPLIFIED
 * form via the COMMITTED single-char trad→simp table (the inverse of the
 * exact OpenCC cn→tw mapping the reader displays with). Duplicate pairs
 * (both 紅 and 红 present) merge with min-timestamp semantics — earliest
 * knowledge wins. Deterministic (sorted iteration, code-versioned table)
 * and idempotent (canonical keys map to themselves), so concurrent
 * migrations by two clients converge per the coordinator's LWW core.
 *
 * Deliberately NOT here: husk-clearing + dual-write retirement (earmarked
 * v9/P9 per the program numbering decision; v8 = reading-list bookId FK).
 */
const canonicalizeVocabularyKeys = (doc: Y.Doc): void => {
  const knownCharacters = doc.getMap('vocabulary').get('knownCharacters');
  if (!(knownCharacters instanceof Y.Map)) return;

  for (const key of [...knownCharacters.keys()].sort()) {
    const canonical = canonicalizeChar(key);
    if (canonical === key) continue;
    const merged = mergeCanonicalTimestamps(
      knownCharacters.get(canonical),
      knownCharacters.get(key),
    );
    if (merged !== undefined && knownCharacters.get(canonical) !== merged) {
      knownCharacters.set(canonical, merged);
    }
    knownCharacters.delete(key);
  }
};

/**
 * v8 → v9 (Phase 9 — the LAST format change of the overhaul program;
 * phase2-fork-surgery.md §9 items 1–2, phase8-shell-pwa.md §RC-10):
 *
 * 1. **Preferences husk-clearing.** v6 folded the legacy top-level
 *    `preferences/<deviceId>` maps into the keyed `preferences` map
 *    COPY-WITHOUT-CLEAR: clearing then would have let the D5 window (per-map
 *    quarantine is async and only library-guarded) wipe a still-v5 device's
 *    LIVE preferences before its UI locked. v9 empties the husk maps'
 *    content (top-level shared types can never be removed from a Y.Doc).
 *    Safe NOW because the only clients that ever WRITE those maps are
 *    v5-era stacks, and every such client has been hard-quarantined since
 *    the v6 bump (and re-trips on v7/v8): its library-map poison pill fires
 *    synchronously BEFORE any store patch, so no live preferences can be
 *    lost to this clear — the husks are pure residue.
 *
 * 2. **`library.__schemaVersion` dual-write retirement — meta becomes the
 *    sole version authority.** The N+1 staging audit (program rule 5):
 *    the `meta` map's WRITE shipped at v6 (P2, three format generations
 *    ago); its first enforcement READERS shipped with the P4 doc-level
 *    quarantine layers (pre-attach metadata probe, pre-apply scratch
 *    check, live `meta` observer) — between the v6 and v7 releases. The
 *    fleet-quarantine chain that makes meta-only safe at v9:
 *      - clients ≤ v7-era: already locked by the v8 bump's dual write
 *        (their per-map pill saw library.__schemaVersion = 8), and the
 *        FROZEN library stamp keeps tripping them on every future boot;
 *      - v8-era clients (the only ones still live on a v8 doc): every
 *        v8-era build is ≥ P7 and therefore carries the P4 meta layers,
 *        so `meta.schemaVersion = 9` alone quarantines them.
 *    The stale `library.__schemaVersion = 8` key is deliberately KEPT, not
 *    deleted: it is the ONLY quarantine layer pre-P4-era builds possess
 *    (an offline v6-era straggler that missed v7/v8 still trips on 8 > 6),
 *    and deleting it would invite middleware resurrection writes (the
 *    store's declared `__schemaVersion` default diffed against an absent
 *    key). It is frozen at 8 forever; `readDocSchemaVersion`'s
 *    `max(meta, library)` reads through it.
 *
 * 3. **`activeContext` husk pruning.** P8 §J moved the library/notes
 *    switch to ROUTE state and dropped `activeContext` from the
 *    preferences syncedKeys (read-time-only change, no format bump — the
 *    P8 slot was released). The key lingers in every folded per-device
 *    map (and the legacy husks, which item 1 clears wholesale); v9 deletes
 *    it. A not-yet-quarantined v8-era client built before P8 can race a
 *    re-add into its local doc — inert (v9+ stacks never hydrate the key)
 *    and stopped fleet-wide by the bump itself.
 *
 * Transform discipline (the F.3 pattern): deterministic (sorted
 * iteration), idempotent (clearing empty maps / deleting absent keys are
 * no-ops), so concurrent migrations by two clients converge per the
 * coordinator's LWW core.
 */
const clearHusksAndRetireDualWrite = (doc: Y.Doc): void => {
  // 1. Empty every legacy per-device preference husk (content only; the
  //    top-level share itself is permanent Y.Doc structure).
  for (const name of legacyPreferenceMapNames(doc)) {
    const husk = doc.getMap(name);
    for (const key of [...husk.keys()].sort()) {
      husk.delete(key);
    }
  }

  // 3. Prune the de-synced activeContext key from the folded device maps.
  const folded = doc.getMap('preferences');
  for (const deviceId of [...folded.keys()].sort()) {
    const deviceMap = folded.get(deviceId);
    if (deviceMap instanceof Y.Map) {
      deviceMap.delete('activeContext');
    }
  }

  // 2 (the dual-write retirement) lives in the runner: steps with
  // `to` > LAST_DUAL_WRITTEN_SCHEMA_VERSION bump `meta` alone.
};

/**
 * The last version whose bump dual-writes `library.__schemaVersion`
 * (item 2 above). Steps up to and including v8 keep the dual write so a
 * chain replayed from an old era terminates in the same doc state the
 * fleet's staggered releases produced (library frozen at 8); v9 and every
 * future bump write `meta.schemaVersion` only.
 */
const LAST_DUAL_WRITTEN_SCHEMA_VERSION = 8;

/**
 * The ordered migration registry. `from: 3` exists because v3 was a pure
 * version bump (Firestore path change, no doc-shape change) — the legacy
 * runner folded v2/v3 into one branch.
 *
 * v7 → v8 (Phase 7 §D, the rule-4 post-merge step): the one-time
 * reading-list `bookId` FK linker — see migrations.linkReadingList.ts for
 * the join semantics and why the FK needs a quarantining bump (pre-v8
 * clients drop unknown fields on whole-entry rebuilds).
 *
 * v8 → v9 (Phase 9): the program's terminal cleanup bump — husk clearing,
 * dual-write retirement, activeContext pruning (docblock above).
 */
export const CRDT_MIGRATIONS: readonly CrdtMigration[] = [
  { from: 1, to: 2, migrate: pruneInvalidReadingSessions },
  { from: 2, to: 4, migrate: () => undefined }, // pure bump (v4 = the disableYText flip)
  { from: 3, to: 4, migrate: () => undefined }, // pure bump (v3 was itself a pure bump)
  { from: 4, to: 5, migrate: backfillFontProfiles },
  { from: 5, to: 6, migrate: migrateV5toV6 },
  { from: 6, to: 7, migrate: canonicalizeVocabularyKeys },
  { from: 7, to: 8, migrate: linkReadingListEntries },
  { from: 8, to: 9, migrate: clearHusksAndRetireDualWrite },
];

// ─── The runner ──────────────────────────────────────────────────────────────

export interface CrdtMigrationRunResult {
  status: 'noop' | 'migrated';
  from: number;
  to: number;
  /** Set when a pre-migration checkpoint was taken (status 'migrated' on a doc with data). */
  checkpointId?: number;
}

export interface RunCrdtMigrationsOptions {
  /** Test seam: step registry override. Defaults to {@link CRDT_MIGRATIONS}. */
  steps?: readonly CrdtMigration[];
  /** Test seam: target version override. Defaults to CURRENT_SCHEMA_VERSION. */
  targetVersion?: number;
  /**
   * Pre-migration checkpoint factory; returns the checkpoint id. Defaults to
   * `CheckpointService.createCheckpoint(trigger, { protected: true })` — the
   * P0 pinning hotfix keeps it from being pruned while it matters.
   */
  createCheckpoint?: (trigger: string) => Promise<number>;
}

/**
 * The coordinator engine: migrate one doc to the target version. Exported
 * for tests (fixture matrices inject docs and a stub checkpoint factory);
 * production code calls {@link runCrdtMigrations}.
 */
export async function runCrdtMigrationsOnDoc(
  doc: Y.Doc,
  options: RunCrdtMigrationsOptions = {},
): Promise<CrdtMigrationRunResult> {
  const steps = options.steps ?? CRDT_MIGRATIONS;
  const target = options.targetVersion ?? CURRENT_SCHEMA_VERSION;
  const from = readDocSchemaVersion(doc);

  if (from >= target) {
    // Up to date — or from the future, in which case the middleware's
    // poison pill owns quarantine; the coordinator must not touch the doc.
    return { status: 'noop', from, to: from };
  }

  if (isDocEmpty(doc)) {
    return { status: 'noop', from, to: from };
  }

  logger.info(`Migrating CRDT doc v${from} → v${target}`);

  // Checkpoint BEFORE the first transform; failure to protect aborts the run.
  let checkpointId: number;
  const createCheckpoint =
    options.createCheckpoint ??
    ((trigger: string) => CheckpointService.createCheckpoint(trigger, { protected: true }));
  try {
    checkpointId = await createCheckpoint(`pre-crdt-migration-v${target}`);
  } catch (cause) {
    throw new MigrationError(
      `Pre-migration checkpoint failed; migration v${from} → v${target} aborted before any change.`,
      { cause, context: { from, target } },
    );
  }

  let version = from;
  try {
    while (version < target) {
      const current = version;
      const step = steps.find((candidate) => candidate.from === current);
      if (step === undefined) {
        throw new Error(`No migration step from v${current} (target v${target}).`);
      }
      // Transform + version bump in ONE transaction: atomic for every
      // observer (stores, y-idb, remote peers). `meta` is the version
      // authority. Steps ≤ v8 ALSO write library.__schemaVersion — the
      // pre-meta-era per-map poison pill surface — so a chain replayed
      // from an old era terminates with library frozen at 8, exactly the
      // state the fleet's staggered releases produced; v9+ bumps retired
      // the dual write (see clearHusksAndRetireDualWrite, item 2).
      doc.transact(() => {
        step.migrate(doc);
        doc.getMap('meta').set('schemaVersion', step.to);
        if (step.to <= LAST_DUAL_WRITTEN_SCHEMA_VERSION) {
          doc.getMap('library').set('__schemaVersion', step.to);
        }
      }, MIGRATION_ORIGIN);
      logger.info(`Migration v${current} → v${step.to} complete.`);
      version = step.to;
    }
  } catch (cause) {
    throw new MigrationError(
      `CRDT migration failed at v${version} (target v${target}). ` +
        `Your data was checkpointed before migration (checkpoint #${checkpointId}).`,
      { checkpointId, cause, context: { from, target, failedAt: version } },
    );
  }

  return { status: 'migrated', from, to: version, checkpointId };
}

// In-tab re-entry guard: the coordinator runs once per boot; repeated calls
// (or a re-rendered boot owner) share the same promise. A failed run stays
// failed — recovery is the checkpoint-restore flow, which reloads the page.
let inFlight: Promise<CrdtMigrationRunResult> | null = null;

/**
 * Run the CRDT migration chain on the app's singleton Y.Doc. Called exactly
 * once from the bootstrap 'migrations' phase, AFTER the whenHydrated phase
 * (the doc is loaded from IndexedDB and the stores have hydrated).
 */
export function runCrdtMigrations(): Promise<CrdtMigrationRunResult> {
  inFlight ??= runCrdtMigrationsOnDoc(getYDoc());
  return inFlight;
}

/** Test seam: clear the re-entry guard between suites. */
export function __resetCrdtMigrationsForTests(): void {
  inFlight = null;
}
