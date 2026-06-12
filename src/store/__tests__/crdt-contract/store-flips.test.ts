import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import yjsMiddleware, { __scopedDiffDevSampling, getYjsStoreHandle } from 'zustand-middleware-yjs';
import type { SyncedStoreDef } from '@store/yjs-provider';
import { BOOK_EN, BOOK_CJK, DEVICE_A, DEVICE_B } from '@test/fixtures/ydoc/seed';
import { CONTENT_ANALYSIS_STORE_DEF } from '@store/useContentAnalysisStore';
import { VOCABULARY_STORE_DEF } from '@store/useVocabularyStore';
import { DEVICES_STORE_DEF } from '@store/useDeviceStore';
import { LEXICON_STORE_DEF } from '@store/useLexiconStore';
import { READING_LIST_STORE_DEF } from '@store/useReadingListStore';
import { PREFERENCES_STORE_DEF } from '@store/usePreferencesStore';
import { ANNOTATIONS_STORE_DEF } from '@store/useAnnotationStore';
import { LIBRARY_STORE_DEF } from '@store/useBookStore';
import { PROGRESS_STORE_DEF } from '@store/useReadingStateStore';
import { runCrdtMigrationsOnDoc } from '@app/migrations';
import { getDeviceId } from '@lib/device-id';

/**
 * Per-store flip suite (phase2-fork-surgery.md §2.6, the F.1 re-run): as each
 * store flips to merge-defaults + scopedDiff, this suite re-runs the
 * fixture-hydration matrix through THAT STORE'S registry def — the per-store
 * rewrite of contract case A.5 (legacy replace-with-delete), which
 * fixtures-hydration.test.ts keeps pinned for the raw legacy options.
 *
 * Mirror stores replicate defineSyncedStore's wiring against per-fixture
 * docs (the real app stores are bound to the provider's singleton yDoc and
 * can't be rebound); the def import means each store's ACTUAL flip state is
 * what's under test — flipping a def flips this suite's expectations with
 * it. Canary discipline: the store modules' deleted `|| {}` hydration
 * fallbacks are NOT reintroduced here; hydrated state must be usable
 * without them.
 */

const fixtureDir = join(process.cwd(), 'src', 'test', 'fixtures', 'ydoc');

const loadDoc = (era: 1 | 2 | 4 | 5): Y.Doc => {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(readFileSync(join(fixtureDir, `v${era}.update.bin`))));
  return doc;
};

const drain = () => new Promise<void>((r) => setTimeout(r, 0));

/** Bind a mirror store exactly as defineSyncedStore would (minus the singleton doc). */
const bindWithDef = <S>(
  doc: Y.Doc,
  def: SyncedStoreDef,
  creator: (set: (p: Partial<S>) => void, get: () => S) => S,
) =>
  createStore<S>()(
    yjsMiddleware(doc, def.name, creator, {
      schemaVersion: 6,
      disableYText: true,
      syncedKeys: def.syncedKeys,
      hydration: def.hydration,
      scopedDiff: def.scopedDiff,
      scope: def.scope,
    }),
  );

// ─── Flip wave 3: preferences (scope rebind, §5.3) ──────────────────────────

/** Mirror of the store's declared defaults (usePreferencesStore.ts). */
const prefsDefaults = {
  currentTheme: 'light',
  customTheme: { bg: '#ffffff', fg: '#000000' },
  fontFamily: 'serif',
  lineHeight: 1.5,
  fontSize: 100,
  shouldForceFont: false,
  readerViewMode: 'paginated',
  libraryLayout: 'grid',
  libraryFilterMode: 'all',
  librarySortOrder: 'last_read',
  activeContext: 'library',
  forceTraditionalChinese: false,
  showPinyin: false,
  pinyinSize: 100,
  fontProfiles: {
    en: { fontSize: 100, lineHeight: 1.5 },
    zh: { fontSize: 120, lineHeight: 1.8 },
  } as Record<string, { fontSize: number; lineHeight: number }>,
  // Phase 7 §H (privacy D2): per-book AI consent map (additive synced key).
  aiConsent: {} as Record<string, boolean>,
};
interface PrefsState extends Record<string, unknown> {
  setTheme: (theme: string) => void;
}

