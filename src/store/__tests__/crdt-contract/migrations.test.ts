import { describe, it, expect, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import yjsMiddleware from 'zustand-middleware-yjs';
import {
  CRDT_MIGRATIONS,
  MIGRATION_ORIGIN,
  MigrationError,
  readDocSchemaVersion,
  runCrdtMigrations,
  runCrdtMigrationsOnDoc,
  __resetCrdtMigrationsForTests,
} from '@app/migrations';
import { CURRENT_SCHEMA_VERSION } from '@store/yjs-provider';
import { DEVICE_A, DEVICE_B, BOOK_EN, BOOK_CJK } from '@test/fixtures/ydoc/seed';

/**
 * Migration coordinator suite (phase2-fork-surgery.md §5, contract cases
 * F.2/F.3 plus the coordinator invariants):
 *
 *  - F.3 fixture matrix: v1/v2/v4/v5 → v6 terminate in canonically-equal
 *    doc JSON; re-running is a no-op; two clients migrating concurrently
 *    converge (determinism + LWW).
 *  - F.2 two-client quarantine: a v5-configured stack receiving a migrated
 *    v6 doc fires onObsolete(6) BEFORE any store patch, halts outbound, and
 *    the known D5 residual (Y-level merge already happened on unguarded
 *    maps) is pinned until Phase 4's synchronous pre-merge `meta` check.
 *  - Coordinator invariants (absorbing the durable assertions of the
 *    deleted yjs-provider.migration-race.test.ts spy test): no double-apply,
 *    failure → MigrationError with the pre-migration checkpoint id, atomic
 *    transactional bump, idempotent re-run after success.
 */

// vitest's jsdom environment rewrites import.meta.url to a non-file URL;
// resolve from the repo root instead (vitest always runs from it).
const fixtureDir = join(process.cwd(), 'src', 'test', 'fixtures', 'ydoc');

const loadDoc = (era: 1 | 2 | 4 | 5): Y.Doc => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(readFileSync(join(fixtureDir, `v${era}.update.bin`))));
  return doc;
};

const drain = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Stub checkpoint factory; optionally records the doc bytes at call time. */
const stubCheckpoint =
  (id: number, capture?: (snapshot: Uint8Array) => void) =>
  (doc: Y.Doc) =>
  (): Promise<number> => {
    capture?.(Y.encodeStateAsUpdate(doc));
    return Promise.resolve(id);
  };

/**
 * Canonical full-doc JSON: every top-level shared map, sorted by name.
 * Empty maps are skipped — instantiating a root type (e.g. the version
 * read touching `meta`) is not a data change.
 */
const docJson = (doc: Y.Doc): Record<string, unknown> => {
  const json: Record<string, unknown> = {};
  for (const key of [...doc.share.keys()].sort()) {
    const map = doc.getMap(key);
    if (map.size > 0) json[key] = map.toJSON();
  }
  return json;
};

const migrate = (doc: Y.Doc, checkpointId = 1) =>
  runCrdtMigrationsOnDoc(doc, { createCheckpoint: stubCheckpoint(checkpointId)(doc) });

afterEach(() => {
  __resetCrdtMigrationsForTests();
});

// ─── F.3: fixture migration matrix ───────────────────────────────────────────

