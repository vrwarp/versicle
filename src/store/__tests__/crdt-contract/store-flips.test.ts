import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as Y from 'yjs';
import { createStore } from 'zustand/vanilla';
import yjsMiddleware from 'zustand-middleware-yjs';
import type { SyncedStoreDef } from '@store/yjs-provider';
import { BOOK_EN, DEVICE_A } from '@test/fixtures/ydoc/seed';
import { CONTENT_ANALYSIS_STORE_DEF } from '@store/useContentAnalysisStore';
import { VOCABULARY_STORE_DEF } from '@store/useVocabularyStore';
import { DEVICES_STORE_DEF } from '@store/useDeviceStore';

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