describe('flip wave 3: preferences (scope rebind + merge-defaults + scopedDiff)', () => {
  const prefsCreator = (set: (p: Partial<PrefsState>) => void): PrefsState => ({
    ...structuredClone(prefsDefaults),
    setTheme: (currentTheme) => set({ currentTheme }),
  });
  /** The live def, rebound to a fixture device id (scope.key is runtime-derived). */
  const scopedTo = (deviceId: string): SyncedStoreDef => ({
    ...PREFERENCES_STORE_DEF,
    scope: { key: deviceId },
  });

  it('the live def binds this device to the folded keyed map', () => {
    expect(PREFERENCES_STORE_DEF.name).toBe('preferences');
    expect(PREFERENCES_STORE_DEF.scope?.key).toBe(getDeviceId());
    expect(PREFERENCES_STORE_DEF.hydration).toBe('merge-defaults');
    expect(PREFERENCES_STORE_DEF.scopedDiff).toBe(true);
  });

  it('C.4 end-to-end: v4 doc → coordinator (backfill + fold) → scoped store hydrates fully', async () => {
    const doc = loadDoc(4);
    await runCrdtMigrationsOnDoc(doc, { createCheckpoint: async () => 1 });

    const store = bindWithDef<PrefsState>(doc, scopedTo(DEVICE_A), prefsCreator);
    const state = store.getState();
    expect(state.currentTheme).toBe('sepia');
    expect(state.fontFamily).toBe('Literata');
    expect(state.showPinyin).toBe(true);
    expect(state.pinyinSize).toBe(60);
    // v4→v5 backfilled fontProfiles into the legacy map before the fold.
    expect(state.fontProfiles).toEqual(prefsDefaults.fontProfiles);
  });

  it('C.4 merge under scope: a folded child missing fontProfiles retains the declared default', () => {
    const doc = new Y.Doc();
    const child = new Y.Map();
    child.set('currentTheme', 'sepia');
    doc.getMap('preferences').set(DEVICE_A, child);

    const store = bindWithDef<PrefsState>(doc, scopedTo(DEVICE_A), prefsCreator);
    expect(store.getState().currentTheme).toBe('sepia'); // doc value wins…
    expect(store.getState().fontFamily).toBe('serif'); // …absent keys keep defaults
    expect(store.getState().fontProfiles).toEqual(prefsDefaults.fontProfiles);
  });

  it('new device starts clean from defaults and lazily writes only what it sets — no legacy share is ever created', async () => {
    const doc = loadDoc(5);
    await runCrdtMigrationsOnDoc(doc, { createCheckpoint: async () => 1 });

    const newDevice = 'fixture-device-new';
    const store = bindWithDef<PrefsState>(doc, scopedTo(newDevice), prefsCreator);
    expect(store.getState().currentTheme).toBe(prefsDefaults.currentTheme);

    store.getState().setTheme('dark');
    await drain();

    const child = doc.getMap('preferences').get(newDevice) as Y.Map<unknown>;
    expect(child).toBeInstanceOf(Y.Map);
    // Lazy backfill (C.7): only the written key reaches the doc.
    expect(child.toJSON()).toEqual({ currentTheme: 'dark' });
    // The getDeviceId()-named top-level shares died with the rebind (§5.3.4).
    expect(doc.share.has(`preferences/${newDevice}`)).toBe(false);
  });

  it('sibling devices never patch a scoped store (inbound path filtering)', async () => {
    const doc = loadDoc(5);
    await runCrdtMigrationsOnDoc(doc, { createCheckpoint: async () => 1 });

    const store = bindWithDef<PrefsState>(doc, scopedTo(DEVICE_A), prefsCreator);
    const before = store.getState();

    (doc.getMap('preferences').get(DEVICE_B) as Y.Map<unknown>).set('fontSize', 200);
    await drain();

    expect(store.getState()).toBe(before); // reference-identical: no patch ran
  });
});