describe('F.3 migration matrix — committed era fixtures → v6', () => {
  const eras = [1, 2, 4, 5] as const;

  it.each(eras)('v%i → v6: post-migration invariants hold', async (era) => {
    const doc = loadDoc(era);
    const result = await migrate(doc, 7);

    expect(result).toEqual({ status: 'migrated', from: era, to: 6, checkpointId: 7 });

    // Atomic dual version bump (meta is the N+1-staged surface).
    expect(doc.getMap('meta').get('schemaVersion')).toBe(6);
    expect(doc.getMap('library').get('__schemaVersion')).toBe(6);
    expect(readDocSchemaVersion(doc)).toBe(6);

    // v6 scope 1: the residual popover key is gone; annotations intact.
    expect(doc.getMap('annotations').has('popover')).toBe(false);
    const annotations = doc.getMap('annotations').get('annotations') as Y.Map<unknown>;
    expect([...annotations.keys()].sort()).toEqual([
      'fixture-annotation-1',
      'fixture-annotation-2',
    ]);

    // v6 scope 2: preferences folded to one keyed map…
    const folded = doc.getMap('preferences');
    expect([...folded.keys()].sort()).toEqual([DEVICE_A, DEVICE_B]);
    const foldedA = (folded.get(DEVICE_A) as Y.Map<unknown>).toJSON();
    expect(foldedA['fontFamily']).toBe('Literata');
    const foldedB = (folded.get(DEVICE_B) as Y.Map<unknown>).toJSON();
    expect(foldedB['fontFamily']).toBe('Bookerly');
    // …with fontProfiles present for every era (v4→v5 backfill, or doc value).
    expect(foldedA['fontProfiles']).toEqual({
      en: { fontSize: 100, lineHeight: 1.5 },
      zh: { fontSize: 120, lineHeight: 1.8 },
    });

    // COPY-WITHOUT-CLEAR: the legacy per-device husks are retained verbatim
    // (clearing is v7's job, after the fleet upgrades — risk R4/D5).
    for (const device of [DEVICE_A, DEVICE_B]) {
      const husk = doc.getMap(`preferences/${device}`);
      expect(husk.size).toBeGreaterThan(0);
      expect(husk.toJSON()).toEqual(folded.get(device) instanceof Y.Map
        ? (folded.get(device) as Y.Map<unknown>).toJSON()
        : folded.get(device));
    }

    // v1→v2 prune: the corrupt session is gone, valid sessions retained.
    const progress = doc.getMap('progress').toJSON() as {
      progress: Record<string, Record<string, { readingSessions: { startTime: unknown }[] }>>;
    };
    expect(progress.progress[BOOK_EN][DEVICE_A].readingSessions).toHaveLength(1);
    expect(progress.progress[BOOK_EN][DEVICE_A].readingSessions[0].startTime).toBeTypeOf('number');
    expect(progress.progress[BOOK_EN][DEVICE_B].readingSessions).toHaveLength(1);

    // Inventory survives, including the CJK title through the Y.Text eras.
    const books = (doc.getMap('library').toJSON() as {
      books: Record<string, { title: string }>;
    }).books;
    expect(books[BOOK_EN].title).toBe("Alice's Adventures in Wonderland");
    expect(books[BOOK_CJK].title).toBe('紅樓夢');
  });

  it('all eras terminate in canonically-equal doc JSON', async () => {
    const terminal: Record<string, unknown>[] = [];
    for (const era of eras) {
      const doc = loadDoc(era);
      await migrate(doc);
      terminal.push(docJson(doc));
    }
    for (let i = 1; i < terminal.length; i++) {
      expect(terminal[i]).toEqual(terminal[0]);
    }
  });

  it.each(eras)('v%i: re-running the coordinator is a no-op (idempotence)', async (era) => {
    const doc = loadDoc(era);
    await migrate(doc);
    const after = docJson(doc);

    const checkpointAgain = vi.fn();
    const second = await runCrdtMigrationsOnDoc(doc, {
      createCheckpoint: (trigger) => {
        checkpointAgain(trigger);
        return Promise.resolve(99);
      },
    });
    expect(second.status).toBe('noop');
    expect(second.from).toBe(6);
    expect(checkpointAgain).not.toHaveBeenCalled(); // no checkpoint on a no-op
    expect(docJson(doc)).toEqual(after);
  });

  it('two clients migrating concurrently converge (determinism + LWW)', async () => {
    const docA = loadDoc(5);
    const docB = loadDoc(5);

    // Both clients run the full chain independently, then exchange updates.
    await migrate(docA, 1);
    await migrate(docB, 2);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    expect(docJson(docA)).toEqual(docJson(docB));
    expect(docA.getMap('annotations').has('popover')).toBe(false);
    expect([...docA.getMap('preferences').keys()].sort()).toEqual([DEVICE_A, DEVICE_B]);
    expect(readDocSchemaVersion(docA)).toBe(6);
  });

  it('v1 + v5 clients: staggered-era migrations merge to the same terminal state', async () => {
    // The v1 fixture and v5 fixture are era snapshots of the SAME seed; a
    // fleet where one device migrates from each era must still converge.
    const docOld = loadDoc(1);
    const docNew = loadDoc(5);
    await migrate(docOld);
    await migrate(docNew);
    Y.applyUpdate(docOld, Y.encodeStateAsUpdate(docNew));
    Y.applyUpdate(docNew, Y.encodeStateAsUpdate(docOld));
    expect(docJson(docOld)).toEqual(docJson(docNew));
  });
});