// ─── Flip wave 4: annotations, books ────────────────────────────────────────

describe('flip wave 4: annotations (merge-defaults + scopedDiff)', () => {
  interface AnnState {
    annotations: Record<string, { id: string; text?: string }>;
    remove: (id: string) => void;
  }
  const creator = (set: (p: Partial<AnnState>) => void, get: () => AnnState): AnnState => ({
    annotations: {},
    remove: (id) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _removed, ...remaining } = get().annotations;
      set({ annotations: remaining });
    },
  });

  it('hydrates the v5 fixture; the stale popover doc key stays OUT of state (B.2 against the live def)', () => {
    const store = bindWithDef<AnnState>(loadDoc(5), ANNOTATIONS_STORE_DEF, creator);

    expect(Object.keys(store.getState().annotations).sort()).toEqual([
      'fixture-annotation-1',
      'fixture-annotation-2',
    ]);
    expect('popover' in store.getState()).toBe(false);
  });

  it('nested deletions still apply under merge-defaults (C.2: a removed annotation propagates)', async () => {
    const doc = loadDoc(5);
    const store = bindWithDef<AnnState>(doc, ANNOTATIONS_STORE_DEF, creator);

    // Remote deletion of one annotation rides under the PRESENT top-level key.
    (doc.getMap('annotations').get('annotations') as Y.Map<unknown>).delete(
      'fixture-annotation-1',
    );
    await drain();
    expect(Object.keys(store.getState().annotations)).toEqual(['fixture-annotation-2']);
  });

  it('A.5 rewritten: a doc missing `annotations` retains the declared default', () => {
    const doc = new Y.Doc();
    doc.getMap('annotations').set('popover', 'junk-only doc');

    const store = bindWithDef<AnnState>(doc, ANNOTATIONS_STORE_DEF, creator);
    expect(store.getState().annotations).toEqual({});
  });
});

describe('flip wave 4: books / library (merge-defaults + scopedDiff)', () => {
  interface LibState {
    __schemaVersion: number;
    books: Record<string, { bookId: string; title: string }>;
    addBook: (book: { bookId: string; title: string }) => void;
  }
  const creator = (set: (p: Partial<LibState>) => void, get: () => LibState): LibState => ({
    __schemaVersion: 1,
    books: {},
    addBook: (book) => set({ books: { ...get().books, [book.bookId]: book } }),
  });

  it('hydrates the v5 fixture fully (CJK intact, implicit __schemaVersion synced); actions need no || {} fallback', () => {
    const store = bindWithDef<LibState>(loadDoc(5), LIBRARY_STORE_DEF, creator);

    expect(Object.keys(store.getState().books).sort()).toEqual([BOOK_EN, BOOK_CJK].sort());
    expect(store.getState().books[BOOK_CJK].title).toBe('紅樓夢');
    expect(store.getState().__schemaVersion).toBe(5);

    // The deleted canaries (`state.books || {}`) must not be needed:
    store.getState().addBook({ bookId: 'new-book', title: 'New' });
    expect(Object.keys(store.getState().books)).toHaveLength(3);
  });

  it('hydrates a v1 (Y.Text era) doc through the flipped options', () => {
    const store = bindWithDef<LibState>(loadDoc(1), LIBRARY_STORE_DEF, creator);
    expect(store.getState().books[BOOK_EN].title).toBe("Alice's Adventures in Wonderland");
    expect(store.getState().books[BOOK_CJK].title).toBe('紅樓夢');
  });

  it('A.5 rewritten: a doc missing `books` retains the default — clean-client check works without a fallback', () => {
    const doc = new Y.Doc();
    doc.getMap('library').set('__schemaVersion', 5);

    const store = bindWithDef<LibState>(doc, LIBRARY_STORE_DEF, creator);
    // The FirestoreSyncManager clean-client check, post-canary-deletion:
    expect(Object.keys(store.getState().books).length === 0).toBe(true);
  });
});

// ─── Flip wave 5: progress (the hot path, flipped last) ─────────────────────

describe('flip wave 5: progress (merge-defaults + scopedDiff)', () => {
  interface UserProgressMini {
    bookId: string;
    percentage: number;
    currentCfi: string;
    lastRead: number;
    completedRanges: string[];
  }
  interface ProgressState {
    progress: Record<string, Record<string, UserProgressMini>>;
    updateLocation: (bookId: string, deviceId: string, cfi: string, percentage: number) => void;
  }
  const creator = (
    set: (p: Partial<ProgressState>) => void,
    get: () => ProgressState,
  ): ProgressState => ({
    progress: {},
    updateLocation: (bookId, deviceId, cfi, percentage) => {
      const state = get();
      // Mirrors the real action incl. the KEPT per-book second-level guard
      // (a legitimately absent book — census ▲5, NOT a hydration canary).
      const bookProgress = state.progress[bookId] || {};
      set({
        progress: {
          ...state.progress,
          [bookId]: {
            ...bookProgress,
            [deviceId]: {
              ...bookProgress[deviceId],
              bookId,
              currentCfi: cfi,
              percentage,
              lastRead: 99,
              completedRanges: bookProgress[deviceId]?.completedRanges || [],
            },
          },
        },
      });
    },
  });

  it('hydrates the v5 fixture fully (per-device structure intact); page turns work for present AND absent books', () => {
    const store = bindWithDef<ProgressState>(loadDoc(5), PROGRESS_STORE_DEF, creator);

    expect(store.getState().progress[BOOK_EN][DEVICE_A].percentage).toBe(0.42);
    expect(store.getState().progress[BOOK_EN][DEVICE_B].percentage).toBe(0.1);

    // Existing book — no hydration fallback needed.
    store.getState().updateLocation(BOOK_EN, DEVICE_A, 'epubcfi(/6/4!/4/2/1:200)', 0.5);
    expect(store.getState().progress[BOOK_EN][DEVICE_A].percentage).toBe(0.5);
    // Absent book — exercises the KEPT per-book guard.
    store.getState().updateLocation('brand-new-book', DEVICE_A, 'epubcfi(/6/2!/4/2)', 0.01);
    expect(store.getState().progress['brand-new-book'][DEVICE_A].percentage).toBe(0.01);
  });

  it('A.5 rewritten: a doc missing `progress` retains the declared default', () => {
    const doc = new Y.Doc();
    doc.getMap('progress').set('junkKey', 1);

    const store = bindWithDef<ProgressState>(doc, PROGRESS_STORE_DEF, creator);
    expect(store.getState().progress).toEqual({});
  });

  it('D.5 in-repo: a page-turn set() produces a SCOPED transaction — no root-map serialization, events confined to the touched book', async () => {
    const sampleRateBefore = __scopedDiffDevSampling.rate;
    __scopedDiffDevSampling.rate = 0; // deterministic: disable the DEV full-diff tripwire
    const toJSON = Y.Map.prototype.toJSON;
    const toJSONInstances: unknown[] = [];
    Y.Map.prototype.toJSON = function spiedToJSON(this: Y.Map<unknown>) {
      toJSONInstances.push(this);
      return toJSON.call(this);
    };
    try {
      const doc = loadDoc(5);
      const store = bindWithDef<ProgressState>(doc, PROGRESS_STORE_DEF, creator);
      const rootMap = doc.getMap('progress');

      const eventPaths: (string | number)[][] = [];
      rootMap.observeDeep((events) => {
        events.forEach((event) => eventPaths.push([...event.path, ...event.changes.keys.keys()]));
      });

      toJSONInstances.length = 0;
      store.getState().updateLocation(BOOK_EN, DEVICE_A, 'epubcfi(/6/4!/4/2/1:300)', 0.6);
      getYjsStoreHandle(store).flush();

      // The ROOT data map is never serialized whole (D13's fix): only the
      // changed top-level key's subtree is read back for the diff.
      expect(toJSONInstances).not.toContain(rootMap);
      // Every change in the transaction is confined to the touched book.
      expect(eventPaths.length).toBeGreaterThan(0);
      for (const path of eventPaths) {
        expect(path.slice(0, 2)).toEqual(['progress', BOOK_EN]);
      }
    } finally {
      Y.Map.prototype.toJSON = toJSON;
      __scopedDiffDevSampling.rate = sampleRateBefore;
    }
  });
});