// ─── Coordinator invariants ──────────────────────────────────────────────────

describe('coordinator invariants', () => {
  it('no-op on an up-to-date doc: no checkpoint, no writes', async () => {
    const doc = loadDoc(5);
    doc.getMap('library').set('__schemaVersion', CURRENT_SCHEMA_VERSION);
    const before = docJson(doc);

    const checkpoint = vi.fn();
    const result = await runCrdtMigrationsOnDoc(doc, {
      createCheckpoint: (trigger) => {
        checkpoint(trigger);
        return Promise.resolve(1);
      },
    });

    expect(result.status).toBe('noop');
    expect(checkpoint).not.toHaveBeenCalled();
    expect(docJson(doc)).toEqual(before);
  });

  it('no-op on a doc from the future (quarantine belongs to the middleware, not the coordinator)', async () => {
    const doc = loadDoc(5);
    doc.getMap('library').set('__schemaVersion', CURRENT_SCHEMA_VERSION + 1);
    const before = docJson(doc);

    const result = await migrate(doc);
    expect(result.status).toBe('noop');
    expect(docJson(doc)).toEqual(before);
  });

  it('no-op on a fresh empty doc: version follows data (no premature stamp, no checkpoint)', async () => {
    const doc = new Y.Doc();
    const checkpoint = vi.fn();
    const result = await runCrdtMigrationsOnDoc(doc, {
      createCheckpoint: (trigger) => {
        checkpoint(trigger);
        return Promise.resolve(1);
      },
    });

    expect(result.status).toBe('noop');
    expect(checkpoint).not.toHaveBeenCalled();
    // Stamping an empty doc would mark later-merging cloud data as already
    // migrated; the doc must stay byte-empty.
    expect(Y.encodeStateAsUpdate(doc).byteLength).toBeLessThanOrEqual(2);
  });

  it('takes the protected pre-migration checkpoint BEFORE the first transform', async () => {
    const doc = loadDoc(5);
    const original = Y.encodeStateAsUpdate(doc);

    let snapshot: Uint8Array | undefined;
    let trigger: string | undefined;
    const result = await runCrdtMigrationsOnDoc(doc, {
      createCheckpoint: (t) => {
        trigger = t;
        snapshot = Y.encodeStateAsUpdate(doc);
        return Promise.resolve(42);
      },
    });

    expect(result.checkpointId).toBe(42);
    expect(trigger).toBe(`pre-crdt-migration-v${CURRENT_SCHEMA_VERSION}`);
    // The bytes captured at checkpoint time are the PRE-migration doc:
    // restoring them yields the original v5 state, popover and all.
    expect(snapshot).toEqual(original);
    const restored = new Y.Doc();
    Y.applyUpdate(restored, snapshot!);
    expect(restored.getMap('annotations').has('popover')).toBe(true);
    expect(restored.getMap('library').get('__schemaVersion')).toBe(5);
  });

  it('checkpoint failure aborts the run before any change', async () => {
    const doc = loadDoc(5);
    const before = docJson(doc);

    await expect(
      runCrdtMigrationsOnDoc(doc, {
        createCheckpoint: () => Promise.reject(new Error('idb exploded')),
      }),
    ).rejects.toMatchObject({
      name: 'MigrationError',
      code: 'SYNC_MIGRATION_FAILED',
      checkpointId: undefined,
    });
    expect(docJson(doc)).toEqual(before);
  });

  it('a failing step surfaces MigrationError with the checkpoint id; the bump is never applied', async () => {
    const doc = loadDoc(5);

    const failure = await runCrdtMigrationsOnDoc(doc, {
      createCheckpoint: stubCheckpoint(77)(doc),
      steps: [
        {
          from: 5,
          to: 6,
          migrate: () => {
            throw new Error('boom');
          },
        },
      ],
    }).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(MigrationError);
    const migrationError = failure as MigrationError;
    expect(migrationError.checkpointId).toBe(77);
    expect(migrationError.code).toBe('SYNC_MIGRATION_FAILED');
    expect(migrationError.message).toContain('#77');

    // Transform and bump are one transaction: the throw means no bump, so a
    // re-run (after the cause is fixed) picks up from the same version.
    expect(readDocSchemaVersion(doc)).toBe(5);
    const recovery = await migrate(doc);
    expect(recovery).toMatchObject({ status: 'migrated', from: 5, to: 6 });
  });

  it('a version gap fails loudly (no silent skip)', async () => {
    const doc = loadDoc(1);
    await expect(
      runCrdtMigrationsOnDoc(doc, {
        createCheckpoint: stubCheckpoint(5)(doc),
        steps: CRDT_MIGRATIONS.filter((step) => step.from !== 2 && step.from !== 3),
      }),
    ).rejects.toMatchObject({ name: 'MigrationError', checkpointId: 5 });
  });

  it('each step is ONE transaction: transform + dual bump arrive atomically, tagged MIGRATION_ORIGIN', async () => {
    const doc = loadDoc(5);
    const origins: unknown[] = [];
    let popoverGoneWhenBumped = false;
    doc.on('afterTransaction', (transaction: Y.Transaction) => {
      if (transaction.origin === undefined || transaction.local === false) return;
      origins.push(transaction.origin);
    });
    doc.getMap('library').observe(() => {
      // The instant the bump lands, the same transaction must already have
      // removed the popover key — observers can never see one without the other.
      popoverGoneWhenBumped = !doc.getMap('annotations').has('popover');
    });

    await migrate(doc);

    // The v5 fixture needs exactly one step (5→6) → exactly one transaction.
    expect(origins).toEqual([MIGRATION_ORIGIN]);
    expect(popoverGoneWhenBumped).toBe(true);
  });

  it('runCrdtMigrations() runs once per tab: repeated calls share the same promise', async () => {
    __resetCrdtMigrationsForTests();
    const first = runCrdtMigrations();
    const second = runCrdtMigrations();
    expect(second).toBe(first);
    // The app singleton doc is empty in this suite → noop (and therefore no
    // CheckpointService traffic).
    await expect(first).resolves.toMatchObject({ status: 'noop' });

    __resetCrdtMigrationsForTests();
    expect(runCrdtMigrations()).not.toBe(first);
  });
});