// ─── Flip wave 1: contentAnalysis, vocabulary, devices ──────────────────────

describe('flip wave 1: contentAnalysis (merge-defaults + scopedDiff)', () => {
  interface CAState {
    sections: Record<string, { title?: string; generatedAt: number }>;
    saveSectionTitle: (bookId: string, sectionId: string, title: string) => void;
  }
  const creator = (set: (p: Partial<CAState>) => void, get: () => CAState): CAState => ({
    sections: {},
    saveSectionTitle: (bookId, sectionId, title) => {
      const key = `${bookId}/${sectionId}`;
      const existing = get().sections[key] || { generatedAt: 1 };
      set({ sections: { ...get().sections, [key]: { ...existing, title } } });
    },
  });

  it('hydrates the v5 fixture fully; post-hydration actions need no || {} fallback', () => {
    const store = bindWithDef<CAState>(loadDoc(5), CONTENT_ANALYSIS_STORE_DEF, creator);

    expect(Object.keys(store.getState().sections)).toEqual([`${BOOK_EN}:section-4`]);

    // The deleted canaries (`state.sections || {}`) must not be needed:
    store.getState().saveSectionTitle(BOOK_EN, 'section-9', 'Chapter IX');
    expect(store.getState().sections[`${BOOK_EN}/section-9`]?.title).toBe('Chapter IX');
    expect(Object.keys(store.getState().sections)).toHaveLength(2);
  });

  it('A.5 rewritten: a doc missing the synced key RETAINS the declared default (and junk keys stay out)', () => {
    const doc = new Y.Doc();
    doc.getMap('contentAnalysis').set('junkKey', 'left by some other era');

    const store = bindWithDef<CAState>(doc, CONTENT_ANALYSIS_STORE_DEF, creator);

    // Legacy 'replace' would have DELETED `sections` here (D2). Merge-defaults
    // retains it; syncedKeys keeps the foreign key out of state.
    expect(store.getState().sections).toEqual({});
    expect('junkKey' in store.getState()).toBe(false);
  });
});

describe('flip wave 1: vocabulary (merge-defaults + scopedDiff)', () => {
  interface VocabState {
    knownCharacters: Record<string, number>;
    markAsKnown: (char: string) => void;
  }
  const creator = (set: (p: Partial<VocabState>) => void, get: () => VocabState): VocabState => ({
    knownCharacters: {},
    markAsKnown: (char) =>
      set({ knownCharacters: { ...get().knownCharacters, [char]: 42 } }),
  });

  it('hydrates the v5 fixture fully', () => {
    const store = bindWithDef<VocabState>(loadDoc(5), VOCABULARY_STORE_DEF, creator);
    expect(Object.keys(store.getState().knownCharacters).sort()).toEqual(['夢', '樓', '紅']);
  });

  it('A.5 rewritten: a doc missing the synced key retains the default; actions work', async () => {
    const doc = new Y.Doc();
    doc.getMap('vocabulary').set('legacyJunk', true);

    const store = bindWithDef<VocabState>(doc, VOCABULARY_STORE_DEF, creator);
    expect(store.getState().knownCharacters).toEqual({});

    store.getState().markAsKnown('書');
    await drain();
    expect(store.getState().knownCharacters['書']).toBe(42);
    // Lazy backfill (contract C.7): the written key reaches the doc.
    expect(
      (doc.getMap('vocabulary').get('knownCharacters') as Y.Map<unknown>).toJSON(),
    ).toEqual({ 書: 42 });
  });
});

// ─── Flip wave 2: lexicon, reading-list ─────────────────────────────────────

describe('flip wave 2: lexicon (merge-defaults + scopedDiff)', () => {
  interface LexState {
    rules: Record<string, { id: string; order?: number }>;
    settings: Record<string, unknown>;
  }
  const creator = (): LexState => ({ rules: {}, settings: {} });

  it('hydrates the v5 fixture fully (both synced keys)', () => {
    const store = bindWithDef<LexState>(loadDoc(5), LEXICON_STORE_DEF, creator);
    expect(Object.keys(store.getState().rules).sort()).toEqual([
      'fixture-rule-1',
      'fixture-rule-2',
    ]);
    expect(Object.keys(store.getState().settings)).toEqual([BOOK_EN]);
  });

  it('A.5 rewritten: a doc carrying only `rules` retains the `settings` default', () => {
    const doc = new Y.Doc();
    const rules = new Y.Map();
    rules.set('r1', new Y.Map());
    doc.getMap('lexicon').set('rules', rules);

    const store = bindWithDef<LexState>(doc, LEXICON_STORE_DEF, creator);
    expect(Object.keys(store.getState().rules)).toEqual(['r1']);
    // Legacy 'replace' would have deleted the doc-absent `settings` default.
    expect(store.getState().settings).toEqual({});
  });
});

describe('flip wave 2: reading-list (merge-defaults + scopedDiff)', () => {
  interface RLState {
    entries: Record<string, { filename: string; title?: string }>;
    upsertEntry: (entry: { filename: string }) => void;
  }
  const creator = (set: (p: Partial<RLState>) => void, get: () => RLState): RLState => ({
    entries: {},
    upsertEntry: (entry) =>
      set({ entries: { ...get().entries, [entry.filename]: entry } }),
  });

  it('hydrates the v5 fixture fully; post-hydration actions need no || {} fallback', () => {
    const store = bindWithDef<RLState>(loadDoc(5), READING_LIST_STORE_DEF, creator);
    expect(Object.keys(store.getState().entries).sort()).toEqual([
      'alice.epub',
      'frankenstein.epub',
      'hong-lou-meng (1).epub',
    ]);

    // The deleted canaries (`state.entries || {}`) must not be needed:
    store.getState().upsertEntry({ filename: 'dracula.epub' });
    expect(Object.keys(store.getState().entries).sort()).toEqual([
      'alice.epub',
      'dracula.epub',
      'frankenstein.epub',
      'hong-lou-meng (1).epub',
    ]);
  });

  it('A.5 rewritten: a doc missing `entries` retains the declared default', () => {
    const doc = new Y.Doc();
    doc.getMap('reading-list').set('junkKey', 7);

    const store = bindWithDef<RLState>(doc, READING_LIST_STORE_DEF, creator);
    expect(store.getState().entries).toEqual({});
    expect('junkKey' in store.getState()).toBe(false);
  });
});

describe('flip wave 1: devices (merge-defaults + scopedDiff)', () => {
  interface DeviceState {
    devices: Record<string, { id: string; name: string }>;
  }
  const creator = (): DeviceState => ({ devices: {} });

  it('A.5 rewritten: the v5 fixture map (flat, pre-wrapper shape with no `devices` key) retains the default and stays junk-free', () => {
    // The captured devices map carries flat per-device entries and no
    // `devices` top-level key — exactly the "doc predates the field" class:
    // legacy 'replace' deleted the default AND inserted the flat junk;
    // merge-defaults + syncedKeys does neither.
    const store = bindWithDef<DeviceState>(loadDoc(5), DEVICES_STORE_DEF, creator);

    expect(store.getState().devices).toEqual({});
    expect(DEVICE_A in store.getState()).toBe(false);
  });
});