// ─── F.2: two-client quarantine (vitest level) ───────────────────────────────

describe('F.2 two-client quarantine — v5 stack vs migrated v6 doc', () => {
  interface LibraryMirror {
    __schemaVersion: number;
    books: Record<string, { title: string }>;
    setBooks: (books: Record<string, { title: string }>) => void;
  }
  interface AnnotationsMirror {
    annotations: Record<string, unknown>;
  }

  it('onObsolete(6) fires before any store patch; outbound halts; D5 residual pinned', async () => {
    // Client A: the current stack migrates a v5 doc to v6.
    const docA = loadDoc(5);
    await migrate(docA);
    const v6Update = Y.encodeStateAsUpdate(docA);

    // Client B: a v5-era stack — middleware configured schemaVersion: 5 —
    // hydrated from its own copy of the v5 doc.
    const docB = loadDoc(5);
    let versionInStateWhenObsoleteFired: number | undefined;
    const onObsolete = vi.fn(() => {
      versionInStateWhenObsoleteFired = libraryB.getState().__schemaVersion;
    });
    const libraryB = createStore<LibraryMirror>()(
      yjsMiddleware(
        docB,
        'library',
        (set) => ({
          __schemaVersion: 1,
          books: {},
          setBooks: (books) => set({ books }),
        }),
        { disableYText: true, schemaVersion: 5, onObsolete },
      ),
    );
    const annotationsObsolete = vi.fn();
    const annotationsB = createStore<AnnotationsMirror>()(
      yjsMiddleware(docB, 'annotations', () => ({ annotations: {} }), {
        disableYText: true,
        schemaVersion: 5,
        onObsolete: annotationsObsolete,
      }),
    );
    await drain();

    // Pre-quarantine: B hydrated the v5 doc (incl. the phantom popover key —
    // legacy middleware has no whitelist; pinned by fixtures-hydration).
    expect(libraryB.getState().__schemaVersion).toBe(5);
    expect(Object.keys(libraryB.getState().books)).toHaveLength(2);
    expect('popover' in (annotationsB.getState() as unknown as Record<string, unknown>)).toBe(true);

    // The v6 doc arrives (cloud merge / provider update).
    Y.applyUpdate(docB, v6Update);

    // Quarantine fired synchronously, with the incoming version, BEFORE any
    // store patch (state still showed v5 inside the callback).
    expect(onObsolete).toHaveBeenCalledTimes(1);
    expect(onObsolete).toHaveBeenCalledWith(6);
    expect(versionInStateWhenObsoleteFired).toBe(5);

    await drain();

    // The library store was never patched with v6 data…
    expect(libraryB.getState().__schemaVersion).toBe(5);
    expect(Object.keys(libraryB.getState().books)).toHaveLength(2);

    // …and outbound is permanently halted: local writes reach neither the
    // doc nor the wire.
    let updatesAfterQuarantine = 0;
    docB.on('update', () => {
      updatesAfterQuarantine += 1;
    });
    libraryB.getState().setBooks({});
    await drain();
    expect(updatesAfterQuarantine).toBe(0);
    expect((docB.getMap('library').get('books') as Y.Map<unknown>).size).toBe(2);

    // PINNED RESIDUAL (D5, fixed by Phase 4's synchronous pre-merge `meta`
    // check): the Y-level merge has already happened — the local doc (and
    // therefore y-idb) now carries v6 data…
    expect(docB.getMap('library').get('__schemaVersion')).toBe(6);
    expect(docB.getMap('meta').get('schemaVersion')).toBe(6);
    expect(docB.getMap('annotations').has('popover')).toBe(false);
    // …and stores on maps WITHOUT a __schemaVersion key never quarantine:
    // the annotations mirror applied the v6 popover deletion to its state.
    expect(annotationsObsolete).not.toHaveBeenCalled();
    expect('popover' in (annotationsB.getState() as unknown as Record<string, unknown>)).toBe(false);
  });

  // Program rule 6 (standing): the Playwright two-client journey — client B
  // booted with a v5 schema override, client A migrating the v5 fixture over
  // the mock sync backend, ObsoleteLockView asserted (and persisting across
  // reload). It needs the `window.__versicleTest.overrideSchemaVersion` hook,
  // which feeds `defineSyncedStore` — that seam lands with the store
  // registry item (phase2-fork-surgery.md §5.4, P2-6/P2-9). Until then the
  // journey lives here as the wired-up TODO for the emulator/nightly lane.
  it.todo(
    'Playwright journey (nightly lane): v5-overridden client locks (ObsoleteLockView) against a v6 workspace and stays locked across reload',
  );
});
